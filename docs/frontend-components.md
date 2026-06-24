# Subsystem: frontend screens & components

React + Tailwind components under [frontend/src/components/](../frontend/src/components/),
plus [frontend/src/util.ts](../frontend/src/util.ts). Paths relative to repo root.
Components are **thin**: state lives in [store.ts](../frontend/src/store.ts)
([frontend-state.md](frontend-state.md)), transport in `ws.ts`. Wire types in
[types.ts](../frontend/src/types.ts) ([protocol.md](protocol.md)).

## Layout shell — `App.tsx`

- `App` — left `Sidebar` rail + a main column. Main column shows a "disconnected" banner
  when `!wsConnected`, then switches on `mainView`: `"intercept"` → `InterceptScreen`;
  `"view"` → `FlowList` (left) + `FlowDetail` (right). `RulesPanel` / `InterceptEditor` /
  `ResendScreen` / `Diagnostics` are always mounted as overlays (self-gate on their store
  flags). Calls `connectWs()` once on mount.

## Left rail — `Sidebar.tsx`

- `Sidebar` — fixed 68px icon rail. Items: **Intercept** (`setMainView("intercept")`),
  **View** (`setMainView("view")`), **Modify** (`setRulesOpen(true)`), **Send**
  (`openResend()`), **Status** (`setDiagOpen(true)`). `closeAll()` shuts every overlay
  before switching base screen. Base items (Intercept/View) only show active when **no
  overlay** is open (`noOverlay`). Intercept item shows an amber dot when `prereqs` report
  adb/CA problems.
- `RailItem` — icon over label; active = `bg-rail-active` + left `bg-brand` bar.

## Traffic list — `FlowList.tsx`

The View screen's left pane: virtualized flow table + bottom filter bar.

- `FlowList` — subscribes to `flows`/`order`/`filters`/`selectedId`/`autoscroll`. Computes
  `visible = selectVisibleFlows(...)`. **Manual windowed virtualization** (not a lib):
  fixed `ROW_H = 33`, `OVERSCAN = 8`; tracks `scrollTop`+`viewport` (ResizeObserver) and
  renders only the `slice` via a `translateY` spacer. **Stick-to-bottom autoscroll**: the
  `onScroll` handler flips `autoscroll` off the moment the user scrolls up, back on at the
  bottom — so new flows only yank you down while you're already at the end.
- Row rendering: left category stripe = `categoryColor(host)`; method/status colored via
  `util`; paused rows amber + `setInterceptId` on click (vs `select`); aborted flows
  (`error && !host`) render an italic placeholder row. Icons: ⏸ paused, ⟳ replay, ✎
  request-body-mocked, ◆ response mocked. Source icon from `sourceFromUA(reqHeaders)`.
  **Match badge**: when a search is active and the hit was in a hidden field, the row shows
  an amber `header` / `req body` / `resp body` pill (from `matchedScope`, skipping `url`
  since the URL is already on screen).
- `FilterBar` (bottom) — the **advanced filter** UI:
  - Search `<input>` with a leading `Search` icon and a trailing clear (×). Placeholder
    reflects the active scopes (`Search URL, headers & bodies…`).
  - **Filters** button toggling `FiltersPopover`; shows an accent dot when
    `filtersActive(filters)`.
  - Count: `shown / total requests` when filtered, else just `shown`.
  - Tool buttons: pause/resume capture, autoscroll toggle, Save/Open (disabled —
    "coming soon"), Clear all (`sendAction({action:"clear"})`).
- `FiltersPopover` — opens **upward** (`bottom-full`) from the Filters button. Three chip
  groups: **Search in** (the 4 `SCOPE_LABELS`, multi-select via `toggleScope`), **Method**
  (`Any` + `METHODS`, single-select; clicking the active one clears it), **Status** (`Any`
  + `STATUS_CLASSES` `2xx…5xx`). **Reset filters** button (`resetFilters`, disabled when
  not `dirty`). Closes on outside-click (mousedown) or `Escape` via a `useEffect`.
- `Chip` — pill toggle; active = `bg-accent text-white`, idle = `bg-paper-100`.
- The actual matching/filtering rules (scopes, early-exit, the "can't disable all scopes"
  guard) live in the store — see [frontend-state.md](frontend-state.md) §Filtering.

## Detail pane — `FlowDetail.tsx`

- `FlowDetail` — right pane (fixed `w-[44%]`). Empty state when nothing selected. Top
  action row: full URL, **Intercept** (`openRulesWith(ruleFromFlow(flow))`), **cURL** copy
  (`toCurl`, 1.5s "Copied"), **resend** (`openResend(...)` seeded from the flow), close.
  Body: collapsible **REQUEST** and **RESPONSE** `Card`s.
- Helper components: `Card` (collapsible, colored label + right slot), `Field`
  (label:value row), `Section` (collapsible HEADERS/BODY/QUERY), `QuerySection`
  (`parseQuery` of the URL), `HeadersSection`/`KvTable` (key/value table), `BodySection`/
  `BodyView` (binary → "not displayed"; JSON → pretty/raw toggle via `tryPrettyJson`;
  shows truncated marker).

## Shared helpers — `util.ts`

- `fmtTime` / `fmtSize` / `fmtDuration` — display formatters.
- `methodColor` / `statusColor` — Tailwind text-color classes by method / status class.
- `categoryColor(host)` — stable per-host HSL hue for the row stripe (hash of host).
- `sourceFromUA(headers)` — guesses `chrome | android | node | generic` from User-Agent.
- `tryPrettyJson(body, contentType)` — pretty-print JSON body or `null`.
- `headerVal(headers, name)` — case-insensitive header lookup.
- `toCurl(f)` — copy-as-cURL string. `escapeRegex(s)` — literal regex escape.
- `ruleFromFlow(f)` — builds a `pause` rule matching this flow's exact method+URL (used by
  the detail "Intercept" action). See [rules.md](rules.md) / [flows/intercept.md](flows/intercept.md).

## Not yet mapped

Write on first deep-dive: `InterceptScreen.tsx`, `InterceptEditor.tsx`,
`ResendScreen.tsx`, `RulesPanel.tsx`, `Diagnostics.tsx`. (Their flows are partly covered in
[flows/connect.md](flows/connect.md), [flows/intercept.md](flows/intercept.md),
[flows/resend.md](flows/resend.md).)
