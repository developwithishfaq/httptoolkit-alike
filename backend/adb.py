"""AdbOrchestrator: locate adb, connect to Nox, root, query, push, set proxy.

Kept UI-agnostic — every method returns a structured ``AdbResult`` (SPEC
implementation notes) so it is unit-testable by mocking the subprocess. All
commands run non-interactively via ``asyncio.create_subprocess_exec`` (never
``shell=True``) and always pass ``-s <serial>`` once a device is known
(SPEC §7.1). Wired into the Connect orchestration in M3.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .config import ADB_OVERRIDE, NOX_ADB_ENDPOINTS, SUBPROCESS_NO_WINDOW


@dataclass
class AdbResult:
    ok: bool
    stdout: str = ""
    stderr: str = ""
    code: int = -1

    @property
    def text(self) -> str:
        return (self.stdout or self.stderr).strip()


def _reg_get(key, name: str) -> Optional[str]:
    try:
        import winreg

        val, _ = winreg.QueryValueEx(key, name)
        return val if isinstance(val, str) else None
    except (OSError, ImportError):
        return None


def _bin_dir_from_value(value: Optional[str]) -> Optional[Path]:
    """Turn a registry value (a file path or install dir) into a Nox bin dir."""
    if not value:
        return None
    # Take the first quoted token if present, else the whole string.
    token = value.split('"')[1] if '"' in value else value.split(",")[0].strip()
    p = Path(token)
    if p.suffix.lower() == ".exe":
        return p.parent  # .../Nox/bin/Nox_unload.exe -> .../Nox/bin
    if p.name.lower() == "bin":
        return p
    return p / "bin"  # install root -> root/bin


def _registry_nox_bin_dirs() -> list[Path]:
    """Find Nox's bin dir from the Windows uninstall registry (SPEC §7.1).

    InstallLocation is often blank, so we also parse DisplayIcon/UninstallString
    which point at an exe inside <Nox>\\bin.
    """
    dirs: list[Path] = []
    try:
        import winreg
    except ImportError:
        return dirs

    bases = [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ]
    for hive, base in bases:
        try:
            with winreg.OpenKey(hive, base) as bkey:
                i = 0
                while True:
                    try:
                        sub = winreg.EnumKey(bkey, i)
                        i += 1
                    except OSError:
                        break
                    try:
                        with winreg.OpenKey(bkey, sub) as skey:
                            name = _reg_get(skey, "DisplayName") or ""
                            if "nox" not in name.lower():
                                continue
                            for field in ("InstallLocation", "DisplayIcon", "UninstallString"):
                                d = _bin_dir_from_value(_reg_get(skey, field))
                                if d and d not in dirs:
                                    dirs.append(d)
                    except OSError:
                        continue
        except OSError:
            continue
    return dirs


# Candidate locations for Nox's bundled adb, most-specific first (SPEC §7.1).
# We list both nox_adb.exe and adb.exe so we match whichever the Nox-based tool
# uses — same binary version => shared adb server, no version-mismatch fights.
def _nox_adb_candidates() -> list[Path]:
    bin_dirs: list[Path] = []
    for root in (
        os.environ.get("ProgramFiles"),
        os.environ.get("ProgramFiles(x86)"),
        os.environ.get("LOCALAPPDATA"),
    ):
        if root:
            bin_dirs.append(Path(root) / "Nox" / "bin")
    for d in _registry_nox_bin_dirs():
        if d not in bin_dirs:
            bin_dirs.append(d)

    out: list[Path] = []
    for d in bin_dirs:
        out.append(d / "nox_adb.exe")
        out.append(d / "adb.exe")
    return out


class AdbOrchestrator:
    def __init__(self) -> None:
        self.adb_path: Optional[str] = None
        self.serial: Optional[str] = None

    # --- discovery ---------------------------------------------------------

    def _candidates(self) -> list[str]:
        """All adb binaries we could use, in *preference* order.

        Modern platform-tools adb (on PATH, what Android Studio uses) comes
        before Nox's bundled adb. Nox ships an ancient adb (~1.0.36); running it
        kills a newer adb server on port 5037 ("server version doesn't match;
        killing...") and can't talk to recent phones — so we only fall back to
        it when no modern adb exists. ADB_OVERRIDE still wins (SPEC §7.1).
        """
        cands: list[str] = []
        if ADB_OVERRIDE:
            p = Path(ADB_OVERRIDE)
            if p.exists():
                cands.append(str(p))
        on_path = shutil.which("adb")
        if on_path:
            cands.append(on_path)
        for cand in _nox_adb_candidates():
            if cand.exists():
                cands.append(str(cand))
        # De-dup, preserving order.
        seen: set[str] = set()
        out: list[str] = []
        for c in cands:
            if c not in seen:
                seen.add(c)
                out.append(c)
        return out

    def locate(self) -> Optional[str]:
        """Find an adb path (preference order; modern adb first)."""
        cands = self._candidates()
        self.adb_path = cands[0] if cands else None
        return self.adb_path

    async def autoselect(self) -> Optional[str]:
        """Pick the adb that actually sees an online device.

        Probes candidates in preference order and returns the first one that
        lists an online device, so a real USB phone visible to platform-tools
        adb is used directly — and we never invoke Nox's old adb (killing the
        modern server) when the modern one already sees the device. If nothing
        is online yet, returns the first candidate so connect() can still try
        the TCP-connect path (modern adb talks to Nox's endpoints fine).
        """
        cands = self._candidates()
        if not cands:
            self.adb_path = None
            return None
        for cand in cands:
            self.adb_path = cand
            online, _ = await self._list_devices()
            if online:
                self.serial = online[0]
                return cand
        self.adb_path = cands[0]
        return cands[0]

    # --- low-level runner --------------------------------------------------

    async def _run(self, *args: str, timeout: float = 30.0) -> AdbResult:
        if not self.adb_path:
            return AdbResult(ok=False, stderr="adb not located")
        try:
            proc = await asyncio.create_subprocess_exec(
                self.adb_path,
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=SUBPROCESS_NO_WINDOW,  # no popup cmd windows (Windows)
            )
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            return AdbResult(ok=False, stderr=f"adb timed out: {' '.join(args)}")
        except OSError as e:
            return AdbResult(ok=False, stderr=str(e))
        code = proc.returncode or 0
        return AdbResult(
            ok=code == 0,
            stdout=out.decode(errors="replace"),
            stderr=err.decode(errors="replace"),
            code=code,
        )

    async def _shell(self, serial: str, command: str, timeout: float = 30.0) -> AdbResult:
        return await self._run("-s", serial, "shell", command, timeout=timeout)

    # --- connection --------------------------------------------------------

    async def kill_server(self) -> AdbResult:
        return await self._run("kill-server")

    async def devices(self) -> AdbResult:
        return await self._run("devices")

    async def _is_online(self, serial: str) -> bool:
        online, _ = await self._list_devices()
        return serial in online

    async def _list_devices(self) -> tuple[list[str], list[str]]:
        """Parse `adb devices` into (online, unauthorized) serial lists.

        "device" → ready to use; "unauthorized" → the device hasn't accepted the
        "Allow USB debugging" prompt yet. "offline"/other transient states are
        ignored (the caller may kill-server and retry).
        """
        res = await self.devices()
        online: list[str] = []
        unauth: list[str] = []
        if not res.ok:
            return online, unauth
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) < 2 or parts[0] == "List":
                continue
            serial, state = parts[0], parts[1]
            if state == "device":
                online.append(serial)
            elif state == "unauthorized":
                unauth.append(serial)
        return online, unauth

    async def connect(self, endpoints: Optional[list[str]] = None) -> AdbResult:
        """Pick any online ADB device; fall back to Nox's network endpoints.

        HTTP Toolkit-style: a USB device with developer-mode USB debugging
        enabled (and authorized) shows up in `adb devices` as "device", and we
        use it directly — no Nox required. If nothing is online yet, we try
        `adb connect` on Nox's known TCP endpoints and re-scan. On a stubborn
        "offline" we kill-server once and retry (SPEC §7.1).
        """
        endpoints = endpoints or NOX_ADB_ENDPOINTS
        for attempt in range(2):
            # 1) Already-online device (USB phone, emulator, or a live Nox)?
            online, unauth = await self._list_devices()
            if online:
                self.serial = online[0]
                return AdbResult(ok=True, stdout=f"connected: {online[0]}")

            # 2) Nothing online — try bringing Nox's TCP endpoints up, then rescan.
            for ep in endpoints:
                await self._run("connect", ep)
            online, unauth = await self._list_devices()
            if online:
                self.serial = online[0]
                return AdbResult(ok=True, stdout=f"connected: {online[0]}")

            if unauth:
                return AdbResult(ok=False, stderr=(
                    f"device {unauth[0]} is unauthorized — on the device, accept the "
                    "'Allow USB debugging' prompt, then click Connect again."
                ))
            if attempt == 0:
                # Possible nox_adb vs platform-tools conflict → reset once.
                await self.kill_server()
        return AdbResult(ok=False, stderr=(
            "no online device. Plug in a device with USB debugging enabled (and "
            "accept the prompt), or start your emulator, then click Connect."
        ))

    async def root(self, serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._run("-s", serial, "root")

    async def remount(self, serial: Optional[str] = None) -> AdbResult:
        """Make /system writable; fall back to an explicit mount (SPEC §7.3)."""
        serial = serial or self.serial or ""
        res = await self._run("-s", serial, "remount")
        if res.ok:
            return res
        return await self._shell(serial, "mount -o rw,remount /system")

    # --- queries -----------------------------------------------------------

    async def getprop(self, prop: str, serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._shell(serial, f"getprop {prop}")

    async def sdk_level(self, serial: Optional[str] = None) -> Optional[int]:
        res = await self.getprop("ro.build.version.sdk", serial)
        if not res.ok:
            return None
        try:
            return int(res.text)
        except ValueError:
            return None

    async def cpu_abi(self, serial: Optional[str] = None) -> Optional[str]:
        res = await self.getprop("ro.product.cpu.abi", serial)
        return res.text if res.ok and res.text else None

    # --- cert install ------------------------------------------------------

    async def push(self, local: str, remote: str, serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._run("-s", serial, "push", local, remote)

    async def chmod(self, path: str, mode: str = "644", serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._shell(serial, f"chmod {mode} {path}")

    async def push_and_run_script(
        self,
        local_script: str,
        serial: Optional[str] = None,
        remote: str = "/data/local/tmp/nox-inject.sh",
    ) -> AdbResult:
        """Push a shell script to the device and run it as root via sh."""
        serial = serial or self.serial or ""
        pushed = await self.push(local_script, remote, serial)
        if not pushed.ok:
            return pushed
        return await self._shell(serial, f"sh {remote}", timeout=60.0)

    async def file_exists(self, path: str, serial: Optional[str] = None) -> bool:
        serial = serial or self.serial or ""
        res = await self._shell(serial, f"ls -l {path}")
        return res.ok and "No such file" not in res.text

    async def remote_file_size(self, path: str, serial: Optional[str] = None) -> Optional[int]:
        """Byte size of a device-side file, or None if it doesn't exist / unreadable.
        Used to skip re-pushing a frida-server that's already on the device. Tries
        toybox `stat -c %s` first (exact), then falls back to parsing `ls -l`."""
        serial = serial or self.serial or ""
        res = await self._shell(serial, f"stat -c %s {path}")
        text = res.text.strip()
        if res.ok and text.isdigit():
            return int(text)
        # Fallback: toybox `ls -l` — size is the 5th whitespace field.
        res = await self._shell(serial, f"ls -l {path}")
        if res.ok and "No such file" not in res.text:
            parts = res.text.split()
            if len(parts) >= 5 and parts[4].isdigit():
                return int(parts[4])
        return None

    # --- proxy control -----------------------------------------------------

    async def set_proxy(self, host_port: str, serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._shell(serial, f"settings put global http_proxy {host_port}")

    async def clear_proxy(self, serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._shell(serial, "settings put global http_proxy :0")

    async def reboot(self, serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._run("-s", serial, "reboot")

    # --- frida helpers -----------------------------------------------------

    async def forward(self, local_port: int, remote_port: int, serial: Optional[str] = None) -> AdbResult:
        """Map host tcp:local_port → device tcp:remote_port (for frida-server)."""
        serial = serial or self.serial or ""
        return await self._run("-s", serial, "forward", f"tcp:{local_port}", f"tcp:{remote_port}")

    async def remove_forward(self, local_port: int, serial: Optional[str] = None) -> AdbResult:
        serial = serial or self.serial or ""
        return await self._run("-s", serial, "forward", "--remove", f"tcp:{local_port}")

    async def list_packages(self, third_party_only: bool = True, serial: Optional[str] = None) -> list[str]:
        """Installed package names. `-3` limits to user-installed apps (the ones
        worth intercepting); the framework/system apps just add noise."""
        serial = serial or self.serial or ""
        flag = "-3" if third_party_only else ""
        res = await self._shell(serial, f"pm list packages {flag}".strip())
        if not res.ok:
            return []
        pkgs = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if line.startswith("package:"):
                pkgs.append(line[len("package:"):])
        return sorted(pkgs)

    async def spawn_shell(self, command: str, serial: Optional[str] = None):
        """Start a long-lived `adb shell` process and return the Popen handle
        WITHOUT awaiting it (used to keep frida-server alive). Killing the
        returned process tears down its device-side child too."""
        serial = serial or self.serial or ""
        if not self.adb_path:
            return None
        return await asyncio.create_subprocess_exec(
            self.adb_path, "-s", serial, "shell", command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            creationflags=SUBPROCESS_NO_WINDOW,
        )

    async def pidof(self, process: str, serial: Optional[str] = None) -> Optional[int]:
        """First PID of a running process by name, or None. `pidof` is absent on
        some old builds, so fall back to parsing `ps`."""
        serial = serial or self.serial or ""
        res = await self._shell(serial, f"pidof {process}")
        if res.ok and res.text:
            try:
                return int(res.text.split()[0])
            except (ValueError, IndexError):
                pass
        res = await self._shell(serial, f"ps -A | grep {process}")
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 2 and process in line:
                try:
                    return int(parts[1])
                except ValueError:
                    continue
        return None

    async def kill_process(self, process: str, serial: Optional[str] = None) -> AdbResult:
        """Kill a device-side process by name (best-effort, as root)."""
        serial = serial or self.serial or ""
        return await self._shell(serial, f"pkill -f {process}")
