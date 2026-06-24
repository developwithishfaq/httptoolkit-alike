"""Central configuration constants for the backend.

Keep this dependency-free so every other module can import it cheaply.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# --- Resource locator (works in source + PyInstaller bundle) ----------------


def _resource_root() -> Path:
    """Base dir for bundled runtime resources (frida-server binaries, scripts).

    Mirrors server._frontend_dist resolution so the same code works from a
    source checkout and inside a frozen one-folder bundle:
      1. NOX_RESOURCE_ROOT env override,
      2. <bundle>/_MEIPASS when frozen (PyInstaller --add-data lands here),
      3. repo root for `python -m backend` from source.
    """
    override = os.environ.get("NOX_RESOURCE_ROOT")
    if override:
        return Path(override)
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent


RESOURCE_ROOT = _resource_root()

# --- Subprocess (Windows console suppression) ------------------------------

# When the app runs as a windowed (no-console) frozen exe, every child process
# we spawn (adb, openssl, ...) would otherwise pop up its OWN console window —
# the app looks like it's "opening separate cmd windows". CREATE_NO_WINDOW
# suppresses that so we stay a single GUI process. No-op (0) off Windows.
# Pass via `creationflags=SUBPROCESS_NO_WINDOW` to subprocess / asyncio spawns.
if sys.platform == "win32":
    import subprocess as _subprocess

    SUBPROCESS_NO_WINDOW = _subprocess.CREATE_NO_WINDOW
else:
    SUBPROCESS_NO_WINDOW = 0

# --- Network ---------------------------------------------------------------

# mitmproxy listener. Must bind 0.0.0.0 so the Nox emulator can reach it over
# the virtual network (see SPEC §7.4).
#
# Port is intentionally in the IANA dynamic/private range (49152–65535) rather
# than the usual 8080: 8080 collides constantly with other dev servers/proxies a
# developer may already be running. 51080 is very unlikely to be taken. If you
# DO hit a conflict, change it here — every other reference derives from this.
PROXY_HOST = "0.0.0.0"
PROXY_PORT = 51080

# aiohttp web + WebSocket server. Localhost only — the UI runs on the host.
# 8770 is deliberately an uncommon port (not a default like 8000/8080/3000), so
# it's left as-is; collisions are unlikely. The Vite dev proxy targets must match.
WEB_HOST = "127.0.0.1"
WEB_PORT = 8770

# Loopback URL of our own proxy. The Resend feature (SPEC §8) sends replayed
# requests through this so they are captured by the engine like any other flow.
LOCAL_PROXY_URL = f"http://127.0.0.1:{PROXY_PORT}"

# Header that tags a replayed request so the engine can mark it (and correlate
# the result back to the UI's Resend screen). Stripped before reaching the server.
REPLAY_HEADER = "X-Nox-Replay"

# --- adb / Nox -------------------------------------------------------------

# Nox adb endpoints to try, in order (SPEC §7.1).
NOX_ADB_ENDPOINTS = ["127.0.0.1:62001", "127.0.0.1:62025"]

# Optional explicit adb path (overrides auto-detection). Set this to the SAME
# adb.exe your other Android tools use (e.g. Nox's bundled adb) so all tools
# share one adb server and don't fight over version mismatches on port 5037.
ADB_OVERRIDE = os.environ.get("NOX_INSPECTOR_ADB")

# --- Flow handling ---------------------------------------------------------

# Ring buffer size for captured flows kept in memory (SPEC §10).
FLOW_STORE_MAX = 5000

# Max body bytes streamed to the UI; larger bodies are truncated + flagged.
MAX_BODY_BYTES = 256 * 1024

# --- Persistence -----------------------------------------------------------


def _app_data_dir() -> Path:
    """%APPDATA%\\nox-inspector (falls back to ~/.nox-inspector off Windows)."""
    base = os.environ.get("APPDATA")
    root = Path(base) if base else Path.home() / ".config"
    return root / "nox-inspector"


APP_DATA_DIR = _app_data_dir()
RULES_PATH = APP_DATA_DIR / "rules.json"

# mitmproxy CA location (created on first proxy run).
MITM_CA_DIR = Path.home() / ".mitmproxy"
MITM_CA_PEM = MITM_CA_DIR / "mitmproxy-ca-cert.pem"

# --- Frida (per-app interception + SSL unpinning) --------------------------

# frida-server's default control port on the device. We `adb forward` a host
# port to this, then the host frida package talks to it as a remote device.
FRIDA_SERVER_PORT = 27042

# Where frida-server lives on the device once pushed (under /data/local/tmp so
# it survives without root-writable /system; it's launched as root though).
FRIDA_REMOTE_PATH = "/data/local/tmp/nox-frida-server"

# Bundled per-ABI frida-server binaries + injection scripts. Binaries are large
# (~15 MB each) and version-locked to the host `frida` package, so they are NOT
# committed — `scripts/fetch-frida-server.py` provisions them into this dir, and
# the PyInstaller spec / electron-builder bundle whatever is present.
# Resolved off RESOURCE_ROOT (not __file__) so they work frozen: PyInstaller
# keeps backend/*.py in the PYZ archive (no on-disk sibling), but bundles these
# as --add-data under the same relative paths the source tree uses.
FRIDA_SERVER_DIR = RESOURCE_ROOT / "desktop" / "resources" / "frida-server"
FRIDA_SCRIPTS_DIR = RESOURCE_ROOT / "backend" / "frida_scripts"

# Android CPU ABI (ro.product.cpu.abi) → frida release arch token. The bundled
# binary for each is named `frida-server-android-<token>`.
FRIDA_ABI_MAP = {
    "arm64-v8a": "arm64",
    "armeabi-v7a": "arm",
    "armeabi": "arm",
    "x86_64": "x86_64",
    "x86": "x86",
}


def frida_server_binary(abi: str) -> Path:
    """Path to the bundled frida-server binary for an Android CPU ABI."""
    token = FRIDA_ABI_MAP.get(abi, abi)
    return FRIDA_SERVER_DIR / f"frida-server-android-{token}"
