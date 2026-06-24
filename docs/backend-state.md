# Subsystem: in-memory state

File: [backend/state.py](../backend/state.py). Paths relative to repo root.

All runtime state in one process so the addon, WS handler, and rule list share memory.

## file → symbol

- `FlowStore` — ring buffer of **serialized** flow dicts keyed by id (OrderedDict).
  - `upsert(serialized)` — set + `move_to_end`; evict oldest past `FLOW_STORE_MAX` (5000).
  - `recent(limit)` — last N (newest at the end); `clear()`.
  - Stores the serialized form so late-joining UIs replay cheaply. A flow is updated
    **in place** as it moves request → response.
- `PendingFlows` — registry of **live** paused mitmproxy flow objects keyed by id.
  - `add/pop/get/has/count`. Holds real flow objects (not serialized) so forward/drop
    can mutate and resume them.
- `Rules` — ordered rule list, persisted to `RULES_PATH` (JSON) on every `set`.
  - `list` (property), `set(rules)` (saves), `match(flow, direction)` →
    `rules_mod.first_match`, `load`/`save` (best-effort; never crash the loop).
- `ConnectionState` (dataclass) — `connected, proxyRunning, certInstalled, deviceSerial,
  androidSdk, hostProxy, rooted, certMode`. `to_dict()` for the wire. **Mirrors
  `ConnState` in [types.ts](../frontend/src/types.ts).**
- `FridaState` (dataclass) — `available, serverRunning, targetApp, targetPid,
  fridaVersion, reason`. `to_dict()` for the wire. Tracks the per-app Frida path,
  **separate** from `ConnectionState`. **Mirrors `FridaState` in
  [types.ts](../frontend/src/types.ts).** See [frida.md](frida.md).
- `AppState` (dataclass) — container: `store, pending, rules, conn, frida`. Built once
  in `__main__.amain`.

## Traps

- `FlowStore` keeps **serialized dicts**; `PendingFlows` keeps **live flow objects**.
  A paused flow is in both: serialized in the store (phase `paused`) and live in pending.
- `certInstalled` is True only for **system**-store installs; user-cert mode leaves it
  False but sets `certMode="user"` (see [connect.md](flows/connect.md)).
- `FridaState.available` reflects **host capability** (frida pkg + bundled server binary),
  not whether a device is ready — the UI also gates on `conn.connected`/`conn.rooted`.
- Rules persistence is best-effort (`save()` swallows `OSError`).

## Related

- [protocol.md](protocol.md) (serialized shape), [rules.md](rules.md) (matching).
