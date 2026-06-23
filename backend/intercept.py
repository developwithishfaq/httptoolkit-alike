"""Apply edits to a paused flow and resume/drop it (M4).

Encapsulates the mitmproxy specifics so the server just calls forward()/drop().
Setting ``flow.request.text`` / ``flow.response.text`` also fixes Content-Length
(SPEC §10). ``kill()`` clears ``intercepted`` without firing the resume event,
so drop() releases the paused hook explicitly.
"""

from __future__ import annotations

from typing import Any, Optional

from mitmproxy.flow import Error
from mitmproxy.http import Headers, Response


def _apply_headers(message, headers: dict[str, str]) -> None:
    """Replace ALL headers on a request/response with the given map."""
    message.headers = Headers(
        [(k.encode("latin-1", "ignore"), v.encode("latin-1", "ignore")) for k, v in headers.items()]
    )


def apply_request_edits(flow, edits: dict[str, Any]) -> None:
    req = flow.request
    if "method" in edits and edits["method"]:
        req.method = edits["method"]
    if "url" in edits and edits["url"]:
        req.url = edits["url"]  # setter updates scheme/host/path/query
    if "headers" in edits and isinstance(edits["headers"], dict):
        _apply_headers(req, edits["headers"])
    if "body" in edits and edits["body"] is not None:
        req.text = edits["body"]  # also fixes Content-Length


def apply_response_edits(flow, edits: dict[str, Any]) -> None:
    resp = flow.response
    if resp is None:
        return
    if "status" in edits and edits["status"] is not None:
        try:
            resp.status_code = int(edits["status"])
        except (TypeError, ValueError):
            pass
    if "headers" in edits and isinstance(edits["headers"], dict):
        _apply_headers(resp, edits["headers"])
    if "body" in edits and edits["body"] is not None:
        resp.text = edits["body"]


def mock_response(flow, spec: dict[str, Any]) -> None:
    """Short-circuit a flow with a fixed response (the "mock" rule action).

    Assigning ``flow.response`` inside the request hook makes mitmproxy skip the
    upstream server entirely; in the response hook it replaces the real one.
    """
    spec = spec or {}
    try:
        status = int(spec.get("status", 200) or 200)
    except (TypeError, ValueError):
        status = 200
    body = spec.get("body") or ""
    headers = spec.get("headers") or {}
    flow.response = Response.make(
        status,
        body.encode("utf-8", "ignore"),
        {str(k): str(v) for k, v in headers.items()},
    )


def forward(flow, edits: Optional[dict[str, Any]]) -> None:
    """Apply edits to whichever side is paused, then resume the flow."""
    edits = edits or {}
    if flow.response is None:
        apply_request_edits(flow, edits)
    else:
        apply_response_edits(flow, edits)
    flow.resume()


def drop(flow) -> None:
    """Kill the flow so the app sees a failed request, and release the hook."""
    if flow.killable:
        flow.kill()  # sets error + live=False + intercepted=False
    else:
        flow.error = Error(Error.KILLED_MESSAGE)
    # kill() does not fire the resume event; do it so wait_for_resume() returns.
    if getattr(flow, "_resume_event", None) is not None:
        flow._resume_event.set()
    elif flow.intercepted:
        flow.resume()
