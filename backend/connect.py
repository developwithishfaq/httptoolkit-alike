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
        if self._lock.locked():
            await self._emit("connect", False, "A connect is already in progress.")
            return
        async with self._lock:
            await self._run_connect()

    async def disconnect(self) -> None:
        async with self._lock:
            if self.adb.adb_path and self.adb.serial:
                await self.adb.clear_proxy()
            self.state.conn.connected = False
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
        conn = self.state.conn

        # 1) Locate adb -----------------------------------------------------
        adb_path = self.adb.locate()
        if not adb_path:
            await self._emit(
                "adb_found", False,
                "adb not found. Install Nox (nox_adb.exe) or add adb to PATH.",
            )
            return
        await self._emit("adb_found", True, f"adb: {adb_path}")

        # 2) Proxy running (started at boot) — confirm the CA exists --------
        conn.proxyRunning = True
        if not self.certs.ca_exists():
            await self._emit(
                "proxy_running", False,
                "mitmproxy CA not found; ensure the proxy started at least once.",
            )
            return
        await self._emit("proxy_running", True, f"proxy on 0.0.0.0:{PROXY_PORT}")

        # 3) Connect device — any online ADB device (USB or emulator) ------
        res = await self.adb.connect()
        if not res.ok:
            await self._emit("device_connected", False, res.text or "no device online")
            return
        conn.deviceSerial = self.adb.serial
        await self._emit("device_connected", True, f"device connected: {self.adb.serial}")

        # 4) Root -----------------------------------------------------------
        res = await self.adb.root()
        text = (res.stdout + res.stderr).lower()
        if "cannot run as root" in text or "production build" in text:
            await self._emit(
                "rooted", False,
                "Root unavailable — `adb root` only works on rooted/userdebug "
                "devices or emulators. (On Nox: enable Root mode in Settings → "
                "General → Root, restart Nox, then Connect again.)",
            )
            return
        # adbd restarts as root and the network device can briefly drop — wait.
        if not await self._ensure_online():
            await self._emit("rooted", False, "Device went offline after `adb root`.")
            return
        await self._emit("rooted", True, "adbd running as root")

        # 5) Android version check (SPEC §7.3) ------------------------------
        sdk = await self.adb.sdk_level()
        conn.androidSdk = sdk
        if sdk is None:
            await self._emit("android_checked", False, "Could not read Android SDK level.")
            return
        if sdk >= 34:
            await self._emit(
                "android_checked", False,
                f"Android API {sdk} (14+): cert store moved to /apex and needs "
                f"per-namespace mounts — not yet supported. Use Android ≤ 13.",
            )
            return
        method = "system push" if sdk <= 28 else "tmpfs overlay"
        await self._emit("android_checked", True, f"Android API {sdk} — supported ({method})")

        # 6) Install the CA into the system store ---------------------------
        try:
            info = self.certs.compute()
        except FileNotFoundError as e:
            await self._emit("cert_installed", False, str(e))
            return
        self.certs.build_android_cert(info, APP_DATA_DIR / "certs")

        if sdk <= 28:
            ok, message = await self._install_cert_push(info)
        else:
            ok, message = await self._install_cert_tmpfs(info)
        if not ok:
            await self._emit("cert_installed", False, message)
            return
        conn.certInstalled = True
        await self._emit("cert_installed", True, message)

        # 7) Point the emulator at our proxy --------------------------------
        host_port = f"{host_lan_ip()}:{PROXY_PORT}"
        conn.hostProxy = host_port
        res = await self.adb.set_proxy(host_port)
        if not res.ok:
            await self._emit("proxy_set", False, f"failed to set proxy: {res.text}")
            return
        await self._emit("proxy_set", True, f"emulator proxy → {host_port}")

        # 8) Done -----------------------------------------------------------
        conn.connected = True
        await self._emit("connected", True, "Connected — app traffic should now flow.")

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
