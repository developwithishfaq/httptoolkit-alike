# Subsystem: rule matching

File: [backend/rules.py](../backend/rules.py). Rule shape: [types.ts](../frontend/src/types.ts)
(`Rule`). Persistence: `Rules` in [state.py](backend-state.md). Paths relative to repo root.

Answers "does this flow match an enabled rule for this direction?". **Matching only** —
what a matched rule *does* is in [engine.py](backend-engine.md) /
[intercept.py](flows/intercept.md).

## file → symbol

- `rule_matches(rule, flow, direction)` — True iff: `rule.enabled`, `rule.direction == direction`,
  and every provided criterion in `rule.match` matches:
  - `method` (skip if absent or `"any"`; case-insensitive),
  - `hostContains` (substring of `pretty_host`, case-insensitive),
  - `urlRegex` (`re.search` on `pretty_url`; **malformed regex never matches**, never crashes).
- `first_match(rules, flow, direction)` — first enabled matching rule **in list order**
  (order = priority).

## Rule shape (wire)

```
{ id, name, enabled, direction: "request"|"response",
  action: "pause"|"drop"|"mock"|"mock_request",
  match: { method?, hostContains?, urlRegex? },
  mock?: { status?, headers?, body? },     // for action "mock"
  mockReqBody?: string }                    // for action "mock_request"
```

## Traps

- A criterion that's absent/empty is **not** a constraint (matches anything). An empty
  `match` matches every flow in that direction.
- Direction matters: a `request` rule never fires in the response hook and vice-versa.
- The action field is read by the engine, not here — this module is pure predicate.

## Related

- Action semantics + hooks: [backend-engine.md](backend-engine.md),
  [rules-mocking.md](flows/rules-mocking.md). Edit panel UI:
  [frontend-components.md](frontend-components.md) _(debt)_.
