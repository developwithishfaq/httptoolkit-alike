"""CertManager: locate the mitmproxy CA, compute its Android filename, build .0.

Android stores system CAs as ``<subject_hash_old>.0`` (SPEC §7.2). We compute
the hash in pure Python so the backend has no hard dependency on system
OpenSSL; if ``openssl`` happens to be on PATH we use it as a cross-check.

This module is pure and side-effect-light (it only reads the CA and writes a
derived file into a temp/output dir) so it is unit-testable in isolation. It is
wired into the Connect orchestration in M3.
"""

from __future__ import annotations

import hashlib
import shutil
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from cryptography import x509
from cryptography.hazmat.primitives import serialization

from .config import MITM_CA_PEM, SUBPROCESS_NO_WINDOW


@dataclass
class CertInfo:
    pem_path: Path
    subject_hash: str          # 8-hex-char subject_hash_old
    android_filename: str      # "<hash>.0"
    built_path: Optional[Path] = None  # the .0 file we wrote, ready to push


def subject_hash_old(pem_bytes: bytes) -> str:
    """OpenSSL's legacy subject hash: first 4 bytes of MD5(DER subject), LE."""
    cert = x509.load_pem_x509_certificate(pem_bytes)
    der_subject = cert.subject.public_bytes(serialization.Encoding.DER)
    digest = hashlib.md5(der_subject).digest()
    val = struct.unpack("<I", digest[:4])[0]
    return f"{val:08x}"


class CertManager:
    def __init__(self, pem_path: Path = MITM_CA_PEM) -> None:
        self.pem_path = pem_path

    def ca_exists(self) -> bool:
        return self.pem_path.exists()

    def compute(self) -> CertInfo:
        """Read the CA and compute its Android cert filename.

        Raises FileNotFoundError if the CA is missing (proxy must run once
        first so mitmproxy generates it — SPEC §7.2).
        """
        if not self.ca_exists():
            raise FileNotFoundError(
                f"mitmproxy CA not found at {self.pem_path}. Start the proxy once "
                f"so mitmproxy generates it."
            )
        pem_bytes = self.pem_path.read_bytes()
        h = subject_hash_old(pem_bytes)
        return CertInfo(pem_path=self.pem_path, subject_hash=h, android_filename=f"{h}.0")

    def build_android_cert(self, info: CertInfo, out_dir: Path) -> Path:
        """Write the ``<hash>.0`` file (PEM block) into out_dir; return its path.

        Android accepts the PEM alone; the human-readable text dump is cosmetic
        and omitted for v1 simplicity.
        """
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / info.android_filename
        out_path.write_bytes(info.pem_path.read_bytes())
        info.built_path = out_path
        return out_path

    def openssl_crosscheck(self, info: CertInfo) -> Optional[bool]:
        """If openssl is on PATH, verify it agrees with our Python hash.

        Returns True/False on agreement, or None if openssl is unavailable.
        """
        exe = shutil.which("openssl")
        if not exe:
            return None
        try:
            out = subprocess.run(
                [exe, "x509", "-inform", "PEM", "-subject_hash_old", "-in", str(info.pem_path)],
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=SUBPROCESS_NO_WINDOW,  # no popup cmd window (Windows)
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return out.stdout.strip().lower().startswith(info.subject_hash)
