# Flow: intercept (pause → edit → forward/drop)

What runs when a rule pauses a flow and the user edits then forwards/drops it. Paths
relative to repo root.

## Pause (entry)

1. `Engine.request` or `Engine.response` ([engine.py](../../backend/engine.py)) matches a
   rule with action `pause` → `state.pending.add(flow)` + `flow.intercept()` +
   `_emit(flow, "paused")`.
2. Frontend `upsertFlow` stores it with `phase:"paused"`; `selectPending`
   ([store.ts](../../frontend/src/store.ts)) surfaces it in the intercept queue; the
   `InterceptEditor` opens (`interceptId`).

## Forward (resume with edits)

3. UI sends `{action:"forward", id, edits}` → `Server._forward` ([server.py](../../backend/server.py)):
   `flow = state.pending.pop(id)`; if None → `error_msg`.
4. `intercept_mod.forward(flow, edits)` ([intercept.py](../../backend/intercept.py)):
   - request paused (`flow.response is None`) → `apply_request_edits` (method/url/headers/body;
     setting `request.text` fixes Content-Length),
   - response paused → `apply_response_edits` (status/headers/body),
   - then `flow.resume()`.
5. Server re-serializes (`phase = "response" if flow.response else "request"`), `store.upsert`,
   `broadcast`. For a request-pause, the real response arrives later via `Engine.response`.

## Drop

3'. UI sends `{action:"drop", id}` → `Server._drop` → `intercept_mod.drop(flow)`:
   `flow.kill()` if killable (sets error + `intercepted=False`), else set `flow.error`.
   **`kill()` does not fire the resume event**, so drop explicitly sets `_resume_event`
   (or calls `resume()`) to release `wait_for_resume()`. Broadcast carries `dropped=True`.

## file → symbol (intercept.py)

- `forward`, `drop`, `apply_request_edits`, `apply_response_edits`, `_apply_headers`
  (replaces **all** headers, latin-1 encoded), `set_request_body`, `mock_response`.

## Branch conditions

- Request-pause vs response-pause decided by `flow.response is None`.
- `_apply_headers` only runs when `edits["headers"]` is a dict; missing keys are left as-is.

## Gotchas

- Popping from `state.pending` is what prevents a double forward/drop; a stale id →
  `error_msg`, not a crash.
- Editing body via `request.text`/`response.text` recomputes Content-Length automatically.
- `set_request_body` / `mock_response` here are also used by rule actions (no pause) —
  see [rules-mocking.md](rules-mocking.md).

## Related

- [backend-engine.md](../backend-engine.md), [backend-state.md](../backend-state.md)
  (`PendingFlows`), editor UI [frontend-components.md](../frontend-components.md) _(debt)_.
