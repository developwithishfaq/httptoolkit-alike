# Flow: passive capture (request → UI row)

What runs when a device makes an HTTP(S) request through the proxy and it appears in the
UI. Paths relative to repo root.

## Call chain

1. Device's traffic hits mitmproxy on `0.0.0.0:51080` (proxy set by
   [connect.py](../../backend/connect.py); see [connect.md](connect.md)).
2. `Engine.request(flow)` ([engine.py](../../backend/engine.py)) — not a replay, no
   matching rule → `_emit(flow, "request")`.
3. `Engine._emit` → `serialize_flow(flow, "request")` ([protocol.py](../../backend/protocol.py))
   → `state.store.upsert(serialized)` ([state.py](../../backend/state.py)) →
   `broadcast(serialized)` (the `Hub.broadcast` from [server.py](../../backend/server.py)).
4. Server fans the `flow` message to every WS client.
5. Frontend `ws.handleMessage` ([ws.ts](../../frontend/src/ws.ts)) → `store.upsertFlow(msg)`.
6. Upstream server responds → `Engine.response(flow)` → `_emit(flow, "response")` (now with
   `status`, `respHeaders`, body, `durationMs`) → same broadcast path → `upsertFlow` merges
   onto the same id (updated **in place**).
7. `FlowList` re-renders the row; `FlowDetail` shows it if selected
   (see [frontend-components.md](../frontend-components.md) _(debt)_).

## Branch conditions

- Replay flows (`X-Nox-Replay` header) skip rules — see [resend.md](resend.md).
- A matching rule diverts to drop/mock/mock_request/pause — see
  [rules-mocking.md](rules-mocking.md) and [intercept.md](intercept.md).
- `Engine.error(flow)` emits with an `error` field on transport failure.
- Late-joining UI gets the last 500 flows on WS connect (`_ws_handler` initial sync).

## Gotchas

- The store key is `flow.id`; request and response phases are the **same row**.
- `capturePaused` in the frontend store drops *new* ids only (toolbar pause), backend
  keeps capturing regardless.
- Bodies are truncated at 256 KiB and binary bodies are omitted (size only) — see
  [protocol.md](../protocol.md).
