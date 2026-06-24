# Subsystem: backend web/WS server

File: [backend/server.py](../backend/server.py). Paths relative to repo root.

aiohttp app hosting the WebSocket hub (primary channel), thin REST, and (in
prod) the static frontend. Owns the client→server action dispatch.

## file → symbol

- `Hub` — set of connected `WebSocketResponse`s; `broadcast(msg)` fans a dict to all,
  dropping dead sockets. The Engine and ConnectController call `hub.broadcast`.
- `Server.__init__` — builds `web.Application`, the `Hub`, a `ConnectController`, and a
  `FridaController` (passed the ConnectController so it reuses its adb), all wired to
  `hub.broadcast`. Holds `state: AppState`.
- `Server._setup_routes` — `/ws`, `/api/status`, `/api/flows`, `/api/prereqs`; and
  `/` + static mount of `FRONTEND_DIST` **only if it exists**.
- `Server._spawn` — fire-and-forget background task with a strong ref (so Connect/resend
  keep running while flows stream).
- `Server._ws_handler` — accepts a WS, sends **initial sync** (status, recent 500 flows,
  rules, prereqs, **frida** state), then loops on incoming TEXT → `_handle_action`.
- `Server._handle_action` — the dispatch table. Actions: `clear`, `set_rules`,
  `connect` (device link), `intercept_traffic` (device-wide capture), `stop_intercept`,
  `disconnect`, `reboot_device`, `forward`, `drop`, `resend`, `check_prereqs`, and the
  Frida set `frida_start`, `frida_list_apps`, `frida_intercept` (`{package}`),
  `frida_stop` → `FridaController` (see [frida.md](frida.md), [flows/frida.md](flows/frida.md)).
  The Intercept-screen features map 1:1 to these: Connect=`connect`, Intercept
  traffic=`intercept_traffic`/`stop_intercept`, Frida=`frida_*`.
- `Server._forward` / `_drop` — pop the paused flow from `state.pending`, call
  `intercept_mod.forward/drop`, re-serialize, upsert, broadcast.
- `Server._resend` — validates spec has a url, calls `resend_mod.resend`; surfaces
  transport failures as `error` messages (with the replay token in brackets).
- `Server.start` / `stop` — `AppRunner` + `TCPSite` on `WEB_HOST:WEB_PORT`.
- `_frontend_dist()` / `FRONTEND_DIST` — resolves the built frontend: `NOX_FRONTEND_DIST`
  env → frozen `_MEIPASS/frontend/dist` → repo `../frontend/dist`.

## Key state

- `Hub._clients` — live sockets.
- Everything else flows through `self.state` ([state.py](backend-state.md)).

## Traps

- `_setup_routes` only mounts static + `/` when `FRONTEND_DIST.exists()` — running
  from source without a built frontend means `/` 404s (use the Vite dev server then).
- Initial sync sends the last **500** flows on connect even though the store holds up
  to `FLOW_STORE_MAX` (5000).
- `_forward`/`_drop` send an `error` (not a crash) when the flow id isn't paused —
  e.g. a double-click after it already resumed.

## Related

- Dispatch targets: [intercept.md](flows/intercept.md), [connect.md](flows/connect.md),
  [resend.md](flows/resend.md).
- Message shapes: [protocol.md](protocol.md).
