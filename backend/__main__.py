"""Entrypoint: one asyncio loop running the proxy + web/WS server together.

    python -m backend

Builds the aiohttp server, starts the mitmproxy DumpMaster, wires the Engine's
broadcast to the WS hub, and gathers them. Clean shutdown on Ctrl+C clears the
device proxy (M3) and stops both services.
"""

from __future__ import annotations

import asyncio

from .config import PROXY_HOST, PROXY_PORT, WEB_PORT
from .engine import build_master
from .netutil import host_lan_ip, is_port_free
from .server import Server
from .state import AppState


async def amain() -> None:
    state = AppState()

    # Reflect static facts into the connection state for the UI.
    state.conn.hostProxy = f"{host_lan_ip()}:{PROXY_PORT}"

    server = Server(state)
    master = await build_master(state, server.hub.broadcast)

    # The proxy is up as soon as the master runs; mitmproxy generates the CA on
    # this first run, which M3's cert step depends on (SPEC §7.2).
    state.conn.proxyRunning = True

    if not is_port_free("127.0.0.1", WEB_PORT):
        print(f"[warn] web port {WEB_PORT} appears busy; another instance running?")

    await server.start()
    print(f"[proxy] mitmproxy listening on {PROXY_HOST}:{PROXY_PORT} (0.0.0.0 reachable by Nox)")
    print("[ready] set the Nox proxy + install the CA manually for M1, or use Connect in M3.")

    try:
        # DumpMaster.run() drives the proxy on this loop; the web site is
        # already running via its AppRunner/TCPSite.
        await master.run()
    finally:
        # Clean shutdown: clear the device proxy so the emulator isn't left
        # pointing at a dead host, tear down any Frida session/server, then stop
        # the web site (SPEC §10).
        await server.connect.clear_device_proxy()
        await server.frida.shutdown()
        await server.stop()


def main() -> None:
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        print("\n[shutdown] bye")


if __name__ == "__main__":
    main()
