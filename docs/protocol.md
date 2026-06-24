# Subsystem: wire protocol (serialization)

Files: [backend/protocol.py](../backend/protocol.py) (producer) +
[frontend/src/types.ts](../frontend/src/types.ts) (consumer). Paths relative to repo root.

The two halves of one contract. **Change them together.** WS is primary; every
server→client message has a `type`, every client→server message has an `action`.

## file → symbol (backend)

- `serialize_flow(flow, phase)` — mitmproxy `HTTPFlow` → wire `flow` dict.
  `phase ∈ {"request","paused","response"}`. Always includes method/scheme/host/path/url
  + `reqHeaders`. Body via `_body_text`; adds response fields + `durationMs` when
  `flow.response` is set.
- `headers_to_dict(headers)` — flatten mitmproxy `Headers`; duplicate keys joined with `", "`.
- `_body_text(message)` → `(text, is_binary, truncated)`. Binary/undecodable → `text=None`,
  reports size instead. Truncates past `MAX_BODY_BYTES` (256 KiB).
- Control builders: `status_msg(step, ok, message, state)`, `rules_msg(rules)`,
  `prereqs_msg(prereqs)`, `error_msg(message)`.

## file → symbol (frontend types)

- `Flow`, `FlowPhase`, `ConnState`, `StatusMsg`, `Rule`/`RuleMatch`/`RuleAction`/`MockResponse`,
  `Prereqs`/`PrereqCheck`, `ServerMsg` (union of all `type`s), `ClientAction` (union of all
  `action`s).

## Wire vocabulary

- Server→client `type`: `flow`, `status`, `rules`, `prereqs`, `error`, `cleared`.
- Client→server `action`: `connect`, `disconnect`, `reboot_device`, `clear`, `set_rules`,
  `forward`, `drop`, `resend`, `check_prereqs`.
- Flow flags layered on by the engine/server: `dropped`, `mocked`, `reqMocked`, `error`,
  `replay`, `replayToken`.

## Traps

- Editing a flow field, status step, or action **must** be reflected in both files or the
  UI silently drops it (the `ws.ts` switch / type union won't match).
- `headers_to_dict` is **lossy for ordering** and joins duplicates — the UI gets a flat
  map, not ordered pairs. (The Resend seed in [store.ts](../frontend/src/store.ts) keeps
  pairs separately.)
- Truncated bodies set `reqTruncated`/`respTruncated`; binary bodies omit the body and set
  `reqBinary`/`respBinary`.

## Related

- [backend-engine.md](backend-engine.md) (who calls `serialize_flow`),
  [frontend-state.md](frontend-state.md) (who consumes `ServerMsg`).
