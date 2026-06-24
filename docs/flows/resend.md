# Flow: resend (replay a request)

What runs when the user replays a request from the Resend screen. The request is issued
from the host but routed through our own proxy so it's captured like any other flow. Paths
relative to repo root.

## Call chain

1. UI builds a `ResendSeed`/request and sends `{action:"resend", request:{method,url,headers,
   body, token}}` ([store.ts](../../frontend/src/store.ts), `ws.sendAction`).
2. `Server._handle_action` → `self._spawn(self._resend(ws, request))`
   ([server.py](../../backend/server.py)). Missing url → `error_msg`.
3. `resend_mod.resend(spec)` ([resend.py](../../backend/resend.py)):
   - strips host-owned headers (`content-length, host, connection, transfer-encoding`),
   - adds `X-Nox-Replay: <token>` header,
   - `aiohttp` request **through `LOCAL_PROXY_URL` (127.0.0.1:51080)**, `ssl=False`,
     `allow_redirects=False`, drains the response so mitmproxy sees the full flow.
4. mitmproxy receives it → `Engine.request` ([engine.py](../../backend/engine.py)) →
   `_detag_replay` moves the token to `flow.metadata["nox_replay"]`, **skips rules**, emits.
   `_decorate` stamps `replay:true` + `replayToken` on the wire flow.
5. Frontend `upsertFlow` stores it; `selectByReplayToken(token)` correlates the captured
   result back to the Resend screen.

## Branch conditions

- Replays bypass rules on **both** request and response hooks (a drop/pause rule can't kill
  a deliberate manual resend).
- Transport failure → `Engine.error` emits with `error`, **and** `Server._resend` catches the
  aiohttp exception and sends an `error_msg` (with the token in brackets).

## Gotchas

- Works whether or not a device is connected — the proxy is always running.
- `ssl=False` is deliberate: we accept mitmproxy's MITM cert on the replay tunnel.
- The `X-Nox-Replay` header is stripped before the request reaches the real server.

## Related

- [backend-engine.md](../backend-engine.md) (`_detag_replay`/`_decorate`),
  [frontend-state.md](../frontend-state.md) (`selectByReplayToken`, `ResendSeed`).
