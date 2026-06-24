# Flow: rule actions (drop / mock / mock_request)

What runs when a flow matches an enabled rule, for the non-pause actions. (Pause is in
[intercept.md](intercept.md).) Paths relative to repo root.

## Entry

- `Server._handle_action` `set_rules` persists rules via `state.rules.set` and broadcasts
  `rules_msg`. Matching happens later in the engine.
- `Engine.request` / `Engine.response` ([engine.py](../../backend/engine.py)) call
  `state.rules.match(flow, direction)` → `rules.first_match` ([rules.md](../rules.md)).

## Actions (request hook)

- **drop** → `intercept_mod.drop(flow)`; emit `request` with `dropped=True`. Never reaches
  the server.
- **mock** → `intercept_mod.mock_response(flow, rule["mock"])` sets `flow.response` →
  mitmproxy **short-circuits the upstream server**; mark `flow.metadata["nox_mocked"]`; emit
  `response` with `mocked=True`. The response hook sees `nox_mocked` and just re-emits.
- **mock_request** → `intercept_mod.set_request_body(flow, rule["mockReqBody"])` swaps the
  outgoing body (Content-Length recomputed), **forwards to the server**; mark
  `nox_req_mocked`; emit `request` with `reqMocked=True`. The real response comes back
  through `Engine.response`.
- **pause** → [intercept.md](intercept.md).

## Actions (response hook)

- Skips if `nox_mocked` (already produced) or `nox_replay`.
- `rules.match(flow, "response")`; if no match **or** flow is in `state.pending`
  (request-paused, already handled) → plain `response`.
- **drop** / **mock** (replaces the real response) / **pause** otherwise.

## file → symbol (intercept.py)

- `mock_response(flow, spec)` — `Response.make(status, body, headers)`; defaults status 200.
- `set_request_body(flow, body)` — `flow.request.text = body`.
- `drop(flow)` — see [intercept.md](intercept.md).

## Gotchas

- `nox_mocked` is the guard that stops the response hook from re-processing a request-hook mock.
- mock in the request hook = no server contact; mock in the response hook = replace real response.
- A malformed `urlRegex` simply never matches (won't crash the hook) — see [rules.md](../rules.md).

## Related

- [backend-engine.md](../backend-engine.md), [rules.md](../rules.md),
  [intercept.md](intercept.md).
