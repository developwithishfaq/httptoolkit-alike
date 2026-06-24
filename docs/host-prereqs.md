# Subsystem: host prerequisites + network helpers

Files: [backend/prereqs.py](../backend/prereqs.py), [backend/netutil.py](../backend/netutil.py),
[backend/config.py](../backend/config.py). Paths relative to repo root.

Cheap, pure host-readiness checks surfaced to the UI (the Diagnostics panel), plus the
network primitives the proxy advertises.

## file → symbol

- `prereqs.gather()` → dict: `adb` (located?), `mitmCA` (CA exists?), `hostIp`, `proxyPort`,
  `firewallHint`. Safe to call on every WS connect; sent as `prereqs_msg`.
- `netutil.host_lan_ip()` — best-effort LAN address the emulator can reach (UDP-connect to
  8.8.8.8 to pick the egress interface; no packets sent). Falls back to `127.0.0.1`.
- `netutil.is_port_free(host, port)` — can we bind right now? (used in `__main__` to warn
  about a second instance).
- `netutil.firewall_hint(port)` — the Windows Firewall `netsh` instruction string.
- `config.py` — all constants: `PROXY_HOST/PORT` (51080), `WEB_HOST/PORT` (8770),
  `LOCAL_PROXY_URL`, `REPLAY_HEADER`, `NOX_ADB_ENDPOINTS`, `ADB_OVERRIDE`, `FLOW_STORE_MAX`,
  `MAX_BODY_BYTES`, `APP_DATA_DIR`/`RULES_PATH`, `MITM_CA_PEM`. **Dependency-free** by rule.

## Gotchas

- `host_lan_ip` returns the egress interface — on a multi-NIC host the emulator-reachable IP
  may differ; this is the proxy address handed to the device in [connect.md](flows/connect.md).
- `APP_DATA_DIR` = `%APPDATA%/nox-inspector` (`~/.config/nox-inspector` off Windows).

## Related

- Consumed by the Diagnostics panel ([frontend-components.md](frontend-components.md) _(debt)_),
  served by [backend-server.md](backend-server.md) (`/api/prereqs`).
