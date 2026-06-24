# Flow: Connect (device link) + Intercept traffic (device-wide capture)

These are **two separate features** on the Intercept screen, split so the device
link is a prerequisite that gates capture and Frida:

1. **Connect device (ADB)** — `connect()` → `_run_connect`: adb → device online →
   root detection → Android version. Establishes the *link* only (`conn.connected`).
2. **Intercept traffic** — `intercept_traffic()` → `_run_intercept_traffic`: CA
   install + device proxy (`conn.capturing`). Requires the link first.

Each step `_emit`s a `status` event for its checklist. Paths relative to repo root.

## Feature 1 — Connect (`{action:"connect"}`)

Entry: `Server._handle_action` → `self._spawn(self.connect.connect())` →
`ConnectController.connect()` (lock) → `_run_connect()`.

1. **adb_found** — `self.adb.autoselect()` ([adb.md](../adb.md)). None → stop.
2. **device_connected** — `self.adb.connect()`; sets `conn.deviceSerial`. No device → stop.
3. **rooted** — `self.adb.root()`. Parses stdout/stderr for "cannot run as root"/"production
   build". Rooted → `_ensure_online()` (adbd restarts), `conn.rooted=True`. Else
   `conn.rooted=False` (not a dead end — capture still works via user cert; Frida won't).
4. **android_checked** — `self.adb.sdk_level()` → `conn.androidSdk` (recorded for the cert
   strategy used later by Intercept traffic).
5. **connected** — `conn.connected=True`. The link is up; capture + Frida unlock.

## Feature 2 — Intercept traffic (`{action:"intercept_traffic"}`)

Entry: `Server._handle_action` → `self._spawn(self.connect.intercept_traffic())` →
`ConnectController.intercept_traffic()` (lock) → `_run_intercept_traffic()`.

0. Guard: `conn.connected` must be true → else `_emit("capture", False, "Connect a device first")`.
1. **proxy_running** — `conn.proxyRunning=True`; `self.certs.ca_exists()` ([certs.md](../certs.md)).
   Missing CA → stop.
2. **cert_installed** — `can_system = conn.rooted and conn.androidSdk <= 33`, then `self.certs.compute()`:
   - system + `sdk <= 28` → `_install_cert_push` (write `/system`, persistent),
   - system + `29..33` → `_install_cert_tmpfs` (tmpfs overlay via `build_inject_script`, resets on reboot),
   - else → `_install_cert_user` (push PEM to `/sdcard/Download`, user installs manually).
   Sets `conn.certInstalled` (system only) + `conn.certMode` (`"system"`/`"user"`).
3. **proxy_set** — `self.adb.set_proxy(host:51080)` (`settings put global http_proxy`; works
   without root). `conn.hostProxy` set.
4. **capturing** — `conn.capturing=True`; message differs for user-cert mode (HTTP only until
   the CA is manually installed).

Every `_emit` → `status_msg` → `broadcast` → frontend `setConn`+`setStatus`
([frontend-state.md](../frontend-state.md)). `setStatus` routes link steps to the
Connect checklist and capture steps to the Intercept-traffic checklist, and flips
`mainView` to `"view"` only on the terminal `capturing` step (when traffic flows).

## Branch conditions (cert strategy, in Intercept traffic)

- **Rooted + API ≤ 28** → `/system` push (persistent).
- **Rooted + API 29–33** → tmpfs overlay (`build_inject_script`, `_install_cert_tmpfs`; resets on reboot).
- **Not rooted, or API ≥ 34** → user-cert mode (`_install_cert_user`).
- Any step failure `_emit`s `ok=False` and returns, leaving state recoverable (Retry = click again).

## Other actions

- `stop_intercept()` — `adb.clear_proxy()`, `conn.capturing=False` (keeps the link).
- `disconnect()` — `adb.clear_proxy()`, `conn.connected=False`, `conn.capturing=False`.
- `reboot_device()` — `adb.reboot()`.
- `clear_device_proxy()` — best-effort on backend shutdown (from `__main__`), so the device
  never points at a dead host.

## Gotchas

- The CA must exist first (proxy runs once at boot to generate it) — Intercept-traffic step 1 gates on it.
- `_ensure_online` retries because `adb root` restarts adbd and the device briefly drops.
- tmpfs install is **non-persistent** — survives until reboot only.
- `certMode="user"` ⇒ `certInstalled=False` but still "capturing" (HTTP captured).
- Frida ([frida.md](../frida.md)) is the third, independent feature — it needs the link
  (`connect`) but **not** Intercept traffic; it routes one app's traffic itself.

## Related

- [adb.md](../adb.md), [certs.md](../certs.md), [frida.md](../frida.md),
  [frontend-state.md](../frontend-state.md).
