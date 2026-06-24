# Frida — per-app interception + SSL unpinning

The power-user counterpart to the system-proxy [Connect flow](flows/connect.md).
Where Connect sets a device-wide proxy and installs a CA (and is defeated by
certificate pinning), the Frida path runs `frida-server` on the device and
injects scripts into **one** target app that trust our CA, route the app's
sockets through the proxy, disable certificate pinning, and **bypass common
root-detection checks** (many apps refuse to run on a rooted device). Captured
traffic still flows through the same mitmproxy on `:51080` into the normal flow
list.

**Standalone** — like HTTP Toolkit's Frida interceptor, the entry point does the
Connect work itself: if the device isn't connected, `start_server` runs the full
[Connect flow](flows/connect.md) (adb → device → root → CA → proxy) first, then
the Frida steps. No separate "Connect" click required.

**Requires root** — `frida-server` runs as root. Connect tolerates a non-rooted
device via user-cert mode, but Frida cannot: after the connect phase the flow
hard-fails if `conn.rooted` isn't true. The card itself is only disabled when the
**host** can't run Frida at all (no frida package or no bundled binary).

## file → symbol

| File | Symbol | Responsibility |
|---|---|---|
| `backend/frida_controller.py` | `FridaController` | Orchestrates the whole flow; holds live frida device/session/script handles |
| `backend/frida_controller.py` | `FridaController._init_availability` | Decides `FridaState.available` (frida pkg importable **and** a server binary bundled) and records `reason` |
| `backend/frida_controller.py` | `FridaController.start_server` → `_run_start_server` | rooted check → ABI → push → launch → `adb forward` → host attaches as remote device |
| `backend/frida_controller.py` | `FridaController.intercept_app` → `_run_intercept` | spawn target gated → attach → load script → resume |
| `backend/frida_controller.py` | `FridaController._build_script` | CA PEM + proxy host:port → JS prologue, prepended to the bundled scripts (unpinning **+** root-bypass, concatenated) |
| `backend/frida_controller.py` | `FridaController._teardown` | detach, kill server, drop the forward (also runs on backend shutdown) |
| `backend/frida_scripts/android-unpinning.js` | (injected) | Trust CA via `SSLContext.init`, neuter pinning (TrustManagerImpl/okhttp), set JVM proxy props |
| `backend/frida_scripts/android-root-bypass.js` | (injected) | Hide root from the app: su-path probes, `Runtime.exec("su")`, `Build.TAGS`, `ro.debuggable`/`ro.secure`, root-app package lookups, RootBeer |
| `backend/adb.py` | `forward` / `remove_forward` / `list_packages` / `spawn_shell` / `pidof` / `kill_process` | adb primitives the controller drives |
| `backend/state.py` | `FridaState` | `available`, `serverRunning`, `targetApp`, `targetPid`, `fridaVersion`, `reason` |
| `backend/config.py` | `frida_server_binary` / `FRIDA_*` / `RESOURCE_ROOT` | binary lookup by ABI; resource locator that works in source **and** frozen bundles |
| `backend/server.py` | `_handle_action` | actions `frida_start` / `frida_list_apps` / `frida_intercept` / `frida_stop`; sends initial `frida` state on WS connect |
| `backend/protocol.py` | `frida_status_msg` / `frida_apps_msg` | wire messages `{type:"frida"}` and `{type:"frida_apps"}` |
| `frontend/src/components/FridaCard.tsx` | `FridaCard` | Entry card, setup checklist, app picker, intercepting/stop state |
| `frontend/src/store.ts` | `FRIDA_STEPS`, `applyFridaStep`, `startFrida`, `beginFridaInject` | Frida UI state + checklist steps |
| `scripts/fetch-frida-server.py` | `main` | Provisions version-matched `frida-server` binaries into `desktop/resources/frida-server/` |

## Key state

`FridaState` (in `AppState.frida`) — separate from `ConnectionState`:
- `available` — host can run the feature at all (pkg + binary). Drives whether the card is clickable.
- `serverRunning` — frida-server up and host attached (remote device acquired).
- `targetApp` / `targetPid` — the currently intercepted package + its spawned PID.
- `reason` — why unavailable / last error, surfaced verbatim in the UI.

## Binaries & bundling

`frida-server` binaries are **large (~15 MB) and version-locked** to the host
`frida` package, so they are **not committed** (gitignored at
`desktop/resources/frida-server/`). Provision them with
`python scripts/fetch-frida-server.py` (defaults to arm64 + arm; `--all` for all
four ABIs). The version defaults to the installed `frida` package so host and
device match.

- `desktop/packaging/nox-backend.spec` — `collect_all("frida")` for the host
  native `_frida` extension; bundles `backend/frida_scripts` always and the
  `frida-server` binaries **only if present** (a build without them still
  succeeds; the feature just reports unavailable).
- Runtime lookup goes through `config.RESOURCE_ROOT` (`_MEIPASS` when frozen,
  repo root from source) — see `config.FRIDA_SERVER_DIR` / `FRIDA_SCRIPTS_DIR`.

## Traps / gotchas

- **Root required.** `start_server` hard-fails if `conn.rooted` isn't true.
- **Version match.** A frida-server binary whose version differs from the host
  `frida` package fails at attach; `_run_intercept` surfaces the frida error.
- **frida calls block.** The host `frida` API is synchronous — every call is
  wrapped in `asyncio.to_thread` so the event loop keeps serving flows.
- **off-loop callbacks.** Script `on('message')` runs on a frida thread;
  `_emit_threadsafe` marshals UI emits back via `run_coroutine_threadsafe`.
- **Shared adb.** `FridaController` reuses `ConnectController.adb`. The standalone
  flow drives `self.connect.connect()` to locate adb + acquire a serial, so no
  prior Connect click is needed; if a Connect is already running its lock makes
  the nested call a no-op and Frida reports it couldn't connect (retry).
- **Spawn-gated injection.** Apps are `spawn`'d paused, hooked, then `resume`'d,
  so pinning hooks are in place before the app makes its first request.
- **Coverage.** `android-unpinning.js` covers the common cases (TrustManagerImpl,
  okhttp3/legacy okhttp, SSLContext, JVM proxy props). HTTP Toolkit's MIT
  `frida-interception-and-unpinning` scripts can be dropped in for wider coverage.

## Not yet mapped

- Native (non-JVM) socket/TLS redirection (BoringSSL `connect()`/`SSL_read`
  hooks) — not yet implemented; only JVM-level proxy props are set.
- Attaching to an already-running process (only spawn-gated launch is wired).
