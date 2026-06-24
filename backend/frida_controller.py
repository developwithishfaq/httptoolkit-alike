"""Frida orchestration — per-app interception + SSL unpinning.

The power-user counterpart to the system-proxy Connect flow. Where Connect sets
a device-wide proxy + installs a CA (and is defeated by certificate pinning),
this path runs frida-server on the device and injects scripts into ONE target
app that (a) trust our CA, (b) route the app's sockets through our proxy,
(c) disable certificate pinning, and (d) bypass common root-detection checks
(many apps refuse to run on a rooted device). Captured traffic still flows
through the same mitmproxy on :51080 into the normal flow list.

Requires root (frida-server runs as root). The host `frida` package and a
device-matched frida-server binary must both be present, else the feature
reports itself unavailable (graceful, like the user-cert fallback in Connect).

Flow: ensure rooted device → detect ABI → push+launch frida-server → adb forward
→ host attaches as a remote device → spawn target app gated → inject script →
resume. See docs/flows/frida.md.
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Optional

from . import config
from .connect import ConnectController
from .netutil import host_lan_ip
from .protocol import frida_apps_msg, frida_status_msg
from .state import AppState

Broadcast = Callable[[dict], Awaitable[None]]

# Host-side frida import is optional: the backend must run fine without it (the
# UI just shows the feature as unavailable). Resolved once at module load.
try:
    import frida  # type: ignore

    _FRIDA_IMPORT_ERROR: Optional[str] = None
except Exception as exc:  # pragma: no cover - depends on host env
    frida = None  # type: ignore
    _FRIDA_IMPORT_ERROR = str(exc)


class FridaController:
    def __init__(self, state: AppState, broadcast: Broadcast, connect: ConnectController) -> None:
        self.state = state
        self.broadcast = broadcast
        # Reuse Connect's adb so we operate on the same located adb + serial.
        self.connect = connect
        self.adb = connect.adb
        self._lock = asyncio.Lock()

        # Live session handles, kept referenced so frida doesn't GC them.
        self._device = None          # frida remote device (over adb forward)
        self._session = None         # frida session attached to the target
        self._script = None          # loaded injection script
        self._server_proc = None     # adb-shell Popen keeping frida-server alive
        self._loop: Optional[asyncio.AbstractEventLoop] = None

        self._init_availability()

    # --- availability ------------------------------------------------------

    def _init_availability(self) -> None:
        """Decide whether the Frida path can run on this host, and record why
        not so the UI can explain it."""
        fs = self.state.frida
        if frida is None:
            fs.available = False
            fs.reason = f"frida python package not installed ({_FRIDA_IMPORT_ERROR})"
            return
        fs.fridaVersion = getattr(frida, "__version__", None)
        if not config.FRIDA_SERVER_DIR.exists() or not any(config.FRIDA_SERVER_DIR.glob("frida-server-android-*")):
            fs.available = False
            fs.reason = (
                "no frida-server binary bundled — run scripts/fetch-frida-server.py "
                "to provision one for your device's CPU."
            )
            return
        fs.available = True
        fs.reason = None

    # --- emit helpers ------------------------------------------------------

    async def _emit(self, step: str, ok: bool, message: str) -> None:
        if not ok:
            self.state.frida.reason = message
        await self.broadcast(frida_status_msg(step, ok, message, self.state.frida.to_dict()))

    def _emit_threadsafe(self, step: str, ok: bool, message: str) -> None:
        """Emit from a frida callback thread (script on_message runs off-loop)."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._emit(step, ok, message), self._loop)

    # --- public actions ----------------------------------------------------

    async def start_server(self) -> None:
        """Push + launch frida-server and connect the host to it. Idempotent."""
        if self._lock.locked():
            await self._emit("frida_busy", False, "A Frida operation is already in progress.")
            return
        async with self._lock:
            self._loop = asyncio.get_running_loop()
            await self._run_start_server()

    async def list_apps(self) -> None:
        """Send the user-installed package list for the app picker."""
        if not (self.adb.adb_path and self.adb.serial):
            await self._emit("frida_apps", False, "No device connected — run Connect first.")
            return
        apps = await self.adb.list_packages(third_party_only=True)
        await self.broadcast(frida_apps_msg(apps))

    async def intercept_app(self, package: str) -> None:
        """Spawn `package` gated, inject the unpinning script, and resume it."""
        if self._lock.locked():
            await self._emit("frida_busy", False, "A Frida operation is already in progress.")
            return
        async with self._lock:
            self._loop = asyncio.get_running_loop()
            await self._run_intercept(package)

    async def stop(self) -> None:
        """Detach the script, kill frida-server, and clear forwards."""
        async with self._lock:
            await self._teardown()
            await self._emit("frida_stopped", True, "Frida interception stopped.")

    async def shutdown(self) -> None:
        """Best-effort teardown used on backend shutdown (no UI emit)."""
        await self._teardown()

    # --- orchestration -----------------------------------------------------

    async def _run_start_server(self) -> None:
        fs = self.state.frida
        if frida is None:
            await self._emit("frida_available", False, fs.reason or "frida unavailable")
            return

        # 0) Require the device link (feature 1). Frida is a standalone per-app
        #    feature but still needs a connected device; the UI gates the card on
        #    conn.connected so this is mostly a guard.
        if not (self.adb.adb_path and self.adb.serial and self.state.conn.connected):
            await self._emit(
                "frida_device", False,
                "Connect a device first (Connect device / ADB).",
            )
            return

        # 1) Frida needs root specifically (frida-server runs as root).
        if not self.state.conn.rooted:
            await self._emit(
                "frida_device", False,
                "Frida needs root (frida-server runs as root). This device isn't rooted.",
            )
            return
        await self._emit("frida_device", True, f"device {self.adb.serial} (rooted)")

        # 2) Match a bundled binary to the device CPU.
        abi = await self.adb.cpu_abi()
        if not abi:
            await self._emit("frida_abi", False, "Could not read device CPU ABI.")
            return
        binary = config.frida_server_binary(abi)
        if not binary.exists():
            await self._emit(
                "frida_abi", False,
                f"No bundled frida-server for {abi}. Run scripts/fetch-frida-server.py.",
            )
            return
        await self._emit("frida_abi", True, f"CPU {abi} → {binary.name}")

        # 3) Push + chmod.
        res = await self.adb.push(str(binary), config.FRIDA_REMOTE_PATH)
        if not res.ok:
            await self._emit("frida_push", False, f"push failed: {res.text}")
            return
        await self.adb.chmod(config.FRIDA_REMOTE_PATH, "755")
        await self._emit("frida_push", True, "frida-server pushed")

        # 4) Launch as a long-lived process and wait for it to come up.
        await self.adb.kill_process("nox-frida-server")  # clear any stale instance
        self._server_proc = await self.adb.spawn_shell(config.FRIDA_REMOTE_PATH)
        if self._server_proc is None:
            await self._emit("frida_launch", False, "Could not launch frida-server.")
            return
        if not await self._wait_for_server():
            await self._emit("frida_launch", False, "frida-server did not start (check root).")
            return
        await self._emit("frida_launch", True, "frida-server running on device")

        # 5) Forward a host port and connect to it as a remote frida device.
        await self.adb.remove_forward(config.FRIDA_SERVER_PORT)
        res = await self.adb.forward(config.FRIDA_SERVER_PORT, config.FRIDA_SERVER_PORT)
        if not res.ok:
            await self._emit("frida_connect", False, f"adb forward failed: {res.text}")
            return
        try:
            self._device = await asyncio.to_thread(
                lambda: frida.get_device_manager().add_remote_device(
                    f"127.0.0.1:{config.FRIDA_SERVER_PORT}"
                )
            )
        except Exception as exc:  # noqa: BLE001 - surface any frida error
            await self._emit("frida_connect", False, f"frida connect failed: {exc}")
            return

        fs.serverRunning = True
        await self._emit("frida_connect", True, "Host connected to frida-server.")

        # Prefetch the app list so the picker is ready.
        apps = await self.adb.list_packages(third_party_only=True)
        await self.broadcast(frida_apps_msg(apps))

    async def _run_intercept(self, package: str) -> None:
        fs = self.state.frida
        if frida is None or self._device is None:
            await self._emit("frida_inject", False, "frida-server not running — start it first.")
            return

        # Drop any prior session so we don't stack scripts.
        await self._detach_session()

        source = self._build_script()
        if source is None:
            await self._emit("frida_inject", False, "CA certificate not found (start the proxy once).")
            return

        try:
            pid = await asyncio.to_thread(self._device.spawn, [package])
            session = await asyncio.to_thread(self._device.attach, pid)
            script = await asyncio.to_thread(session.create_script, source)
            script.on("message", self._on_script_message)
            await asyncio.to_thread(script.load)
            await asyncio.to_thread(self._device.resume, pid)
        except Exception as exc:  # noqa: BLE001 - report spawn/inject failures
            await self._emit("frida_inject", False, f"inject failed: {exc}")
            await self._detach_session()
            return

        self._session = session
        self._script = script
        fs.targetApp = package
        fs.targetPid = pid
        fs.reason = None
        await self._emit(
            "frida_inject", True,
            f"Intercepting {package} (pid {pid}) — pinning + root detection bypassed, "
            "traffic routed to proxy.",
        )

    # --- script build ------------------------------------------------------

    def _build_script(self) -> Optional[str]:
        """Build the injected script: a generated config prologue, then the
        bundled scripts in order — native connect hook (raw-socket → SOCKS5
        redirect), SSL unpinning, root-detection bypass. Returns None if the CA
        is missing. Each bundled script is self-contained (own IIFE / Java.perform),
        so concatenation is safe.

        Two config shapes are emitted in the prologue:
          * NOX_CONFIG.*           — read by our android-unpinning.js (CA trust).
          * top-level const globals — the contract HTTP Toolkit's vendored
            native-connect-hook.js reads (PROXY_HOST/PORT, PROXY_SUPPORTS_SOCKS5,
            IGNORED_NON_HTTP_PORTS, BLOCK_HTTP3, DEBUG_MODE). For the native hook
            PROXY_PORT is the mitmproxy SOCKS5 listener (config.SOCKS_PORT), since
            the hook rewrites every socket to PROXY_HOST:PROXY_PORT and speaks
            SOCKS5 there to convey the original destination."""
        if not config.MITM_CA_PEM.exists():
            return None
        ca_pem = config.MITM_CA_PEM.read_text(encoding="utf-8")
        proxy_host = host_lan_ip()

        # Injected in order: native connect hook (raw sockets) first so it's in
        # place before any socket opens, then SSL unpinning, then root bypass.
        parts = []
        for name in ("native-connect-hook.js", "android-unpinning.js", "android-root-bypass.js"):
            path = config.FRIDA_SCRIPTS_DIR / name
            if path.exists():
                parts.append(f"// ===== {name} =====\n" + path.read_text(encoding="utf-8"))

        # JS prologue with the runtime config the scripts read.
        # JSON-encoding the PEM keeps newlines/quotes safe.
        import json

        header = (
            "// --- generated config (read by the bundled scripts) ---\n"
            "const NOX_CONFIG = {\n"
            f"  CERT_PEM: {json.dumps(ca_pem)},\n"
            f"  PROXY_HOST: {json.dumps(proxy_host)},\n"
            f"  PROXY_PORT: {config.PROXY_PORT},\n"
            "  DEBUG: false,\n"
            "};\n"
            "// HTTP Toolkit native-connect-hook.js config contract. PROXY_PORT is\n"
            "// the SOCKS5 listener; the hook redirects raw sockets there + SOCKS5-\n"
            "// handshakes the original destination so mitmproxy can MITM it.\n"
            f"const PROXY_HOST = {json.dumps(proxy_host)};\n"
            f"const PROXY_PORT = {config.SOCKS_PORT};\n"
            "const PROXY_SUPPORTS_SOCKS5 = true;\n"
            "const IGNORED_NON_HTTP_PORTS = [];\n"
            "const BLOCK_HTTP3 = true;\n"
            "const DEBUG_MODE = false;\n\n"
        )
        return header + "\n\n".join(parts)

    # --- frida callbacks ---------------------------------------------------

    def _on_script_message(self, message: dict, data) -> None:
        """Handle messages the injected script sends back (logs + errors).

        Runs on a frida-owned thread, so any UI emit is marshalled back onto the
        event loop via run_coroutine_threadsafe.
        """
        if message.get("type") == "error":
            desc = message.get("description", "script error")
            self._emit_threadsafe("frida_script", False, f"script error: {desc}")
        else:
            payload = message.get("payload")
            if payload:
                print(f"[frida] {payload}")

    # --- helpers -----------------------------------------------------------

    async def _wait_for_server(self, retries: int = 15, delay: float = 0.4) -> bool:
        for _ in range(retries):
            pid = await self.adb.pidof("nox-frida-server")
            if pid:
                return True
            # Bail early if the launcher process already died.
            if self._server_proc is not None and self._server_proc.returncode is not None:
                return False
            await asyncio.sleep(delay)
        return False

    async def _detach_session(self) -> None:
        """Unload the script + detach the session (keep frida-server running)."""
        script, session = self._script, self._session
        self._script = self._session = None
        self.state.frida.targetApp = None
        self.state.frida.targetPid = None
        if script is not None:
            try:
                await asyncio.to_thread(script.unload)
            except Exception:  # noqa: BLE001 - already gone is fine
                pass
        if session is not None:
            try:
                await asyncio.to_thread(session.detach)
            except Exception:  # noqa: BLE001
                pass

    async def _teardown(self) -> None:
        """Full stop: detach, kill frida-server, drop the forward."""
        await self._detach_session()
        self._device = None
        if self._server_proc is not None:
            try:
                self._server_proc.kill()
            except ProcessLookupError:
                pass
            self._server_proc = None
        if self.adb.adb_path and self.adb.serial:
            await self.adb.kill_process("nox-frida-server")
            await self.adb.remove_forward(config.FRIDA_SERVER_PORT)
        self.state.frida.serverRunning = False
