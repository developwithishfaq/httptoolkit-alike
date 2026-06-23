"""Rule matching logic (SPEC §8 rules panel, §10 engine).

Rules are plain dicts (persisted as JSON). A rule matches a flow when it is
enabled, its direction matches the current hook, and every provided criterion
matches. v1's only action is "pause for edit", so this module just answers
"does this flow match an enabled rule for this direction?".
"""

from __future__ import annotations

import re
from typing import Any, Optional


def rule_matches(rule: dict[str, Any], flow, direction: str) -> bool:
    if not rule.get("enabled", False):
        return False
    if rule.get("direction", "request") != direction:
        return False

    match = rule.get("match", {}) or {}
    req = flow.request

    method = match.get("method")
    if method and method != "any" and req.method.upper() != method.upper():
        return False

    host_contains = match.get("hostContains")
    if host_contains and host_contains.lower() not in req.pretty_host.lower():
        return False

    url_regex = match.get("urlRegex")
    if url_regex:
        try:
            if not re.search(url_regex, req.pretty_url):
                return False
        except re.error:
            # A malformed regex never matches rather than crashing the hook.
            return False

    return True


def first_match(rules: list[dict[str, Any]], flow, direction: str) -> Optional[dict[str, Any]]:
    """Return the first enabled rule (in order) matching this flow/direction."""
    for rule in rules:
        if rule_matches(rule, flow, direction):
            return rule
    return None
