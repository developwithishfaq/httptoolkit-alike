import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { selectByReplayToken, useStore } from "../store";
import type { Flow } from "../types";
import { sendAction } from "../ws";
import { fmtDuration, fmtSize, headerVal, methodColor, statusColor, tryPrettyJson } from "../util";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

// Shared light-theme input styling, matching the View screen's filter field.
const inputCls =
  "rounded border border-paper-200 bg-white px-2 py-1 text-slate-ink outline-none placeholder:text-slate-400 focus:border-accent focus:ring-1 focus:ring-accent";

// Dedicated request-builder / replay screen (SPEC §8). Prefilled from a captured
// flow (via FlowDetail → Resend) or blank (New request). Sends through our own
// proxy so the result is captured and shown both in the flow list and inline here.
export default function ResendScreen() {
  const open = useStore((s) => s.resendOpen);
  const seed = useStore((s) => s.resendSeed);
  const close = useStore((s) => s.closeResend);

  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<[string, string][]>([]);
  const [body, setBody] = useState("");
  const [token, setToken] = useState<string | null>(null);

  // (Re)seed the form each time the screen opens.
  useEffect(() => {
    if (!open) return;
    setMethod(seed?.method || "GET");
    setUrl(seed?.url || "");
    setHeaders(seed?.headers ? seed.headers.map((h) => [...h] as [string, string]) : []);
    setBody(seed?.body || "");
    setToken(null);
  }, [open, seed]);

  // Live result of the last send, matched by replay token.
  const result = useStore(useMemo(() => selectByReplayToken(token), [token]));

  if (!open) return null;

  const headerObj = () => {
    const o: Record<string, string> = {};
    for (const [k, v] of headers) if (k.trim()) o[k] = v;
    return o;
  };

  const onSend = () => {
    if (!url.trim()) return;
    const t = crypto.randomUUID();
    setToken(t);
    sendAction({
      action: "resend",
      request: { method, url: url.trim(), headers: headerObj(), body, token: t },
    });
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-6">
      <div className="flex max-h-full w-[900px] flex-col overflow-hidden rounded-lg border border-paper-200 bg-paper-50 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-paper-200 bg-white px-4 py-2">
          <span className="text-sm font-semibold text-slate-700">Resend request</span>
          <span className="text-xs text-slate-400">replayed through the proxy — appears in the flow list</span>
          <button
            onClick={close}
            className="ml-auto rounded px-2 text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* request builder */}
          <div className="flex w-1/2 flex-col gap-3 overflow-auto border-r border-paper-200 p-4">
            <div className="flex gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className={`rounded border border-paper-200 bg-white px-2 py-1.5 font-mono text-sm font-semibold outline-none focus:border-accent ${methodColor(method)}`}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m} className="text-slate-700">{m}</option>
                ))}
              </select>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://api.example.com/v1/login"
                className={`flex-1 py-1.5 font-mono text-xs ${inputCls}`}
              />
            </div>

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
                      className={`w-1/3 font-mono text-xs ${inputCls}`}
                    />
                    <input
                      value={v}
                      onChange={(e) => {
                        const next = [...headers];
                        next[i] = [k, e.target.value];
                        setHeaders(next);
                      }}
                      className={`flex-1 font-mono text-xs ${inputCls}`}
                    />
                    <button
                      onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                      className="rounded bg-paper-100 px-2 text-slate-400 hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setHeaders([...headers, ["", ""]])}
                  className="rounded bg-paper-100 px-2 py-1 text-xs text-slate-500 hover:text-slate-700"
                >
                  + header
                </button>
              </div>
            </Field>

            <Field label="Body">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                placeholder="request body…"
                className={`w-full p-2 font-mono text-xs ${inputCls}`}
              />
            </Field>
          </div>

          {/* response */}
          <div className="flex w-1/2 flex-col overflow-auto p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Response
            </div>
            <ResultView token={token} flow={result} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-paper-200 bg-white px-4 py-3">
          <button
            onClick={onSend}
            disabled={!url.trim()}
            className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            Send
          </button>
          <button
            onClick={close}
            className="rounded border border-paper-200 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-paper-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultView({ token, flow }: { token: string | null; flow?: Flow }) {
  if (!token) {
    return <div className="text-sm text-slate-400">Send the request to see the response here.</div>;
  }
  if (!flow || (flow.status == null && !flow.error)) {
    return <div className="text-sm text-slate-500">Sending…</div>;
  }
  if (flow.error) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Request failed: {flow.error}
      </div>
    );
  }

  const ct = headerVal(flow.respHeaders, "content-type");
  const pretty = tryPrettyJson(flow.respBody, ct);
  const shown = pretty || flow.respBody || "";
  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-3">
        <span className={`font-mono text-sm font-semibold ${statusColor(flow.status)}`}>
          {flow.status} {flow.reason}
        </span>
        <span className="text-slate-400">{fmtSize(flow.respSize)}</span>
        <span className="text-slate-400">{fmtDuration(flow.durationMs)}</span>
      </div>
      <div>
        <div className="mb-1 text-[11px] text-slate-400">headers</div>
        <table className="w-full font-mono text-xs">
          <tbody>
            {Object.entries(flow.respHeaders || {}).map(([k, v], i) => (
              <tr key={i} className="align-top">
                <td className="w-1/3 break-words py-0.5 pr-3 text-slate-500">{k}</td>
                <td className="break-words py-0.5 text-slate-700">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="mb-1 text-[11px] text-slate-400">body</div>
        {flow.respBinary ? (
          <div className="text-slate-400">binary, {fmtSize(flow.respSize)} — not displayed</div>
        ) : (
          <pre className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded border border-paper-200 bg-paper-50 p-2 font-mono text-xs leading-relaxed text-slate-700">
            {shown || "empty"}
            {flow.respTruncated && <span className="text-amber-600">{"\n… (truncated)"}</span>}
          </pre>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </div>
      {children}
    </div>
  );
}
