# Subsystem: mitmproxy engine

File: [backend/engine.py](../backend/engine.py). Paths relative to repo root.

The mitmproxy addon. Its hooks run on the **same asyncio loop** as the web server,
so they broadcast flows over the WS directly. This is where rules are applied.

## file → symbol

- `Engine` — the addon, registered on the DumpMaster's addon list.
- `Engine.request(flow)` — request hook. Order:
  1. `_detag_replay` → if a replay, emit `request` and **skip rules** (a drop/pause
     rule must not kill a manual resend).
  2. `state.rules.match(flow, "request")`; no match → emit `request`.
  3. Matched action: `drop` (kill + `dropped=True`) / `mock` (set response, mark
     `nox_mocked`, emit `response` with `mocked=True`) / `mock_request` (swap body,
     mark `nox_req_mocked`, emit `request` with `reqMocked=True`) / else `pause`
     (`state.pending.add` + `flow.intercept()` + emit `paused`).
- `Engine.response(flow)` — response hook. Skips if `nox_mocked` (already produced) or
  `nox_replay`. Then `rules.match(flow, "response")`; if no match **or** the flow is in
  `state.pending` (was request-paused, already handled), emit `response`. Else apply
  `drop`/`mock`/`pause` for the response direction.
- `Engine.error(flow)` — transport error (DNS/refused/TLS). Emits with `error=...` so the
  Resend screen doesn't wait forever.
- `Engine._emit(flow, phase, **extra)` — `serialize_flow` → merge extra → `_decorate` →
  `store.upsert` → `broadcast`. **Single choke point** for every outgoing flow message.
- `Engine._decorate` — stamps `replay`/`replayToken` from `flow.metadata["nox_replay"]`.
- `Engine._detag_replay` — moves the `X-Nox-Replay` header into `flow.metadata` (so it's
  not forwarded upstream) and returns whether this flow is a replay.
- `build_master(state, broadcast)` — makes a `DumpMaster` on `PROXY_HOST:PROXY_PORT`,
  termlog/dumper off, adds the `Engine`.

## Key state

- Reads `state.rules` (match), writes `state.pending` (on pause) and `state.store`
  (every emit). `flow.metadata` keys: `nox_replay`, `nox_mocked`, `nox_req_mocked`.

## Traps

- The `pending.has(flow.id)` check in `response()` is what stops a request-paused flow
  from being re-processed by a response-direction rule.
- Mock in the **request** hook short-circuits the upstream server (mitmproxy semantics);
  in the **response** hook it replaces the real response.
- Replays bypass rules on **both** directions.

## Related

- Rule matching: [rules.md](rules.md). Edit/mock/forward/drop mechanics:
  [intercept.md](flows/intercept.md). Serialization: [protocol.md](protocol.md).
- End-to-end: [capture.md](flows/capture.md), [rules-mocking.md](flows/rules-mocking.md).
