"""Host network helpers: LAN IP detection, free-port checks, firewall hint."""

from __future__ import annotations

import socket


def host_lan_ip() -> str:
    """Best-effort host LAN address the emulator can reach (SPEC §7.4).

    Opens a UDP socket toward a public IP — no packets are actually sent; this
    just makes the OS pick the egress interface, whose local address we read.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def is_port_free(host: str, port: int) -> bool:
    """True if we can bind host:port right now."""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def firewall_hint(port: int) -> str:
    """The Windows Firewall instruction to surface on inbound-block (SPEC §7.4)."""
    return (
        f"Windows Firewall may be blocking inbound TCP {port}. Allow Python "
        f"through the firewall, or run as admin:\n"
        f'  netsh advfirewall firewall add rule name=NoxProxy dir=in '
        f"action=allow protocol=TCP localport={port}"
    )
