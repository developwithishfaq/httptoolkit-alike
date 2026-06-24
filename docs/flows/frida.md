# Flow: Frida per-app interception

End-to-end ordered call chain for intercepting a single app via Frida. Subsystem
reference: [docs/frida.md](../frida.md). **Per-app, independent of device-wide
capture**: needs the device *link* (`conn.connected`, feature 1) but not
"Intercept traffic" (feature 2) — Frida routes the chosen app's traffic itself.
The device must be **rooted** (frida-server runs as root).

## Availability (startup, before any user action)

```
Server.__init__
  → FridaController.__init__
      → _init_availability
          frida import OK?            no → available=False, reason="pkg not installed"
          frida-server-android-* present in FRIDA_SERVER_DIR?
                                      no → available=False, reason="run fetch-frida-server.py"
          else                           → available=True
```
On each WS connect, `Server._ws_handler` sends `frida_status_msg("frida_init", …)`
so the UI knows whether to enable the card.

## A. Start frida-server  (`action: "frida_start"`)

```
ws "frida_start"
  → Server._handle_action → _spawn(FridaController.start_server())
      → _run_start_server                                   [backend/frida_controller.py]
        0. adb located + serial + conn.connected?  no → emit frida_device(False, "connect first")
        1. state.conn.rooted true?         no → emit frida_device(False, "needs root")
                                           → emit frida_device(True)
        3. adb.cpu_abi()                   → config.frida_server_binary(abi)
           binary exists?                  no → emit frida_abi(False, "run fetch-…")
                                           → emit frida_abi(True)
        4. adb.remote_file_size(FRIDA_REMOTE_PATH) == local size?
             yes → skip push ("already on device — reusing")
             no  → adb.push(binary → FRIDA_REMOTE_PATH)
           adb.chmod 755 (either way)      → emit frida_push
        5. adb.kill_process("nox-frida-server")   (clear stale)
           adb.spawn_shell(FRIDA_REMOTE_PATH)      → self._server_proc (kept alive)
           _wait_for_server (poll adb.pidof)
                                           timeout → emit frida_launch(False)
                                           → emit frida_launch(True)
        6. adb.remove_forward + adb.forward(27042→27042)        (frida control port)
           adb.remove_reverse + adb.reverse(SOCKS_PORT→SOCKS_PORT)  (proxy data path)
                                           reverse fail → emit frida_connect(False)
           frida.get_device_manager().add_remote_device("127.0.0.1:27042")  [asyncio.to_thread]
                                           fail → emit frida_connect(False)
           state.frida.serverRunning = True
                                           → emit frida_connect(True)
        7. adb.list_packages(-3) → broadcast frida_apps_msg
```
UI: `applyFridaStep` fills the `FRIDA_STEPS` checklist; `serverRunning` flips the
card to the **app picker** (populated from `frida_apps`).

## B. Intercept an app  (`action: "frida_intercept", package`)

```
ws "frida_intercept" {package}
  → Server._handle_action → _spawn(FridaController.intercept_app(package))
      → _run_intercept                                      [backend/frida_controller.py]
        device acquired?                   no → emit frida_inject(False, "start server first")
        _detach_session()                  (drop any prior script)
        _build_script()                                     [backend/frida_controller.py]
          MITM_CA_PEM exists?              no → emit frida_inject(False, "CA not found")
          read CA PEM; PROXY_HOST = 127.0.0.1 (device loopback, adb-reversed
            to the host SOCKS listener — NOT the host LAN IP); PROXY_PORT=SOCKS_PORT
          → prologue (NOX_CONFIG + native-hook config globals)
            + frida-java-bridge.js (FIRST — restores global `Java`, removed in
              Frida 17; without it the Java-layer scripts throw and HTTPS dies)
            + config-helpers.js + native-connect-hook.js + native-tls-hook.js
            + android-unpinning.js + android-root-bypass.js
        device.spawn([package])            → pid            [asyncio.to_thread]
        device.attach(pid)                 → session
        session.create_script(source)      → script
        script.on("message", _on_script_message)
        script.load()                      (hooks install while app is paused)
        device.resume(pid)                 (app starts, already hooked)
                                           any error → emit frida_inject(False); _detach_session
        state.frida.targetApp/targetPid set
                                           → emit frida_inject(True)
```
On-device, the injected scripts run in the app: `native-connect-hook.js` hooks
libc `connect()` and redirects every TCP socket to `127.0.0.1:51081` on the
device, SOCKS5-handshaking the original destination. `adb reverse` (set up in
step 6) tunnels that loopback port to the host's mitmproxy SOCKS5 listener — so
the app reaches the proxy without a device→host LAN route or an inbound firewall
rule (the old host-LAN-IP target needed both, and missing either showed the app
as "no internet"). `android-unpinning.js`
swaps `SSLContext.init` to trust the CA and neuters pinning checks;
`android-root-bypass.js` hides root (su paths, `Runtime.exec`, build tags, system
props, root packages, RootBeer) so root-averse apps still run. The app's HTTPS —
raw-socket or JVM — now decrypts through mitmproxy and rows appear in the flow
list via the normal [capture flow](capture.md).

UI: `beginFridaInject` marks only `frida_inject` pending; on success the card
shows the **Intercepting** state with a Stop button.

## C. Stop  (`action: "frida_stop"`, and backend shutdown)

```
ws "frida_stop" → FridaController.stop → _teardown
   _detach_session (script.unload + session.detach)
   self._device = None
   self._server_proc.kill()             (device-side frida-server child dies with it)
   adb.kill_process("nox-frida-server"); adb.remove_forward(27042); adb.remove_reverse(SOCKS_PORT)
   state.frida.serverRunning = False
   → emit frida_stopped(True)
```
`backend/__main__.py` calls `server.frida.shutdown()` (silent `_teardown`) in its
finally block so no frida-server is left running on the device.

## Branch conditions / failure points

| Step | Branch | Result |
|---|---|---|
| availability | frida pkg missing / no binary | card disabled, `reason` shown |
| start ⓪      | no device link (`conn.connected` false) | `frida_device(False)`, "connect first" |
| start ①      | device not rooted | `frida_device(False)`, flow stops |
| start ③      | no binary for ABI | `frida_abi(False)`, "run fetch-frida-server.py" |
| start ⑤      | frida-server won't start (root denied) | `frida_launch(False)` |
| start ⑥      | version mismatch / forward fail | `frida_connect(False)` |
| intercept    | CA missing | `frida_inject(False)`, "start the proxy once" |
| intercept    | app can't be spawned | `frida_inject(False)` with frida error, session detached |
