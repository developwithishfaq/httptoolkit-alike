# Subsystem: Electron desktop shell

File: [desktop/main.js](../desktop/main.js) (+ [desktop/preload.js](../desktop/preload.js),
[desktop/dev.ps1](../desktop/dev.ps1)). Paths relative to repo root.

Lifecycle only: spawn the backend, wait for `:8770`, load the UI, kill the backend tree
on quit. **No app logic** — the backend serves the frontend on one origin.

## file → symbol (main.js)

- `backendCandidates()` — launchers in order:
  - packaged → frozen `resources/backend/nox-backend.exe` (no system Python);
  - dev → `NOX_PYTHON` → `py -3 -m backend` → `python -m backend` (win) / `python3` (else).
- `startBackend()` — `tryCandidate(i)` spawns each; on `ENOENT` falls through to the next;
  on unexpected child `exit` while running → `fatal(...)`. Pipes child stdout/stderr.
- `stopBackend()` — Windows `taskkill /pid <pid> /T /F` (whole tree; mitmproxy spawns
  helpers); else `SIGTERM`.
- `pingHealth()` / `waitForBackend()` — poll `GET /api/prereqs` until 200 (≤30s).
- `createWindow()` — BrowserWindow with `preload.js`, context isolation on, node integration
  off; shows an inline data-URL loading screen first.
- `loadApp()` — loads `DEV_URL` (`localhost:51173`) when `NOX_DESKTOP_MODE=dev`, else
  `WEB_ORIGIN` (`127.0.0.1:8770`).
- `fatal(title, detail)` — error box + stop backend + quit.
- App lifecycle: single-instance lock; `before-quit`/`window-all-closed` stop the backend.
- `buildMenu()` — minimal File/View menu.

## Key constants

- `WEB_PORT=8770`, `DEV_URL=http://localhost:51173`, `IS_DEV = NOX_DESKTOP_MODE==="dev"`,
  `app.isPackaged` switches frozen-exe vs `python -m backend`.

## Traps

- `app.isPackaged` is the prod/dev switch for **both** the backend launcher and the frontend
  URL — keep those two in sync.
- Backend death while `!isQuitting` is treated as fatal (error box), so a crashing backend
  takes the window down on purpose.
- Single-instance lock exists because two instances would fight over `:51080`/`:8770`.

## Related

- Backend it spawns: [architecture.md](architecture.md). Health endpoint:
  [backend-server.md](backend-server.md). Packaging/installer:
  [build-packaging.md](build-packaging.md) _(debt)_.
