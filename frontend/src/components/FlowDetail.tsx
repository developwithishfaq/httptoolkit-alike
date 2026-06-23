import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, Crosshair, RotateCw, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "../store";
import type { Flow } from "../types";
import { fmtSize, headerVal, methodColor, ruleFromFlow, sourceFromUA, statusColor, toCurl, tryPrettyJson } from "../util";

export default function FlowDetail() {
  const selectedId = useStore((s) => s.selectedId);
  const flow = useStore((s) => (selectedId ? s.flows.get(selectedId) : undefined));
  const select = useStore((s) => s.select);
  const openResend = useStore((s) => s.openResend);
  const openRulesWith = useStore((s) => s.openRulesWith);
  const [copied, setCopied] = useState(false);

  // Empty state — mirrors HTTP Toolkit's "select an exchange" placeholder.
  if (!flow) {
    return (
      <div className="flex h-full w-[44%] min-w-[400px] flex-col items-center justify-center gap-6 border-l border-paper-200 bg-paper-50 text-slate-300">
        <ArrowLeft size={72} strokeWidth={1.25} />
        <div className="text-xl text-slate-400">Select an exchange to see the full details.</div>
      </div>
    );
  }

  const resend = () =>
    openResend({
      method: flow.method,
      url: flow.url,
      headers: Object.entries(flow.reqHeaders || {}),
      body: flow.reqBinary ? "" : flow.reqBody || "",
    });

  const copyCurl = () => {
    navigator.clipboard?.writeText(toCurl(flow));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Open the Rules drawer with a pre-filled draft that pauses (intercepts)
  // requests matching this exact URL and method. The user reviews and Saves it.
  const interceptLike = () => openRulesWith(ruleFromFlow(flow));

  return (
    <div className="flex h-full w-[44%] min-w-[400px] flex-col border-l border-paper-200 bg-paper-50">
      {/* action row */}
      <div className="flex items-center gap-2 border-b border-paper-200 bg-white px-3 py-2">
        <span className="flex-1 truncate font-mono text-[13px] text-slate-600" title={flow.url}>
          {flow.url}
        </span>
        <button
          onClick={interceptLike}
          title={`Intercept such request — create a rule matching ${flow.method} ${flow.url}`}
          className="flex items-center gap-1 rounded border border-paper-200 px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-paper-100 hover:text-brand"
        >
          <Crosshair size={14} /> Intercept
        </button>
        <button
          onClick={copyCurl}
          title="Copy as cURL"
          className="flex items-center gap-1 rounded border border-paper-200 px-2 py-1 text-[12px] font-medium text-slate-600 hover:bg-paper-100 hover:text-brand"
        >
          {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          {copied ? "Copied" : "cURL"}
        </button>
        <IconAction title="Edit and resend this request" onClick={resend}>
          <RotateCw size={15} />
        </IconAction>
        <IconAction title="Close" onClick={() => select(null)}>
          <X size={15} />
        </IconAction>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {/* REQUEST card */}
        <Card
          label="REQUEST"
          right={
            <>
              <span className="rounded bg-paper-100 px-1.5 py-0.5 text-[12px] text-slate-500">
                HTTP/1.1
              </span>
              <span className="font-mono text-[13px] text-slate-600">
                <span className={methodColor(flow.method)}>{flow.method}</span> {flow.host}
              </span>
              <SourceDot flow={flow} />
            </>
          }
        >
          <Field label="METHOD" value={flow.method} valueClass={methodColor(flow.method)} />
          <Field label="URL" value={flow.url} />
          <QuerySection flow={flow} />
          <HeadersSection title="HEADERS" headers={flow.reqHeaders} />
          <BodySection
            title="BODY"
            body={flow.reqBody}
            binary={flow.reqBinary}
            size={flow.reqSize}
            truncated={flow.reqTruncated}
            contentType={headerVal(flow.reqHeaders, "content-type")}
          />
        </Card>

        {/* RESPONSE card */}
        <Card
          label="RESPONSE"
          right={
            flow.status != null ? (
              <span className={`font-mono text-[13px] font-semibold ${statusColor(flow.status)}`}>
                {flow.status}
              </span>
            ) : (
              <span className="text-[12px] text-slate-400">pending…</span>
            )
          }
        >
          {flow.status == null ? (
            <div className="py-2 text-sm text-slate-400">Waiting for response…</div>
          ) : (
            <>
              <Field
                label="STATUS"
                value={`${flow.status}${flow.reason ? ` ${flow.reason}` : ""}`}
                valueClass={statusColor(flow.status)}
              />
              <HeadersSection title="HEADERS" headers={flow.respHeaders} />
              <BodySection
                title={`BODY${flow.respSize != null ? ` · ${fmtSize(flow.respSize)}` : ""}`}
                body={flow.respBody}
                binary={flow.respBinary}
                size={flow.respSize}
                truncated={flow.respTruncated}
                contentType={headerVal(flow.respHeaders, "content-type")}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function IconAction({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-paper-100 hover:text-slate-700"
    >
      {children}
    </button>
  );
}

function SourceDot({ flow }: { flow: Flow }) {
  const src = sourceFromUA(flow.reqHeaders);
  const color =
    src === "android" ? "bg-emerald-500" : src === "chrome" ? "bg-sky-500" : "bg-slate-400";
  return <span className={`h-3 w-3 rounded-full ${color}`} title={src} />;
}

// A collapsible card with a colored label (REQUEST/RESPONSE) and a right slot.
function Card({
  label,
  right,
  children,
}: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="overflow-hidden rounded-lg border border-paper-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 border-b border-paper-100 bg-paper-50 px-3 py-2.5"
      >
        <span className="text-[13px] font-bold tracking-wide text-brand">{label}</span>
        <div className="ml-auto flex items-center gap-2">{right}</div>
        {open ? (
          <ChevronDown size={16} className="text-slate-400" />
        ) : (
          <ChevronRight size={16} className="text-slate-400" />
        )}
      </button>
      {open && <div className="px-3 py-2">{children}</div>}
    </div>
  );
}

// A single label: value row (METHOD, URL, STATUS).
function Field({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex gap-3 py-1.5 text-[14px]">
      <span className="w-20 shrink-0 font-semibold tracking-wide text-slate-400">{label}</span>
      <span className={`break-all font-mono ${valueClass ?? "text-slate-700"}`}>{value}</span>
    </div>
  );
}

// A collapsible labeled section (HEADERS / BODY / QUERY).
function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-t border-paper-100 py-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 py-1 text-[13px] font-semibold tracking-wide text-slate-500 hover:text-slate-700"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className="pb-1 pl-4">{children}</div>}
    </div>
  );
}

function QuerySection({ flow }: { flow: Flow }) {
  const params = parseQuery(flow.url);
  if (params.length === 0) return null;
  return (
    <Section title="QUERY">
      <KvTable rows={params} />
    </Section>
  );
}

function HeadersSection({
  title,
  headers,
}: {
  title: string;
  headers?: Record<string, string>;
}) {
  return (
    <Section title={title}>
      <KvTable rows={Object.entries(headers || {})} />
    </Section>
  );
}

function BodySection(props: {
  title: string;
  body?: string;
  binary?: boolean;
  size?: number;
  truncated?: boolean;
  contentType?: string;
}) {
  return (
    <Section title={props.title}>
      <BodyView {...props} />
    </Section>
  );
}

function KvTable({ rows }: { rows: [string, string][] }) {
  if (rows.length === 0) {
    return <div className="text-[13px] text-slate-400">none</div>;
  }
  return (
    <table className="w-full font-mono text-[13px]">
      <tbody>
        {rows.map(([k, v], i) => (
          <tr key={i} className="align-top">
            <td className="w-1/3 break-words py-1 pr-3 text-slate-500">{k}</td>
            <td className="break-words py-1 text-slate-700">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BodyView({
  body,
  binary,
  size,
  truncated,
  contentType,
}: {
  title?: string;
  body?: string;
  binary?: boolean;
  size?: number;
  truncated?: boolean;
  contentType?: string;
}) {
  const [raw, setRaw] = useState(false);

  if (binary) {
    return <div className="text-[13px] text-slate-400">binary, {fmtSize(size)} — not displayed</div>;
  }
  if (!body) {
    return <div className="text-[13px] text-slate-400">empty</div>;
  }

  const pretty = tryPrettyJson(body, contentType);
  const shown = !raw && pretty ? pretty : body;

  return (
    <div>
      {pretty && (
        <button
          onClick={() => setRaw((r) => !r)}
          className="mb-1 rounded bg-paper-100 px-2 py-0.5 text-[12px] text-slate-500 hover:text-slate-700"
        >
          {raw ? "pretty JSON" : "raw"}
        </button>
      )}
      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded bg-paper-50 p-2.5 font-mono text-[13px] leading-relaxed text-slate-700">
        {shown}
        {truncated && <span className="text-amber-600">{"\n… (truncated)"}</span>}
      </pre>
    </div>
  );
}

function parseQuery(url: string): [string, string][] {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries());
  } catch {
    return [];
  }
}
