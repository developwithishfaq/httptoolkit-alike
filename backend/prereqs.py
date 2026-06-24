"""Prerequisite detection (SPEC §3, M5).

Reports whether the host has what it needs (adb, mitmproxy CA, reachable proxy
port) so the UI can surface a clear message instead of failing silently. Pure
and cheap — safe to call on every WS connect.
"""

from __future__ import annotations

from typing import Any

from .adb import AdbOrchestrator
from .certs import CertManager
from .config import PROXY_PORT
from .netutil import firewall_hint, host_lan_ip


def gather() -> dict[str, Any]:
    adb = AdbOrchestrator()
    adb_path = adb.locate()

    certs = CertManager()
    ca_ok = certs.ca_exists()

    return {
        "adb": {
            "ok": bool(adb_path),
            "detail": adb_path or "not found — add Android platform-tools (adb) to PATH, or install Nox",
        },
        "mitmCA": {
            "ok": ca_ok,
            "detail": str(certs.pem_path) if ca_ok
            else "missing — start the backend once so mitmproxy generates it",
        },
        "hostIp": host_lan_ip(),
        "proxyPort": PROXY_PORT,
        "firewallHint": firewall_hint(PROXY_PORT),
    }
