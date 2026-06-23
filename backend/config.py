"""Central configuration constants for the backend.

Keep this dependency-free so every other module can import it cheaply.
"""

from __future__ import annotations

import os
from pathlib import Path

# --- Network ---------------------------------------------------------------

# mitmproxy listener. Must bind 0.0.0.0 so the Nox emulator can reach it over
# the virtual network (see SPEC §7.4).
PROXY_HOST = "0.0.0.0"
PROXY_PORT = 8080

# aiohttp web + WebSocket server. Localhost only — the UI runs on the host.
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
