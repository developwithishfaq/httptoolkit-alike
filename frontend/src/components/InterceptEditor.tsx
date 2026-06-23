import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { selectPending, useStore } from "../store";
import { sendAction } from "../ws";
import { methodColor } from "../util";

// The paused-request editor (SPEC §8). Opens for the flow in `interceptId`.
// Request-pauses edit method/URL/headers/body; response-pauses edit
// status/headers/body. Send forwards (with edits), Drop kills the request.
export default function InterceptEditor() {
  const interceptId = useStore((s) => s.interceptId);
  const flow = useStore((s) => (interceptId ? s.flows.get(interceptId) : undefined));
  const setInterceptId = useStore((s) => s.setInterceptId);
  const pending = useStore(selectPending);

  const isResponse = !!flow && flow.status != null;

  const [method, setMethod] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [headers, setHeaders] = useState<[string, string][]>([]);
  const [body, setBody] = useState("");

  // (Re)load editable state whenever the open flow changes.
  useEffect(() => {
    if (!flow) return;
    setMethod(flow.method);
    setUrl(flow.url);
    setStatus(flow.status != null ? String(flow.status) : "");
    const h = isResponse ? flow.respHeaders : flow.reqHeaders;
    setHeaders(Object.entries(h || {}));
    setBody((isResponse ? flow.respBody : flow.reqBody) || "");
  }, [interceptId, flow?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!flow || flow.phase !== "paused") return null;

  const headerObj = () => {
    const o: Record<string, string> = {};
    for (const [k, v] of headers) if (k.trim()) o[k] = v;
    return o;
  };

  const onSend = () => {
    const edits = isResponse
      ? { status: Number(status), headers: headerObj(), body }
      : { method, url, headers: headerObj(), body };
    sendAction({ action: "forward", id: flow.id, edits });
    next();
  };
  const onDrop = () => {
    sendAction({ action: "drop", id: flow.id });
    next();
  };
  const next = () => {
    const remaining = pending.filter((p) => p.id !== flow.id);
    setInterceptId(remaining[0]?.id ?? null);
  };

  const formatJson = () => {
    try {
      setBody(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      /* not JSON — leave as-is */
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-6">
      <div className="flex max-h-full w-[680px] flex-col overflow-hidden rounded-lg border border-amber-700/60 bg-ink-850 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-600 bg-amber-950/40 px-4 py-2">
          <span className="text-amber-400">⏸ Intercepted</span>
          <span className={`font-mono text-sm font-semibold ${methodColor(flow.method)}`}>
            {flow.method}
          </span>
          <span className="text-xs text-slate-400">
            {isResponse ? "response pause" : "request pause"}
          </span>
          {pending.length > 1 && (
            <span className="rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">
              {pending.length} in queue
            </span>
          )}
          <button
            onClick={() => setInterceptId(null)}
            className="ml-auto rounded px-2 text-slate-500 hover:text-slate-200"
            title="Close (leaves it paused)"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-auto p-4">
          {isResponse ? (
            <Field label="Status">
              <input
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-28 rounded bg-ink-700 px-2 py-1 font-mono text-sm text-slate-200 outline-none"
              />
            </Field>
          ) : (
            <>
              <Field label="Method">
                <input
                  value={method}
                  onChange={(e) => setMethod(e.target.value.toUpperCase())}
                  className="w-28 rounded bg-ink-700 px-2 py-1 font-mono text-sm text-slate-200 outline-none"
                />
              </Field>
              <Field label="URL">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full rounded bg-ink-700 px-2 py-1 font-mono text-xs text-slate-200 outline-none"
                />
              </Field>
            </>
          )}

          <Field label="Headers">
            <div className="space-y-1">
              {headers.map(([k, v], i) => (
                <div key={i} className="flex gap-1">
                  <input
                    value={k}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = [e.target.value, v];
                      setHeaders(next);
                    }}
                    className="w-1/3 rounded bg-ink-700 px-2 py-1 font-mono text-xs text-slate-300 outline-none"
                  />
                  <input
                    value={v}
                    onChange={(e) => {
                      const next = [...headers];
                      next[i] = [k, e.target.value];
                      setHeaders(next);
                    }}
                    className="flex-1 rounded bg-ink-700 px-2 py-1 font-mono text-xs text-slate-300 outline-none"
                  />
                  <button
                    onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                    className="rounded bg-ink-700 px-2 text-slate-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => setHeaders([...headers, ["", ""]])}
                className="rounded bg-ink-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
              >
                + header
              </button>
            </div>
          </Field>

          <Field label="Body">
            <div>
              <button
                onClick={formatJson}
                className="mb-1 rounded bg-ink-700 px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-200"
              >
                format JSON
              </button>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="w-full rounded bg-ink-900 p-2 font-mono text-xs text-slate-200 outline-none"
              />
            </div>
          </Field>
        </div>

        <div className="flex gap-2 border-t border-ink-600 px-4 py-3">
          <button
            onClick={onSend}
            className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:brightness-110"
          >
            Send
          </button>
          <button
            onClick={onDrop}
            className="rounded bg-red-700 px-4 py-1.5 text-sm font-medium text-white hover:brightness-110"
          >
            Drop
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {children}
    </div>
  );
}
