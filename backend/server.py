"""aiohttp web server: WebSocket hub + REST + static frontend serving.

The WebSocket at /ws is the primary channel (SPEC §9). REST at /api is a thin
secondary for status/late-join polling. In production we also serve the built
frontend from frontend/dist.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Optional

from aiohttp import WSMsgType, web

from . import intercept as intercept_mod
from . import prereqs as prereqs_mod
from . import resend as resend_mod
from .config import WEB_HOST, WEB_PORT
from .connect import ConnectController
from .netutil import host_lan_ip
from .protocol import error_msg, prereqs_msg, rules_msg, serialize_flow, status_msg
from .state import AppState

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


class Hub:
    """Tracks connected WebSocket clients and fans messages out to all."""

    def __init__(self) -> None:
        self._clients: set[web.WebSocketResponse] = set()

    def add(self, ws: web.WebSocketResponse) -> None:
        self._clients.add(ws)

    def remove(self, ws: web.WebSocketResponse) -> None:
        self._clients.discard(ws)

    async def broadcast(self, message: dict[str, Any]) -> None:
        if not self._clients:
            return
        data = json.dumps(message)
        dead: list[web.WebSocketResponse] = []
        for ws in self._clients:
            try:
                await ws.send_str(data)
            except (ConnectionResetError, RuntimeError):
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


class Server:
    """Holds the aiohttp app, hub, and the action dispatch for client messages."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self.hub = Hub()
        self.connect = ConnectController(state, self.hub.broadcast)
        self.app = web.Application()
        self._runner: Optional[web.AppRunner] = None
        self._tasks: set[asyncio.Task] = set()
        self._setup_routes()

    def _spawn(self, coro) -> None:
        """Run an orchestration coroutine in the background, keeping a ref so it
        isn't GC'd, so flows keep streaming while Connect runs."""
        task = asyncio.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    # --- routing -----------------------------------------------------------

    def _setup_routes(self) -> None:
        self.app.router.add_get("/ws", self._ws_handler)
        self.app.router.add_get("/api/status", self._status_handler)
        self.app.router.add_get("/api/flows", self._flows_handler)
        self.app.router.add_get("/api/prereqs", self._prereqs_handler)
        if FRONTEND_DIST.exists():
            self.app.router.add_get("/", self._index_handler)
            self.app.router.add_static("/", FRONTEND_DIST, show_index=False)

    # --- REST --------------------------------------------------------------

    async def _status_handler(self, request: web.Request) -> web.Response:
        return web.json_response(self.state.conn.to_dict())

    async def _flows_handler(self, request: web.Request) -> web.Response:
        try:
            limit = int(request.query.get("limit", "200"))
        except ValueError:
            limit = 200
        return web.json_response(self.state.store.recent(limit))

    async def _prereqs_handler(self, request: web.Request) -> web.Response:
        return web.json_response(prereqs_mod.gather())

    async def _index_handler(self, request: web.Request) -> web.FileResponse:
        return web.FileResponse(FRONTEND_DIST / "index.html")

    # --- WebSocket ---------------------------------------------------------

    async def _ws_handler(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self.hub.add(ws)

        # Initial sync: current state, recent flows, rules.
        await ws.send_str(json.dumps(
            status_msg("ws_connected", True, "WebSocket connected", self.state.conn.to_dict())
        ))
        for flow in self.state.store.recent(500):
            await ws.send_str(json.dumps(flow))
        await ws.send_str(json.dumps(rules_msg(self.state.rules.list)))
        await ws.send_str(json.dumps(prereqs_msg(prereqs_mod.gather())))

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    await self._handle_action(ws, msg.data)
                elif msg.type == WSMsgType.ERROR:
                    break
        finally:
            self.hub.remove(ws)
        return ws

    async def _handle_action(self, ws: web.WebSocketResponse, raw: str) -> None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            await ws.send_str(json.dumps(error_msg("invalid JSON")))
            return

        action = payload.get("action")

        if action == "clear":
            self.state.store.clear()
            await self.hub.broadcast({"type": "cleared"})

        elif action == "set_rules":
            self.state.rules.set(payload.get("rules", []))
            await self.hub.broadcast(rules_msg(self.state.rules.list))

        elif action == "connect":
            self._spawn(self.connect.connect())

        elif action == "disconnect":
            self._spawn(self.connect.disconnect())

        elif action == "reboot_device":
            self._spawn(self.connect.reboot_device())

        elif action == "forward":
            await self._forward(ws, payload.get("id"), payload.get("edits"))

        elif action == "drop":
            await self._drop(ws, payload.get("id"))

        elif action == "resend":
            self._spawn(self._resend(ws, payload.get("request")))

        elif action == "check_prereqs":
            await ws.send_str(json.dumps(prereqs_msg(prereqs_mod.gather())))

        else:
            await ws.send_str(json.dumps(error_msg(f"unknown action: {action}")))

    # --- intercept forward/drop (M4) --------------------------------------

    async def _forward(self, ws, flow_id, edits) -> None:
        flow = self.state.pending.pop(flow_id) if flow_id else None
        if flow is None:
            await ws.send_str(json.dumps(error_msg(f"no paused flow: {flow_id}")))
            return
        intercept_mod.forward(flow, edits)
        # Clear the paused badge immediately; the response hook will follow up
        # with the final response for request-pauses.
        phase = "response" if flow.response is not None else "request"
        serialized = serialize_flow(flow, phase)
        self.state.store.upsert(serialized)
        await self.hub.broadcast(serialized)

    async def _drop(self, ws, flow_id) -> None:
        flow = self.state.pending.pop(flow_id) if flow_id else None
        if flow is None:
            await ws.send_str(json.dumps(error_msg(f"no paused flow: {flow_id}")))
            return
        intercept_mod.drop(flow)
        serialized = serialize_flow(flow, "response")
        serialized["dropped"] = True
        self.state.store.upsert(serialized)
        await self.hub.broadcast(serialized)

    # --- resend / replay (SPEC §8) ----------------------------------------

    async def _resend(self, ws, spec) -> None:
        if not spec or not spec.get("url"):
            await ws.send_str(json.dumps(error_msg("resend: missing url")))
            return
        try:
            await resend_mod.resend(spec)
        except Exception as exc:  # noqa: BLE001 — surface any transport failure
            token = spec.get("token")
            suffix = f" [{token}]" if token else ""
            await ws.send_str(json.dumps(error_msg(f"resend failed: {exc}{suffix}")))

    # --- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        self._runner = web.AppRunner(self.app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, WEB_HOST, WEB_PORT)
        await site.start()
        served = "  (serving frontend/dist)" if FRONTEND_DIST.exists() else ""
        print(f"[web] http://{WEB_HOST}:{WEB_PORT}  ws://{WEB_HOST}:{WEB_PORT}/ws{served}")
        print(f"[web] host LAN IP for emulator proxy: {host_lan_ip()}")

    async def stop(self) -> None:
        if self._runner:
            await self._runner.cleanup()
