"""Connect orchestration — the one-click §7.5 flow.

Drives adb → root → Android check → cert install → proxy, emitting a `status`
event after each step so the UI can render a live checklist. Each step is
idempotent, so a Retry is just clicking Connect again. Failures stop the flow
and leave the state recoverable.
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable

from .adb import AdbOrchestrator
from .certs import CertManager
from .config import APP_DATA_DIR, PROXY_PORT
from .netutil import host_lan_ip
from .protocol import status_msg
from .state import AppState

Broadcast = Callable[[dict], Awaitable[None]]

# System trust store path on Android ≤ 13 (moved to /apex on 14+).
CACERTS_DIR = "/system/etc/security/cacerts"


def build_inject_script(cert_filename: str) -> str:
    """tmpfs-overlay CA install for Android 10–13 (API 29–33).

    /system isn't writable on these versions even with remount, so we mount a
    fresh writable tmpfs over the cacerts dir, repopulate it with the original
    certs plus ours, and fix perms + SELinux label. Non-persistent (resets on
    reboot), needs no APK — just root. Technique per HTTP Toolkit.
    """
    lines = [
        "#!/system/bin/sh",
        # Drop any prior overlay so re-runs don't stack tmpfs mounts.
        f"umount {CACERTS_DIR} 2>/dev/null",
        "mkdir -p /data/local/tmp/nox-ca-copy",
        "chmod 700 /data/local/tmp/nox-ca-copy",
        "rm -rf /data/local/tmp/nox-ca-copy/*",
        f"cp {CACERTS_DIR}/* /data/local/tmp/nox-ca-copy/ 2>/dev/null",
        f"mount -t tmpfs tmpfs {CACERTS_DIR}",
        f"mv /data/local/tmp/nox-ca-copy/* {CACERTS_DIR}/",
        f"mv /data/local/tmp/{cert_filename} {CACERTS_DIR}/{cert_filename}",
        f"chown root:root {CACERTS_DIR}/*",
        f"chmod 644 {CACERTS_DIR}/*",
        f"chcon u:object_r:system_file:s0 {CACERTS_DIR}/ 2>/dev/null",
        f"chcon u:object_r:system_file:s0 {CACERTS_DIR}/* 2>/dev/null",
    ]
    return "\n".join(lines) + "\n"


class ConnectController:
    def __init__(self, state: AppState, broadcast: Broadcast) -> None:
        self.state = state
        self.broadcast = broadcast
        self.adb = AdbOrchestrator()
        self.certs = CertManager()
        self._lock = asyncio.Lock()

    async def _emit(self, step: str, ok: bool, message: str) -> None:
        await self.broadcast(status_msg(step, ok, message, self.state.conn.to_dict()))

    # --- public actions ----------------------------------------------------

    async def connect(self) -> None:
        """Feature 1 — establish the ADB device *link* only (online + root
        detection). The prerequisite that gates Intercept-traffic and Frida."""
        if self._lock.locked():
            await self._emit("connect", False, "A connect is already in progress.")
            return
        async with self._lock:
            await self._run_connect()

    async def intercept_traffic(self) -> None:
        """Feature 2 — device-wide capture: install the CA + point the device
        http_proxy at mitmproxy. Requires the device link (connect) first."""
        if self._lock.locked():
            await self._emit("capture", False, "An operation is already in progress.")
            return
        async with self._lock:
            await self._run_intercept_traffic()

    async def stop_intercept(self) -> None:
        """Clear the device proxy (stop device-wide capture) but keep the link."""
        async with self._lock:
            if self.adb.adb_path and self.adb.serial:
                await self.adb.clear_proxy()
            self.state.conn.capturing = False
            await self._emit("capture_stopped", True, "Traffic capture stopped; device proxy cleared.")

    async def disconnect(self) -> None:
        async with self._lock:
            if self.adb.adb_path and self.adb.serial:
                await self.adb.clear_proxy()
            self.state.conn.connected = False
            self.state.conn.capturing = False
            await self._emit("disconnected", True, "Disconnected — device proxy cleared.")

    async def reboot_device(self) -> None:
        async with self._lock:
            if not (self.adb.adb_path and self.adb.serial):
                await self._emit("reboot", False, "No device connected.")
                return
            res = await self.adb.reboot()
            await self._emit(
                "reboot", res.ok,
                "Reboot requested." if res.ok else f"Reboot failed: {res.text}",
            )

    async def clear_device_proxy(self) -> None:
        """Best-effort proxy clear used on backend shutdown."""
        if self.adb.adb_path and self.adb.serial:
            await self.adb.clear_proxy()

    # --- orchestration -----------------------------------------------------

    async def _run_connect(self) -> None:
        """Feature 1: device link only — adb → device online → root detect →
        Android version. Leaves cert/proxy to Intercept-traffic (feature 2)."""
        conn = self.state.conn

        # 1) Locate adb — pick the one that actually sees a device ----------
        adb_path = await self.adb.autoselect()
        if not adb_path:
            await self._emit(
                "adb_found", False,
                "adb not found. Add Android platform-tools (adb) to PATH, or install Nox.",
            )
            return
        await self._emit("adb_found", True, f"adb: {adb_path}")

        # 2) Connect device — any online ADB device (USB or emulator) ------
        res = await self.adb.connect()
        if not res.ok:
            await self._emit("device_connected", False, res.text or "no device online")
            return
        conn.deviceSerial = self.adb.serial
        await self._emit("device_connected", True, f"device connected: {self.adb.serial}")

        # 3) Root (best-effort, never a dead end) ---------------------------
        # `adb root` only works on rooted/userdebug builds or emulators. On a
        # retail phone it fails — that's fine: the device is still linked, and
        # Intercept-traffic falls back to user-cert mode. (Frida needs root.)
        res = await self.adb.root()
        text = (res.stdout + res.stderr).lower()
        rooted = res.ok and "cannot run as root" not in text and "production build" not in text
        if rooted:
            # adbd restarts as root and the network device can briefly drop.
            if not await self._ensure_online():
                await self._emit("rooted", False, "Device went offline after `adb root`.")
                return
            conn.rooted = True
            await self._emit("rooted", True, "adbd running as root")
        else:
            conn.rooted = False
            await self._emit(
                "rooted", True,
                "device not rooted — system-store HTTPS unavailable (Intercept traffic "
                "uses a user cert; Frida needs root).",
            )

        # 4) Android version (recorded for the cert strategy later) ---------
        sdk = await self.adb.sdk_level()
        conn.androidSdk = sdk
        label = f"Android API {sdk}" if sdk is not None else "Android version unknown"
        await self._emit("android_checked", True, label)

        # 5) Linked --------------------------------------------------------
        conn.connected = True
        await self._emit(
            "connected", True,
            "Device linked. Start Intercept traffic for device-wide capture, or use Frida "
            "for a single app.",
        )

    async def _run_intercept_traffic(self) -> None:
        """Feature 2: device-wide capture — confirm CA, install it per the
        device's cert strategy, and point the device proxy at mitmproxy."""
        conn = self.state.conn

        # 0) Require the device link (feature 1) first.
        if not (self.adb.adb_path and self.adb.serial and conn.connected):
            await self._emit("capture", False, "Connect a device first (Connect device / ADB).")
            return

        # 1) Proxy running (started at boot) — confirm the CA exists --------
        conn.proxyRunning = True
        if not self.certs.ca_exists():
            await self._emit(
                "proxy_running", False,
                "mitmproxy CA not found; ensure the proxy started at least once.",
            )
            return
        await self._emit("proxy_running", True, f"proxy on 0.0.0.0:{PROXY_PORT}")

        # 2) Decide the cert strategy. System-store install needs root AND API
        #    ≤ 33 (14+ moved certs to /apex). Anything else uses the user cert.
        sdk = conn.androidSdk
        rooted = bool(conn.rooted)
        can_system = rooted and sdk is not None and sdk <= 33

        try:
            info = self.certs.compute()
        except FileNotFoundError as e:
            await self._emit("cert_installed", False, str(e))
            return

        if can_system:
            self.certs.build_android_cert(info, APP_DATA_DIR / "certs")
            if sdk <= 28:
                ok, message = await self._install_cert_push(info)
            else:
                ok, message = await self._install_cert_tmpfs(info)
            if not ok:
                await self._emit("cert_installed", False, message)
                return
            conn.certInstalled = True
            conn.certMode = "system"
            await self._emit("cert_installed", True, message)
        else:
            ok, message = await self._install_cert_user(info)
            if not ok:
                await self._emit("cert_installed", False, message)
                return
            conn.certInstalled = False
            conn.certMode = "user"
            await self._emit("cert_installed", True, message)

        # 3) Point the device at our proxy (works without root) -------------
        host_port = f"{host_lan_ip()}:{PROXY_PORT}"
        conn.hostProxy = host_port
        res = await self.adb.set_proxy(host_port)
        if not res.ok:
            await self._emit("proxy_set", False, f"failed to set proxy: {res.text}")
            return
        await self._emit("proxy_set", True, f"device proxy → {host_port}")

        # 4) Capturing -----------------------------------------------------
        conn.capturing = True
        if conn.certMode == "user":
            await self._emit(
                "capturing", True,
                "Capturing. HTTP flows now. For HTTPS, install the CA copied to the device's "
                "Downloads (see the cert step) — only apps that trust user CAs (and browsers) "
                "will decrypt.",
            )
        else:
            await self._emit("capturing", True, "Capturing — device traffic flows to the proxy.")

    # --- cert install strategies ------------------------------------------

    async def _install_cert_push(self, info) -> tuple[bool, str]:
        """Android ≤ 9: write directly to /system (persistent across reboot)."""
        remote = f"{CACERTS_DIR}/{info.android_filename}"
        res = await self.adb.remount()
        if not res.ok:
            return False, (
                f"remount failed — ensure Nox Root mode is ON and restart Nox. ({res.text})"
            )
        res = await self.adb.push(str(info.built_path), remote)
        if not res.ok:
            return False, f"push failed: {res.text}"
        res = await self.adb.chmod(remote)
        if not res.ok:
            return False, f"chmod failed: {res.text}"
        if not await self.adb.file_exists(remote):
            return False, "cert not present after push"
        return True, f"CA installed: {info.android_filename}"

    async def _install_cert_user(self, info) -> tuple[bool, str]:
        """Non-rooted: copy the CA to the device so the user can install it as a
        *user* certificate. We can't write the system store without root, so we
        push the PEM (as .crt) to Downloads and tell the user how to add it.
        HTTPS then decrypts for browsers and any app that trusts user CAs.
        """
        remote = "/sdcard/Download/nox-mitmproxy-ca.crt"
        res = await self.adb.push(str(info.pem_path), remote)
        if not res.ok:
            return False, f"failed to copy CA to device: {res.text}"
        return True, (
            "CA copied to the device's Downloads as nox-mitmproxy-ca.crt. To decrypt "
            "HTTPS, install it: Settings → Security → (More security settings →) "
            "Install a certificate → CA certificate → pick nox-mitmproxy-ca.crt. "
            "Only apps that trust user CAs (and browsers) will decrypt."
        )

    async def _install_cert_tmpfs(self, info) -> tuple[bool, str]:
        """Android 10–13: tmpfs overlay over the cacerts dir (resets on reboot)."""
        tmp_cert = f"/data/local/tmp/{info.android_filename}"
        res = await self.adb.push(str(info.built_path), tmp_cert)
        if not res.ok:
            return False, f"push cert failed: {res.text}"

        script_path = APP_DATA_DIR / "certs" / "nox-inject.sh"
        # LF line endings — sh on the device chokes on CRLF.
        script_path.write_bytes(build_inject_script(info.android_filename).encode("utf-8"))

        res = await self.adb.push_and_run_script(str(script_path))
        if not await self.adb.file_exists(f"{CACERTS_DIR}/{info.android_filename}"):
            return False, f"cert not present after tmpfs overlay: {res.text}"
        return True, f"CA installed via tmpfs overlay: {info.android_filename} (resets on reboot)"

    async def _ensure_online(self, retries: int = 6, delay: float = 1.0) -> bool:
        """Re-establish the device after an adbd restart (post-root)."""
        serial = self.adb.serial or ""
        for _ in range(retries):
            await self.adb.connect([serial])
            if await self.adb._is_online(serial):  # noqa: SLF001 — same package
                return True
            await asyncio.sleep(delay)
        return False
