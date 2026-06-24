"""mitmproxy Engine addon + DumpMaster setup.

The addon's hooks run on the same asyncio loop as the web server, so they can
broadcast flows over the WebSocket directly. M0–M2 implement passive capture
(request/response broadcast); the pause path is scaffolded for M4.
"""

from __future__ import annotations

from typing import Awaitable, Callable

from mitmproxy.options import Options
from mitmproxy.tools.dump import DumpMaster

from . import intercept as intercept_mod
from .config import PROXY_HOST, PROXY_PORT, REPLAY_HEADER
from .protocol import serialize_flow
from .state import AppState

# A broadcast function: takes a JSON-able dict, fans it out to all WS clients.
Broadcast = Callable[[dict], Awaitable[None]]


class Engine:
    """mitmproxy addon. Registered on the DumpMaster's addon list."""

    def __init__(self, state: AppState, broadcast: Broadcast) -> None:
        self.state = state
        self.broadcast = broadcast

    def _decorate(self, serialized: dict, flow) -> None:
        """Stamp replay metadata onto an outgoing flow message, if present."""
        token = flow.metadata.get("nox_replay")
        if token:
            serialized["replay"] = True
            serialized["replayToken"] = token

    async def _emit(self, flow, phase: str, **extra) -> None:
        serialized = serialize_flow(flow, phase)
        serialized.update(extra)
        self._decorate(serialized, flow)
        self.state.store.upsert(serialized)
        await self.broadcast(serialized)

    def _detag_replay(self, flow) -> bool:
        """Move the replay token from header to flow metadata. Returns True if
        this flow is a replay (so rules are skipped and it isn't re-sent)."""
        token = flow.request.headers.get(REPLAY_HEADER)
        if not token:
            return False
        del flow.request.headers[REPLAY_HEADER]  # don't forward it to the server
        flow.metadata["nox_replay"] = token
        return True

    async def request(self, flow) -> None:
        # Replayed requests (from the Resend screen) bypass rules so a drop/pause
        # rule can't kill or stall a deliberate manual resend.
        if self._detag_replay(flow):
            await self._emit(flow, "request")
            return

        rule = self.state.rules.match(flow, "request")
        if rule is None:
            await self._emit(flow, "request")
            return

        action = rule.get("action", "pause")
        if action == "drop":
            intercept_mod.drop(flow)
            await self._emit(flow, "request", dropped=True)
        elif action == "mock":
            # Setting flow.response short-circuits the upstream server; mark the
            # flow so the response hook doesn't re-process it.
            intercept_mod.mock_response(flow, rule.get("mock") or {})
            flow.metadata["nox_mocked"] = True
            await self._emit(flow, "response", mocked=True)
        elif action == "mock_request":
            # Swap in a fixed request body and let the request continue to the
            # server (no pause). The response hook later emits the response.
            intercept_mod.set_request_body(flow, rule.get("mockReqBody") or "")
            flow.metadata["nox_req_mocked"] = True
            await self._emit(flow, "request", reqMocked=True)
        else:  # "pause" — intercept for manual edit
            self.state.pending.add(flow)
            flow.intercept()
            await self._emit(flow, "paused")

    async def response(self, flow) -> None:
        # A mocked flow already produced its response in the request hook.
        if flow.metadata.get("nox_mocked"):
            await self._emit(flow, "response", mocked=True)
            return

        # Replays bypass rules on both directions (matches the request hook).
        if flow.metadata.get("nox_replay"):
            await self._emit(flow, "response")
            return

        rule = self.state.rules.match(flow, "response")
        if rule is None or self.state.pending.has(flow.id):
            await self._emit(flow, "response")
            return

        action = rule.get("action", "pause")
        if action == "drop":
            intercept_mod.drop(flow)
            await self._emit(flow, "response", dropped=True)
        elif action == "mock":
            intercept_mod.mock_response(flow, rule.get("mock") or {})
            await self._emit(flow, "response", mocked=True)
        else:  # "pause" — edit the response before it reaches the app
            self.state.pending.add(flow)
            flow.intercept()
            await self._emit(flow, "paused")

    async def error(self, flow) -> None:
        # A connection/transport error (DNS, refused, TLS). Surface it so the UI
        # — especially the Resend screen — doesn't wait forever on a dead flow.
        phase = "response" if flow.response is not None else "request"
        await self._emit(flow, phase, error=str(flow.error) if flow.error else "error")


async def build_master(state: AppState, broadcast: Broadcast) -> DumpMaster:
    """Create a DumpMaster bound to PROXY_HOST:PROXY_PORT (0.0.0.0:51080) with our Engine addon.

    The listener must bind 0.0.0.0 so the Nox emulator can reach it (SPEC §7.4).
    Termlog/dumper are disabled — we have our own UI.
    """
    opts = Options(listen_host=PROXY_HOST, listen_port=PROXY_PORT)
    master = DumpMaster(opts, with_termlog=False, with_dumper=False)
    master.addons.add(Engine(state, broadcast))
    return master
