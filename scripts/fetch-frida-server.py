#!/usr/bin/env python3
"""Provision device-side frida-server binaries for the Frida interception feature.

frida-server binaries are large (~15 MB each) and MUST match the version of the
host `frida` python package's protocol, so they are not committed. This script
downloads the right binaries from Frida's GitHub releases and decompresses them
into desktop/resources/frida-server/, where the backend locates them at runtime
and where PyInstaller / electron-builder pick them up for the installer.

Usage (from repo root):
    python scripts/fetch-frida-server.py              # arm64 + arm (most phones)
    python scripts/fetch-frida-server.py --all        # all four Android ABIs
    python scripts/fetch-frida-server.py --arch x86_64 arm64
    python scripts/fetch-frida-server.py --version 17.14.1

Version defaults to the installed `frida` package so host and device match.
"""

from __future__ import annotations

import argparse
import lzma
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "desktop" / "resources" / "frida-server"
RELEASE_URL = (
    "https://github.com/frida/frida/releases/download/"
    "{version}/frida-server-{version}-android-{arch}.xz"
)
ALL_ARCHES = ["arm64", "arm", "x86_64", "x86"]
DEFAULT_ARCHES = ["arm64", "arm"]


def installed_frida_version() -> str | None:
    try:
        import frida  # type: ignore

        return getattr(frida, "__version__", None)
    except Exception:
        return None


def fetch(version: str, arch: str) -> bool:
    url = RELEASE_URL.format(version=version, arch=arch)
    dest = OUT_DIR / f"frida-server-android-{arch}"
    print(f"  {arch}: {url}")
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            compressed = resp.read()
    except urllib.error.HTTPError as e:
        print(f"    ! HTTP {e.code} — no release asset for {version}/{arch}")
        return False
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"    ! download failed: {e}")
        return False
    try:
        binary = lzma.decompress(compressed)
    except lzma.LZMAError as e:
        print(f"    ! decompress failed: {e}")
        return False
    dest.write_bytes(binary)
    print(f"    -> {dest}  ({len(binary) // 1024} KiB)")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", help="frida version (default: installed package)")
    parser.add_argument("--arch", nargs="+", help="ABIs to fetch (arm64 arm x86_64 x86)")
    parser.add_argument("--all", action="store_true", help="fetch all four Android ABIs")
    args = parser.parse_args()

    version = args.version or installed_frida_version()
    if not version:
        print("Could not determine frida version. Install `frida` or pass --version.")
        return 1

    arches = ALL_ARCHES if args.all else (args.arch or DEFAULT_ARCHES)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Fetching frida-server {version} for: {', '.join(arches)}")
    ok = sum(fetch(version, a) for a in arches)
    print(f"Done: {ok}/{len(arches)} binaries in {OUT_DIR}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
