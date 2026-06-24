# Subsystem: adb orchestration

File: [backend/adb.py](../backend/adb.py). Paths relative to repo root.

Locate adb, connect to any device/emulator, root, query, push, set proxy. UI-agnostic:
every method returns a structured `AdbResult`. No `shell=True`; always `-s <serial>`.

## file → symbol

- `AdbResult` (dataclass) — `ok, stdout, stderr, code`; `.text` = stdout-or-stderr stripped.
- `AdbOrchestrator` — holds `adb_path` + `serial`.
  - `_candidates()` — adb binaries in **preference order**: `ADB_OVERRIDE` → `shutil.which("adb")`
    (modern platform-tools) → Nox's bundled adb. De-duped.
  - `locate()` — first candidate (no probing).
  - `autoselect()` — probe candidates; return the first that **sees an online device**
    (sets `serial`); else the first candidate. This is what avoids invoking Nox's ancient
    adb (which kills a newer adb server on :5037).
  - `_run(*args, timeout)` — the only subprocess runner (`create_subprocess_exec`).
    Spawns with `creationflags=SUBPROCESS_NO_WINDOW` so adb never pops up a console
    window when the app runs as a windowed frozen exe (see Traps).
  - `_shell(serial, cmd)` — `-s serial shell cmd`.
  - `connect(endpoints)` — pick any online device; else `adb connect` Nox's TCP endpoints
    and rescan; reports `unauthorized` devices; kill-server + retry once.
  - `_list_devices()` → `(online, unauthorized)` parsed from `adb devices`.
  - `root()`, `remount()` (falls back to `mount -o rw,remount /system`).
  - `getprop`, `sdk_level()` (`ro.build.version.sdk`), `cpu_abi()`.
  - `push`, `chmod`, `push_and_run_script`, `file_exists`.
  - `set_proxy(host_port)` / `clear_proxy()` — `settings put global http_proxy ...`
    (works **without root**). `reboot()`.
  - Frida helpers (drive [frida.md](frida.md)): `forward`/`remove_forward(local, remote)`
    (`adb forward tcp:…`), `list_packages(third_party_only)` (`pm list packages -3`),
    `spawn_shell(cmd)` — returns a **non-awaited** Popen to keep frida-server alive —
    `pidof(name)` (falls back to `ps | grep`), `kill_process(name)` (`pkill -f`).
- Nox discovery helpers: `_nox_adb_candidates`, `_registry_nox_bin_dirs`,
  `_bin_dir_from_value`, `_reg_get` — find Nox's bin dir via env roots + Windows uninstall
  registry (`DisplayIcon`/`UninstallString` parsed since `InstallLocation` is often blank).

## Key state / config

- `ADB_OVERRIDE` = `NOX_INSPECTOR_ADB` env ([config.py](../backend/config.py)); when set,
  wins. `NOX_ADB_ENDPOINTS` = `127.0.0.1:62001`, `:62025`.

## Traps

- `clear_proxy` sets `http_proxy :0` (not empty) — that's Android's "no proxy" sentinel.
- Modern adb is preferred precisely because Nox's adb (~1.0.36) fights over port 5037.
- `set_proxy` works without root; cert install is what needs root (see [certs.md](certs.md)).
- **No popup cmd windows**: every adb spawn passes `creationflags=SUBPROCESS_NO_WINDOW`
  (`config.py`, = `CREATE_NO_WINDOW` on Windows, `0` elsewhere). Without it, a windowed
  (no-console) frozen exe would open a separate console window per adb call during Connect.

## Related

- Orchestrated by [connect.md](flows/connect.md). Cert side: [certs.md](certs.md).
