# Subsystem: frontend state + transport

Files: [frontend/src/store.ts](../frontend/src/store.ts) (zustand store),
[frontend/src/ws.ts](../frontend/src/ws.ts) (WS client),
[frontend/src/types.ts](../frontend/src/types.ts) (wire types). Paths relative to repo root.

Single source of UI truth + the one socket that feeds it. Components are thin: read via
`useStore` selectors, write via `sendAction`.

## file → symbol (store.ts)

- `useStore` — the zustand store. Holds transport (`wsConnected`, `conn`, `lastStatus`,
  `steps`, `connecting`), flows (`flows: Map<id,Flow>`, `order: string[]`, `selectedId`),
  and UI (`mainView`, `autoscroll`, `capturePaused`, `filters`, `rules`, `rulesOpen`,
  `ruleSeed`, `interceptId`, `prereqs`, `diagOpen`, `resendOpen`, `resendSeed`).
- `upsertFlow(f)` — merge into the Map; when `capturePaused`, ignore **new** flows but
  still update existing ones; trims to `MAX_FLOWS` (5000).
- `setStatus(s)` — records `lastStatus`; if the step is a Connect-checklist step, updates
  `steps[step]`, clears `connecting` on terminal (success on `connected`, or any failure),
  and **auto-switches `mainView` to "view"** on successful `connected`.
- `CONNECT_STEPS` / `STEP_KEYS` — ordered checklist keys mirroring
  [connect.py](../backend/connect.py)'s `_emit` step names.
- Selectors: `selectVisibleFlows` (applies `filters`), `selectPending` (phase `paused`,
  the intercept queue), `selectByReplayToken(token)` (Resend result correlation).
- `ResendSeed` — prefill for the Resend screen (headers kept as ordered pairs).

### Filtering (advanced, multi-field)

- `Filters` = `{ text, method, statusClass, scopes }`. `scopes:
  Record<FilterScope,boolean>` toggles **which fields** `text` scans —
  `FilterScope = "url" | "headers" | "reqBody" | "respBody"`, all on by default
  (`DEFAULT_SCOPES`). `text` matches across the **enabled** scopes (URL incl. method +
  status, request + response headers, request + response bodies), not just host/path.
- `matchedScope(f, text, scopes)` — pure predicate returning the **first** enabled scope
  the (already trimmed+lowercased) `text` hits, else `null`. Probed cheap→expensive
  (url → headers → reqBody → respBody) with early-exit; skips binary bodies. Used by
  `selectVisibleFlows` (`!== null` ⇒ keep) **and** by `FlowList` rows to render the
  "matched in header/body" badge. Single source of truth for "does this flow match".
- `toggleScope(scope)` flips one scope but **never lets all four go off** (re-enables the
  one just toggled) — a text query with zero scopes would silently hide everything.
- `resetFilters()` clears text/method/statusClass and restores `DEFAULT_SCOPES`.
- `filtersActive(filters)` — true when anything diverges from "show everything"; drives the
  toolbar's active-filter dot and the popover's Reset enablement.
- `SCOPE_LABELS` — ordered `{key,label}` for rendering the scope chips.

## file → symbol (ws.ts)

- `connectWs()` — opens the socket (`wss` if https), sets `wsConnected`, auto-reconnects
  with exponential backoff (500ms → 5s).
- `handleMessage(raw)` — the server→client router: `flow→upsertFlow`, `status→setConn+setStatus`,
  `rules→setRules`, `prereqs→setPrereqs`, `cleared→clearFlows`, `error→setStatus(error)`.
- `sendAction(action)` — JSON-send a `ClientAction` if the socket is open.
- `wsUrl()` — built from `location.host` (works against any serving origin).

## Traps

- `mainView` flips to `"view"` automatically on a successful connect — UI navigation
  side-effect lives in `setStatus`, not a component.
- `capturePaused` only blocks **new** flow ids; updates to already-shown flows still apply.
- The `steps`/`STEP_KEYS` set must stay aligned with backend `_emit` step names in
  [connect.py](../backend/connect.py), or checklist rows won't light up.

## Related

- Message shapes / contract: [protocol.md](protocol.md).
- Screens that consume this: [frontend-components.md](frontend-components.md) _(debt)_.
- Flows that drive it: [connect.md](flows/connect.md), [capture.md](flows/capture.md),
  [resend.md](flows/resend.md), [intercept.md](flows/intercept.md).
