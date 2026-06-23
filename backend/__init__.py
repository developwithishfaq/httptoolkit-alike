"""Nox Traffic Inspector & Interceptor — backend package.

A single asyncio process that runs the mitmproxy proxy, an aiohttp web/WS
server, and the adb/cert orchestration. See SPEC.md for the full design.
"""

__version__ = "0.1.0"
