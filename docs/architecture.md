# Architecture

Entry point for the `docs/` wiki. High-level module map + how the layers fit.
All file paths are relative to the repo root.

## What it is

**Nox Traffic Inspector** — a local desktop app that captures/inspects/edits the
HTTP(S) traffic of Android devices/emulators. mitmproxy = interception engine,
adb = device control. Windows 11 target.

## Three parts, one runtime origin

```
desktop/ (Electron)  ──spawns──▶  backend/ (Python asyncio)  ──serves──▶  frontend/ (React)
   lifecycle only                  proxy :51080  +  web/WS :8770           built dist on :8770
```

- **backend/** — one asyncio process. mitmproxy `DumpMaster` (proxy on `0.0.0.0:51080`)
  + aiohttp web/WS/REST (`127.0.0.1:8770`) share memory in-process, so
  intercept→edit→resume is reliable. Entry: `python -m backend`
  ([backend/__main__.py](../backend/__main__.py)).
- **frontend/** — React + Vite + Tailwind + zustand. Talks over WebSocket (`/ws`,
  primary) + REST (`/api`, secondary). Builds URLs from `location.host`, so it works
  against whatever origin serves it.
- **desktop/** — Electron shell. Spawns the backend, waits for `:8770`, loads the UI,
  kills the backend tree on quit. No frontend changes between web and desktop because
  the backend serves the built frontend (one origin).

## Layering (backend)

```
__main__.py        one asyncio loop: build server + master, gather, clean shutdown
  ├─ engine.py     mitmproxy addon — request/response/error hooks; applies rules
  ├─ server.py     aiohttp: WS hub, REST, static frontend, action dispatch
  │    └─ connect.py   Connect orchestration (adb → root → cert → proxy)
  │         ├─ adb.py     AdbOrchestrator: locate/connect/root/push/proxy
  │         └─ certs.py   CertManager: mitmproxy CA → Android <hash>.0
  ├─ state.py      in-memory: FlowStore, PendingFlows, Rules, ConnectionState
  ├─ rules.py      rule matching (does a flow match an enabled rule?)
  ├─ intercept.py  apply edits / mock / forward / drop on a paused flow
  ├─ protocol.py   mitmproxy flow ⇄ wire JSON; control-message builders
  ├─ resend.py     replay a request through our own proxy
  ├─ prereqs.py    host readiness (adb, CA, proxy port) for the UI
  ├─ netutil.py    LAN IP, free-port check, firewall hint
  └─ config.py     constants only (dependency-free)
```

Key idea: **everything lives in one process** so the mitmproxy addon
([engine.py](../backend/engine.py)), the WS handler ([server.py](../backend/server.py)),
and shared state ([state.py](../backend/state.py)) touch the same Python objects —
no IPC between proxy and UI.

## Layering (frontend)

- [main.tsx](../frontend/src/main.tsx) mounts [App.tsx](../frontend/src/App.tsx).
- [App.tsx](../frontend/src/App.tsx) is pure layout: Sidebar + (InterceptScreen | FlowList+FlowDetail)
  + overlay panels (RulesPanel, InterceptEditor, ResendScreen, Diagnostics).
- [store.ts](../frontend/src/store.ts) — single zustand store; all state + actions.
- [ws.ts](../frontend/src/ws.ts) — WebSocket client; routes server messages into store actions.
- [types.ts](../frontend/src/types.ts) — wire types that **must mirror**
  [protocol.py](../backend/protocol.py) + `ConnectionState`.
- Components read state via `useStore` selectors and send via `sendAction` (ws.ts).

## The protocol contract

WS is primary (server→client messages have a `type`; client→server have an `action`).
The shapes in [types.ts](../frontend/src/types.ts) and [protocol.py](../backend/protocol.py)
are two halves of one contract — change them together. See [protocol.md](protocol.md).

## Conventions

- **Backend**: pure, testable modules; structured results (`AdbResult`); no `shell=True`;
  always `-s <serial>`. [config.py](../backend/config.py) stays dependency-free.
- **Frontend**: wire types mirror the backend protocol; connection-state shape shared
  via `ConnState`/`ConnectionState`.
- Don't commit build artifacts (gitignored).

## Not yet mapped

- Frontend components (FlowList, FlowDetail, InterceptScreen, InterceptEditor,
  ResendScreen, RulesPanel, Sidebar, Diagnostics, util.ts) — see
  [frontend-components.md](frontend-components.md) _(debt)_.
- Installer / PyInstaller packaging (`desktop/packaging/`, electron-builder) —
  see [build-packaging.md](build-packaging.md) _(debt)_.
- `SPEC.md` is referenced throughout the code comments (e.g. "SPEC §7.5") and in
  CLAUDE.md but **does not exist in the repo**. Section numbers in comments are
  the only surviving trace of it.
