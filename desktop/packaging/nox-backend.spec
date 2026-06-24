# PyInstaller spec for the Nox Traffic Inspector backend.
#
# Produces a one-folder bundle (dist/nox-backend/nox-backend.exe) that runs the
# aiohttp web/WS server + mitmproxy proxy with no system Python. The built
# frontend is bundled in so the backend can serve it on :8770 (single-origin,
# same as `python -m backend`). electron-builder then ships this folder as an
# extraResource (see desktop/package.json).
#
# Build (from desktop/):  pyinstaller packaging/nox-backend.spec --noconfirm
#
# One-folder (not one-file) is deliberate: mitmproxy's native modules + data
# files unpack faster and more reliably than a one-file self-extracting exe.

import os
from PyInstaller.utils.hooks import collect_all

# SPECPATH is desktop/packaging; repo root is two levels up.
REPO_ROOT = os.path.abspath(os.path.join(SPECPATH, "..", ".."))
ENTRY = os.path.join(SPECPATH, "nox_backend.py")
FRONTEND_DIST = os.path.join(REPO_ROOT, "frontend", "dist")

datas = []
binaries = []
hiddenimports = []

# Pull in everything (submodules, data files, native libs) for packages that
# load parts dynamically. mitmproxy_rs / mitmproxy_windows carry the Rust .pyd
# native cores that a plain import graph would miss.
for pkg in ("mitmproxy", "mitmproxy_rs", "mitmproxy_windows", "aiohttp", "cryptography"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:  # a package may be absent on some platforms
        print(f"[spec] collect_all({pkg!r}) skipped: {e}")

# Bundle the built frontend so the frozen backend serves it (server.py reads
# sys._MEIPASS/frontend/dist when frozen).
if os.path.isdir(FRONTEND_DIST):
    datas.append((FRONTEND_DIST, os.path.join("frontend", "dist")))
else:
    raise SystemExit(
        f"[spec] frontend not built at {FRONTEND_DIST} — run "
        f"`npm --prefix frontend run build` first."
    )

# Defensive extras: mitmproxy's compression/codec deps are sometimes imported
# lazily and missed by the graph.
hiddenimports += ["brotli", "zstandard", "certifi"]

block_cipher = None

a = Analysis(
    [ENTRY],
    pathex=[REPO_ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="nox-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # no console window pops up; Electron still captures stdout/stderr
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="nox-backend",
)
