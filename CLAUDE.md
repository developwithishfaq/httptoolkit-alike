# CLAUDE.md

Guidance for working in this repo. Read this first.

## How to work in this repo (do this first, every task)

1. **Route before you grep.** Find your task in the "Where to change things" table
   below — it points you at the exact `file → symbol` and the one doc to read.
2. **Read only the one relevant `docs/*.md`** for the task (subsystem doc for "how is X
   built", flow doc for "what runs when Y happens").
3. **Open the named file → jump to the named symbol.** Explore further only if the doc is
   insufficient — and if it was insufficient, **fixing the doc is part of the task**.

Goal: land on the change site in the fewest tokens (routing table → one doc → one file).
Don't re-explore what a doc already maps.

## MANDATORY: keep the `docs/` wiki complete (hard rule — part of "done")

A task that read code to understand a subsystem or trace a flow is **NOT done** until the
matching `docs/` file exists and is current. Writing/updating the doc is the **final step,
done before you answer**.

You MUST write/update a doc when ANY of these is true:
- You opened **2+ files** to figure something out.
- You traced a **flow that crosses files/modules**.
- The routing row said **_(write on first deep-dive)_** — clear that debt now and replace
  the marker with the real doc path.
- You found a **gotcha/branch/limitation that contradicts** a doc.
- You **changed code** — update its doc in the same change.

Only skip allowed: a one-line edit to a file already fully and correctly covered, where
nothing new was learned.

**Self-check before replying:** "Did I read code to learn something not already in a doc?"
If yes → it must be written to `docs/` AND reachable from the routing table before finishing.

### Two kinds of docs
- **Subsystem docs → `docs/<subsystem>.md`** — one per module/screen/feature. Structure:
  `file → symbol` responsibilities, key state, traps.
- **Flow docs → `docs/flows/<flow>.md`** — one per end-to-end flow. The ordered call chain
  `entry point → … → final effect`, every `file:symbol` hop in order, branch conditions,
  gotchas. Any "where does X happen / how does Y work end-to-end / what runs when the user
  does Z" belongs in a flow doc.

### Rules for every doc
- One subsystem/flow per file; **many small focused docs**, never one giant file.
- **Always wire a new doc into the routing table** below.
- Keep docs in sync with code. Partial is fine — add a `## Not yet mapped` section listing
  unknowns rather than guessing.
- **Content over polish**: exact `file → symbol`, ordered call chains, branch conditions,
  traps. Working notes, not prose.

## Where to change things

Base path for all relative file references below: the **repo root**
(`D:\curious-projects\httptoolkit-alike`). Doc links are relative to root too.

| If the task is about… | Go to file → symbol | Doc |
|---|---|---|
| High-level architecture / where a module lives | — | [docs/architecture.md](docs/architecture.md) |
| HTTP(S) capture appearing in the UI (request→response→row) | `backend/engine.py` → `Engine.request`/`Engine.response` | [docs/flows/capture.md](docs/flows/capture.md) |
| mitmproxy engine / addon hooks | `backend/engine.py` → `Engine` | [docs/backend-engine.md](docs/backend-engine.md) |
| WS hub, REST, static serving, action dispatch | `backend/server.py` → `Server._handle_action` | [docs/backend-server.md](docs/backend-server.md) |
| Wire message shapes / flow serialization | `backend/protocol.py` → `serialize_flow` + `frontend/src/types.ts` | [docs/protocol.md](docs/protocol.md) |
| In-memory state (flows, pending, rules, conn) | `backend/state.py` → `FlowStore`/`PendingFlows`/`Rules`/`ConnectionState` | [docs/backend-state.md](docs/backend-state.md) |
| Connect device (link) / Intercept traffic (device-wide capture) | `backend/connect.py` → `ConnectController._run_connect` / `_run_intercept_traffic` | [docs/flows/connect.md](docs/flows/connect.md) |
| Frida per-app interception / SSL unpinning | `backend/frida_controller.py` → `FridaController` + `backend/frida_scripts/android-unpinning.js` | [docs/frida.md](docs/frida.md), [docs/flows/frida.md](docs/flows/frida.md) |
| Provisioning frida-server binaries | `scripts/fetch-frida-server.py` → `main` | [docs/frida.md](docs/frida.md) (Binaries & bundling) |
| adb control (locate/connect/root/push/proxy) | `backend/adb.py` → `AdbOrchestrator` | [docs/adb.md](docs/adb.md) |
| CA / certificate handling | `backend/certs.py` → `CertManager` | [docs/certs.md](docs/certs.md) |
| Rule matching logic | `backend/rules.py` → `first_match` | [docs/rules.md](docs/rules.md) |
| Rule actions (drop / mock / mock_request) | `backend/engine.py` + `backend/intercept.py` → `mock_response`/`set_request_body` | [docs/flows/rules-mocking.md](docs/flows/rules-mocking.md) |
| Intercept: pause → edit → forward/drop | `backend/intercept.py` + `backend/server.py` → `_forward`/`_drop` | [docs/flows/intercept.md](docs/flows/intercept.md) |
| Resend / replay a request | `backend/resend.py` → `resend` + `Server._resend` | [docs/flows/resend.md](docs/flows/resend.md) |
| Host prereqs / network helpers / config constants | `backend/prereqs.py`, `backend/netutil.py`, `backend/config.py` | [docs/host-prereqs.md](docs/host-prereqs.md) |
| Frontend state store + WS client | `frontend/src/store.ts`, `frontend/src/ws.ts` | [docs/frontend-state.md](docs/frontend-state.md) |
| Electron desktop shell / lifecycle | `desktop/main.js` | [docs/desktop.md](docs/desktop.md) |
| Traffic list, advanced filtering/search, FlowDetail, Sidebar, App layout, util.ts | `frontend/src/components/FlowList.tsx` (`FilterBar`/`FiltersPopover`), `FlowDetail.tsx`, `Sidebar.tsx`, `App.tsx`, `frontend/src/util.ts` | [docs/frontend-components.md](docs/frontend-components.md) |
| InterceptScreen / InterceptEditor / ResendScreen / RulesPanel / Diagnostics | `frontend/src/components/*.tsx` | _(write on first deep-dive)_ → [docs/frontend-components.md](docs/frontend-components.md) (Not yet mapped) |
| Installer / PyInstaller / electron-builder packaging | `desktop/packaging/nox-backend.spec`, `desktop/packaging/nox_backend.py`, `desktop/package.json` | _(write on first deep-dive)_ → [docs/build-packaging.md](docs/build-packaging.md) |

## What this is

**Nox Traffic Inspector** — a local desktop app (HTTP Toolkit-style) that captures,
inspects, and edits the HTTP/HTTPS traffic of Android devices/emulators, using
**mitmproxy** as the interception engine and **adb** for device control. Windows 11
target. See [README.md](README.md) for user docs.

> Note: code comments reference `SPEC.md` (e.g. "SPEC §7.5"), but that file does **not**
> exist in the repo — the section numbers in comments are its only surviving trace.

## Modules

- `backend/` — Python asyncio: `engine` (mitmproxy addon), `server` (aiohttp WS/REST/static),
  `connect`+`adb`+`certs` (device setup), `frida_controller`+`frida_scripts/` (per-app
  Frida interception + SSL unpinning), `state` (in-memory store/pending/rules/conn),
  `rules`+`intercept` (matching + edit/mock), `protocol` (wire (de)serialize), `resend`
  (replay), `prereqs`+`netutil` (host checks), `config` (constants).
- `frontend/` — React + Vite + Tailwind + zustand: `store.ts` (state), `ws.ts` (transport),
  `types.ts` (wire types), `App.tsx` (layout), `components/*.tsx` (screens/panels).
- `desktop/` — Electron shell (`main.js`) + PyInstaller packaging (`packaging/`).

## Architecture

Three parts, one origin at runtime (full map: [docs/architecture.md](docs/architecture.md)):

- **`backend/`** — one Python asyncio process. mitmproxy `DumpMaster` (proxy on
  `0.0.0.0:51080`) + aiohttp web/WS/REST (`127.0.0.1:8770`) share memory so
  intercept→edit→resume is reliable. Entry: `python -m backend`
  ([backend/__main__.py](backend/__main__.py)).
- **`frontend/`** — React + Vite + Tailwind + zustand. Talks to the backend over
  WebSocket (`/ws`, primary) + REST (`/api`). Builds URLs from `location.host`, so it
  works against whatever origin serves it. Dev server on `:51173` proxies `/ws`+`/api`
  to `:8770` ([frontend/vite.config.ts](frontend/vite.config.ts)).
- **`desktop/`** — Electron shell (Phase 2). Spawns the backend, waits for `:8770`,
  loads the UI in a native window, kills the backend tree on quit. The backend serves
  the built frontend, so it's a single origin — Electron just manages lifecycle.

The backend serving the frontend itself ([backend/server.py](backend/server.py),
`FRONTEND_DIST`) is why there are no frontend changes between web and desktop.

## Development — fast iteration (NO installer needed)

The PyInstaller freeze + installer is **only for shipping**. For day-to-day work, run
from source — changes are instant. Pick the lightest path that fits:

| Path | Command | Reload |
|---|---|---|
| **Browser only** (fastest) | `python -m backend` + `npm --prefix frontend run dev`, open `localhost:51173` | Frontend HMR; restart backend on Python changes |
| **Native window, one command** | `./desktop/dev.ps1` (or `npm --prefix desktop run dev:all`) | Starts Vite + Electron (which spawns the backend); frontend HMR in the window |
| **Native window, manual** | `npm --prefix frontend run dev`, then `npm --prefix desktop run dev` | Same as above, two terminals |
| **Prod-ish sanity check** | `npm --prefix desktop run build:frontend` + `npm --prefix desktop start` | Manual rebuild; backend serves built dist on `:8770` |

Rules of thumb:
- **Backend change** → restart the Python process. No freeze/rebuild.
- **Frontend change** → hot-reloads live when Vite dev is running.
- Only run the installer build when finalizing a release or testing the frozen bundle.

## Building the installer (release only)

```powershell
cd desktop
npm run build:frontend     # frontend/dist
npm run build:backend      # PyInstaller -> packaging/dist/nox-backend/ (bundles dist)
npm run dist               # electron-builder NSIS -> release/*.exe
```

Output: `desktop/release/Nox Traffic Inspector Setup <ver>.exe` — standalone, needs
neither Python nor Node on the target. Backend is shipped as an extraResource at
`resources/backend/nox-backend.exe`; `main.js` runs it when `app.isPackaged`, else
falls back to `python -m backend`.

### Known build gotchas (Windows)

- **electron-builder `winCodeSign` symlink error** — its archive has macOS `.dylib`
  symlinks that need elevation/Developer Mode to extract. We're not code-signing;
  pre-extract once into `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`
  with the bundled 7za (ignore the 2 symlink errors) and the build skips it. Set
  `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- **Electron binary didn't extract on `npm install`** — symptom: "Electron failed to
  install correctly". Manually extract the cached zip into
  `desktop/node_modules/electron/dist` and write `path.txt` containing `electron.exe`.
- **PyInstaller + mitmproxy** — the spec uses `collect_all` for `mitmproxy`,
  `mitmproxy_rs`, `mitmproxy_windows`. The `WinDivert*.SYS` "library not found" warnings
  are harmless (kernel drivers for transparent-redirect mode, which we don't use).

## Device connection (adb + certs) — important behavior

Full flow: [docs/flows/connect.md](docs/flows/connect.md). The Connect flow
([backend/connect.py](backend/connect.py)) supports **any** adb device, not just Nox:

- **adb selection** ([backend/adb.py](backend/adb.py), `autoselect`) prefers the adb
  that actually sees a device — i.e. modern platform-tools adb (what Android Studio
  uses) over Nox's ancient bundled adb (v1.0.36, which kills a newer adb server on
  port 5037). `ADB_OVERRIDE` / `NOX_INSPECTOR_ADB` env wins.
- **Rooted device / emulator (API ≤ 33)** → CA installed into the **system store**
  (`certMode="system"`), full HTTPS decryption. API ≤ 28 writes `/system`; 29–33 uses a
  tmpfs overlay.
- **Non-rooted retail phone** → graceful **user-cert mode** (`certMode="user"`): the
  proxy is set (works without root via `settings put global http_proxy`) and the CA is
  pushed to the device's Downloads for manual user-cert install. HTTP is fully captured;
  HTTPS only decrypts for browsers + apps that trust user CAs. This is an Android
  limitation, not a bug.
- **Android 14+ (API ≥ 34)** moved the system store to `/apex`; system install isn't
  supported there, so even rooted falls back to user-cert mode.

`disconnect` clears the device proxy; the backend also clears it on shutdown, so a
device is never left pointing at a dead host.

## Conventions

- Backend: pure, testable modules; structured results (e.g. `AdbResult`); no
  `shell=True`; always `-s <serial>`. Keep `config.py` dependency-free.
- Frontend: wire types in [frontend/src/types.ts](frontend/src/types.ts) must mirror the
  backend protocol ([backend/protocol.py](backend/protocol.py)); connection state shape
  is shared via `ConnState` / `ConnectionState`. Components are thin — state in
  `store.ts`, transport in `ws.ts`.
- Don't commit build artifacts (`desktop/node_modules`, `desktop/release`,
  `desktop/packaging/{dist,build}`, `frontend/dist`) — already gitignored.
