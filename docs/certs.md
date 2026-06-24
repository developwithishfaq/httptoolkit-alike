# Subsystem: certificate management

File: [backend/certs.py](../backend/certs.py). Paths relative to repo root.

Locate the mitmproxy CA, compute its Android filename, build the `.0` file. Pure-Python
hashing (no hard OpenSSL dep). Install **strategies** live in
[connect.py](../backend/connect.py) — see [connect.md](flows/connect.md).

## file → symbol

- `CertInfo` (dataclass) — `pem_path, subject_hash (8-hex), android_filename ("<hash>.0"),
  built_path`.
- `subject_hash_old(pem_bytes)` — OpenSSL's legacy subject hash: first 4 bytes of
  `MD5(DER subject)`, little-endian, as 8 hex chars. Android stores system CAs as
  `<subject_hash_old>.0`.
- `CertManager` — `pem_path` defaults to `MITM_CA_PEM` (`~/.mitmproxy/mitmproxy-ca-cert.pem`).
  - `ca_exists()` — does the PEM exist yet? (mitmproxy creates it on first proxy run.)
  - `compute()` → `CertInfo`; raises `FileNotFoundError` if the CA is missing.
  - `build_android_cert(info, out_dir)` — write the `<hash>.0` (PEM block) to push.
  - `openssl_crosscheck(info)` — if `openssl` on PATH, verify it agrees; else `None`.
    The `subprocess.run` spawns with `creationflags=SUBPROCESS_NO_WINDOW` (`config.py`) so
    the openssl call never pops up a console window under a windowed frozen exe.

## Traps

- The CA only exists **after the proxy has run once** — `__main__` runs the master which
  generates it; `compute()`/`ca_exists()` gate on this.
- Hash is `subject_hash_old` (MD5-based legacy), **not** the modern `subject_hash` — Android
  requires the old form.
- This module never touches the device; pushing/installing is [connect.py](../backend/connect.py)'s
  job, which picks system-push / tmpfs-overlay / user-cert by API level + root.

## Related

- Install strategy + API-level branching: [connect.md](flows/connect.md).
- adb push/chmod primitives: [adb.md](adb.md).
