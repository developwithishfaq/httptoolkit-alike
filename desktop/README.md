# Nox Traffic Inspector — Desktop app (Electron)

A thin Electron shell that turns the web app into a **native desktop window**. It
spawns the existing Python backend, waits for it to come up, and loads the UI — no
browser, no two-terminal dance.

Nothing in `backend/` or `frontend/` changes: the backend already serves the built
frontend + `/ws` + `/api` on `127.0.0.1:8770`, and the frontend builds its URLs from
`location.host`. Electron just manages the process lifecycle.

## Prerequisites

Same as the main project — **Python 3.11+** and **Node 18+** must be on PATH (or set
`NOX_PYTHON` to a specific interpreter). See the [root README](../README.md).

## Run

```powershell
# one-time
npm install                 # in this desktop/ folder

# production-style single window (backend serves the built UI on :8770)
npm run build:frontend      # produces frontend/dist
npm start
```

A native window opens showing the Intercept screen. The **Status** panel should report
`WS connected`, adb, and the mitmproxy CA — same as the web version, proving the
spawned backend is reachable.

### Dev (hot reload)

**One command** — starts Vite, then Electron (which spawns the backend), with frontend
HMR in the native window; Ctrl+C tears it all down:

```powershell
npm run dev:all        # or:  ./dev.ps1  from the desktop/ folder
```

Or run the two pieces manually:

```powershell
# terminal 1 — Vite dev server (HMR) on :5173
npm --prefix ../frontend run dev

# terminal 2 — Electron in dev mode (spawns the backend, loads :5173)
npm run dev
```

Electron still spawns the backend for `/ws` + `/api`; Vite proxies those to `:8770`
(see `frontend/vite.config.ts`). Backend (Python) changes need a restart — close the
window and rerun. **No installer needed for development** — that's only for shipping.

## How it works

`main.js`:
1. Spawns `python -m backend` from the repo root (`NOX_PYTHON` → `py -3` → `python`).
2. Polls `http://127.0.0.1:8770/api/prereqs` until the backend answers (≤30s), showing
   a branded loading screen meanwhile.
3. Opens a `BrowserWindow` at `127.0.0.1:8770` (prod) or `localhost:5173` (dev).
4. On quit, kills the backend process tree (`taskkill /T` on Windows) so the proxy on
   `:8080` is never left orphaned. A single-instance lock prevents port conflicts.

## Packaging into a standalone installer (Phase 2 — not yet wired)

Today the app runs from source and needs Python + Node installed. To ship a single
installer that needs neither:

1. **Freeze the backend** with PyInstaller into `nox-backend.exe`, collecting mitmproxy
   data files: `pyinstaller --collect-all mitmproxy -n nox-backend backend/__main__.py`.
   Have `main.js` prefer that exe over `python -m backend` when it exists.
2. **Bundle with electron-builder** (Windows NSIS target): add `electron-builder` to
   devDependencies, a `build` config bundling `frontend/dist` + the backend exe + an app
   icon, then `npm run dist`.

The fiddly part is step 1 — mitmproxy ships data files and native deps that PyInstaller
must collect explicitly.
