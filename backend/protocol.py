"""Typed message schemas and (de)serializers for the server↔client protocol.

The WebSocket is the primary channel (SPEC §9). Every server→client message has
a ``type``; every client→server message has an ``action``. This module owns the
translation between mitmproxy flow objects and the JSON shape the UI consumes.
"""

from __future__ import annotations

from typing import Any, Optional

from .config import MAX_BODY_BYTES


# --- header helpers --------------------------------------------------------


def headers_to_dict(headers) -> dict[str, str]:
    """Flatten mitmproxy Headers to a plain dict.

    Duplicate header keys are joined with ", " so nothing is silently lost
    while still giving the UI a simple key/value map.
    """
    out: dict[str, str] = {}
    for key, value in headers.items(multi=True):
        if key in out:
            out[key] = f"{out[key]}, {value}"
        else:
            out[key] = value
    return out


def _body_text(message) -> tuple[Optional[str], bool, bool]:
    """Return (text, is_binary, truncated) for a request/response message.

    Uses ``get_text(strict=False)``; if it yields None the content is
    binary/undecodable and we report size instead of bytes (SPEC §10).
    """
    raw = message.raw_content
    if not raw:
        return "", False, False
    try:
        text = message.get_text(strict=False)
    except Exception:
        text = None
    if text is None:
        return None, True, False
    truncated = False
    if len(text) > MAX_BODY_BYTES:
        text = text[:MAX_BODY_BYTES]
        truncated = True
    return text, False, truncated


# --- flow serialization ----------------------------------------------------


def serialize_flow(flow, phase: str) -> dict[str, Any]:
    """Convert a mitmproxy HTTPFlow into a wire ``flow`` message.

    ``phase`` is one of "request" | "paused" | "response".
    """
    req = flow.request
    msg: dict[str, Any] = {
        "type": "flow",
        "phase": phase,
        "id": flow.id,
        "tStart": req.timestamp_start,
        "method": req.method,
        "scheme": req.scheme,
        "host": req.pretty_host,
        "path": req.path,
        "url": req.pretty_url,
        "reqHeaders": headers_to_dict(req.headers),
    }

    req_body, req_binary, req_trunc = _body_text(req)
    msg["reqBinary"] = req_binary
    msg["reqSize"] = len(req.raw_content or b"")
    if not req_binary:
        msg["reqBody"] = req_body
        msg["reqTruncated"] = req_trunc

    if flow.response is not None:
        resp = flow.response
        msg["status"] = resp.status_code
        msg["reason"] = resp.reason
        msg["respHeaders"] = headers_to_dict(resp.headers)
        resp_body, resp_binary, resp_trunc = _body_text(resp)
        msg["respBinary"] = resp_binary
        msg["respSize"] = len(resp.raw_content or b"")
        if not resp_binary:
            msg["respBody"] = resp_body
            msg["respTruncated"] = resp_trunc
        if resp.timestamp_end and req.timestamp_start:
            msg["durationMs"] = round((resp.timestamp_end - req.timestamp_start) * 1000)

    return msg


# --- control messages ------------------------------------------------------


def status_msg(step: str, ok: bool, message: str, state: dict[str, Any]) -> dict[str, Any]:
    return {"type": "status", "step": step, "ok": ok, "message": message, "state": state}


def rules_msg(rules: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "rules", "rules": rules}


def prereqs_msg(prereqs: dict[str, Any]) -> dict[str, Any]:
    return {"type": "prereqs", "prereqs": prereqs}


def error_msg(message: str) -> dict[str, Any]:
    return {"type": "error", "message": message}
