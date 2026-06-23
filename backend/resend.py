"""Resend (replay) a request through our own proxy (SPEC §8).

The request is issued from the host straight at the target, but routed through
mitmproxy on 127.0.0.1:8080 so the Engine captures it like any other flow — it
then appears in the UI's flow list automatically, fully decrypted. A
``X-Nox-Replay`` token lets the engine tag the flow and lets the Resend screen
correlate the captured result back to the send it issued.

This works whether or not a device is connected — the proxy is always running.
"""

from __future__ import annotations

from typing import Any

import aiohttp

from .config import LOCAL_PROXY_URL, REPLAY_HEADER

# Headers aiohttp must own; passing them through breaks the replay.
_STRIP = {"content-length", "host", "connection", "transfer-encoding"}


async def resend(spec: dict[str, Any]) -> None:
    """Issue one replayed request. Raises on transport failure (caller reports).

    ``spec``: {method, url, headers: {k: v}, body: str, token: str}
    """
    method = (spec.get("method") or "GET").upper()
    url = spec.get("url") or ""
    if not url:
        raise ValueError("missing url")

    headers = {
        k: v
        for k, v in (spec.get("headers") or {}).items()
        if k and k.lower() not in _STRIP
    }
    token = spec.get("token")
    if token:
        headers[REPLAY_HEADER] = token

    body = spec.get("body")
    data = body.encode("utf-8", "ignore") if body else None

    timeout = aiohttp.ClientTimeout(total=30)
    # ssl=False: accept mitmproxy's MITM cert on the tunnel (this is an
    # inspector; we deliberately don't verify the replayed connection).
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        async with session.request(
            method,
            url,
            headers=headers,
            data=data,
            proxy=LOCAL_PROXY_URL,
            allow_redirects=False,
        ) as resp:
            await resp.read()  # drain so mitmproxy sees the full flow complete
