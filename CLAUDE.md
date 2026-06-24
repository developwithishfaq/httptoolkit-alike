# CLAUDE.md

Guidance for working in this repo. Read this first.

## What this is

**Nox Traffic Inspector** — a local desktop app (HTTP Toolkit-style) that captures,
inspects, and edits the HTTP/HTTPS traffic of Android devices/emulators, using
**mitmproxy** as the interception engine and **adb** for device control. Windows 11
target. See [README.md](README.md) for user docs and [SPEC.md](SPEC.md) for design.

## Architecture

Three parts, one origin at runtime:

- **`backend/`** — one Python asyncio process. mitmproxy `DumpMaster` (proxy on
  `0.0.0.0:8080`) + aiohttp web/WS/REST (`127.0.0.1:8770`) share memory so
  intercept→edit→resume is reliable. Entry: `python -m backend`
  ([backend/__main__.py](backend/__main__.py)).
- **`frontend/`** — React + Vite + Tailwind + zustand. Talks to the backend over
  WebSocket (`/ws`, primary) + REST (`/api`). Builds URLs from `location.host`, so it
  works against whatever origin serves it. Dev server on `:5173` proxies `/ws`+`/api`
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
| **Browser only** (fastest) | `python -m backend` + `npm --prefix frontend run dev`, open `localhost:5173` | Frontend HMR; restart backend on Python changes |
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

The Connect flow ([backend/connect.py](backend/connect.py)) supports **any** adb device,
not just Nox:

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
  is shared via `ConnState` / `ConnectionState`.
- Don't commit build artifacts (`desktop/node_modules`, `desktop/release`,
  `desktop/packaging/{dist,build}`, `frontend/dist`) — already gitignored.
