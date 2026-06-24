"""In-memory state: FlowStore, PendingFlows, Rules, and ConnectionState.

Everything lives in the one Python process so the mitmproxy addon, the WS
handler, and the rule list share memory directly (SPEC §4, §10).
"""

from __future__ import annotations

import json
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from . import rules as rules_mod
from .config import FLOW_STORE_MAX, RULES_PATH


# --- captured flows --------------------------------------------------------


class FlowStore:
    """Ring buffer of serialized flow dicts, keyed by flow id.

    Stores the serialized form so late-joining UIs can be replayed cheaply.
    A flow is updated in place as it moves request → response.
    """

    def __init__(self, maxlen: int = FLOW_STORE_MAX) -> None:
        self._flows: "OrderedDict[str, dict[str, Any]]" = OrderedDict()
        self._max = maxlen

    def upsert(self, serialized: dict[str, Any]) -> None:
        fid = serialized["id"]
        self._flows[fid] = serialized
        self._flows.move_to_end(fid)
        while len(self._flows) > self._max:
            self._flows.popitem(last=False)

    def recent(self, limit: int) -> list[dict[str, Any]]:
        items = list(self._flows.values())
        return items[-limit:] if limit else items

    def clear(self) -> None:
        self._flows.clear()


# --- paused (intercepted) flows -------------------------------------------


class PendingFlows:
    """Registry of paused mitmproxy flow objects, keyed by flow id (SPEC §10).

    Holds the live flow objects (not serialized) so forward/drop can mutate and
    resume them. Wired up in M4.
    """

    def __init__(self) -> None:
        self._pending: dict[str, Any] = {}

    def add(self, flow) -> None:
        self._pending[flow.id] = flow

    def pop(self, flow_id: str):
        return self._pending.pop(flow_id, None)

    def get(self, flow_id: str):
        return self._pending.get(flow_id)

    def has(self, flow_id: str) -> bool:
        return flow_id in self._pending

    def count(self) -> int:
        return len(self._pending)


# --- rules -----------------------------------------------------------------


class Rules:
    """Ordered rule list, persisted to a JSON file on change (SPEC §8)."""

    def __init__(self) -> None:
        self._rules: list[dict[str, Any]] = []
        self.load()

    @property
    def list(self) -> list[dict[str, Any]]:
        return self._rules

    def set(self, rules: list[dict[str, Any]]) -> None:
        self._rules = rules
        self.save()

    def match(self, flow, direction: str):
        return rules_mod.first_match(self._rules, flow, direction)

    def load(self) -> None:
        try:
            if RULES_PATH.exists():
                self._rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            self._rules = []

    def save(self) -> None:
        try:
            RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
            RULES_PATH.write_text(json.dumps(self._rules, indent=2), encoding="utf-8")
        except OSError:
            pass  # persistence is best-effort; never crash the loop over it


# --- connection state (mirrors the `state` object in SPEC §9) --------------


@dataclass
class ConnectionState:
    connected: bool = False
    proxyRunning: bool = False
    certInstalled: bool = False
    deviceSerial: Optional[str] = None
    androidSdk: Optional[int] = None
    hostProxy: Optional[str] = None
    rooted: Optional[bool] = None
    # How the CA was provisioned: "system" (rooted, full HTTPS), "user" (pushed
    # for manual user-cert install — HTTPS only for apps that trust user CAs),
    # or None (not attempted).
    certMode: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# --- top-level container ---------------------------------------------------


@dataclass
class AppState:
    store: FlowStore = field(default_factory=FlowStore)
    pending: PendingFlows = field(default_factory=PendingFlows)
    rules: Rules = field(default_factory=Rules)
    conn: ConnectionState = field(default_factory=ConnectionState)
