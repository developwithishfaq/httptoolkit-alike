# Flow: Connect (one-click device setup)

What runs when the user clicks Connect. Drives adb → root → Android check → cert install →
proxy, emitting a `status` event per step for the live checklist. Paths relative to repo root.

## Entry

- UI sends `{action:"connect"}` → `Server._handle_action` ([server.py](../../backend/server.py))
  → `self._spawn(self.connect.connect())`.
- `ConnectController.connect()` ([connect.py](../../backend/connect.py)) takes a lock (one at
  a time) → `_run_connect()`.

## Call chain (`_run_connect`, each step `_emit`s a `status`)

1. **adb_found** — `self.adb.autoselect()` ([adb.md](../adb.md)). None → stop.
2. **proxy_running** — `conn.proxyRunning=True`; `self.certs.ca_exists()` ([certs.md](../certs.md)).
   Missing CA → stop.
3. **device_connected** — `self.adb.connect()`; sets `conn.deviceSerial`. No device → stop.
4. **rooted** — `self.adb.root()`. Parses stdout/stderr for "cannot run as root"/"production
   build". If rooted → `_ensure_online()` (adbd restarts), `conn.rooted=True`. Else
   `conn.rooted=False` and **continue in user-cert mode** (not a dead end).
5. **android_checked** — `self.adb.sdk_level()`; `can_system = rooted and sdk <= 33`.
   API ≥ 34 (Android 14+) → user cert even if rooted (system store moved to `/apex`).
6. **cert_installed** — `self.certs.compute()`, then:
   - system + `sdk <= 28` → `_install_cert_push` (write `/system`, persistent),
   - system + `29..33` → `_install_cert_tmpfs` (tmpfs overlay via `build_inject_script`,
     resets on reboot),
   - else → `_install_cert_user` (push PEM to `/sdcard/Download`, user installs manually).
   Sets `conn.certInstalled` (system only) + `conn.certMode` (`"system"`/`"user"`).
7. **proxy_set** — `self.adb.set_proxy(host:51080)` (`settings put global http_proxy`; works
   without root). `conn.hostProxy` set.
8. **connected** — `conn.connected=True`; message differs for user-cert mode (HTTP only
   until the CA is manually installed).

Every `_emit` → `status_msg` → `broadcast` → frontend `setConn`+`setStatus`
([frontend-state.md](../frontend-state.md)); `setStatus` lights the checklist and flips
`mainView` to `"view"` on success.

## Branch conditions

- **Rooted + API ≤ 28** → `/system` push (persistent).
- **Rooted + API 29–33** → tmpfs overlay (`build_inject_script`, `_install_cert_tmpfs`; resets on reboot).
- **Not rooted, or API ≥ 34** → user-cert mode (`_install_cert_user`).
- Any step failure `_emit`s `ok=False` and returns, leaving state recoverable (Retry = click again).

## Other actions

- `disconnect()` — `adb.clear_proxy()`, `conn.connected=False`.
- `reboot_device()` — `adb.reboot()`.
- `clear_device_proxy()` — best-effort on backend shutdown (from `__main__`), so the device
  never points at a dead host.

## Gotchas

- The CA must exist first (proxy runs once at boot to generate it) — step 2 gates on it.
- `_ensure_online` retries because `adb root` restarts adbd and the device briefly drops.
- tmpfs install is **non-persistent** — survives until reboot only.
- `certMode="user"` ⇒ `certInstalled=False` but still "connected" (HTTP captured).

## Related

- [adb.md](../adb.md), [certs.md](../certs.md), [frontend-state.md](../frontend-state.md).
