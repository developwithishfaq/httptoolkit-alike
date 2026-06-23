import type { ReactNode } from "react";
import { useStore } from "../store";
import { sendAction } from "../ws";

// Diagnostics / prerequisite report (SPEC §3, M5). Clearly shows what's
// missing instead of failing silently, with the firewall hint to copy.
export default function Diagnostics() {
  const open = useStore((s) => s.diagOpen);
  const setOpen = useStore((s) => s.setDiagOpen);
  const p = useStore((s) => s.prereqs);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-6">
      <div className="w-[560px] overflow-hidden rounded-lg border border-ink-600 bg-ink-850 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-ink-600 px-4 py-2">
          <span className="text-sm font-semibold text-slate-200">Diagnostics</span>
          <button
            onClick={() => sendAction({ action: "check_prereqs" })}
            className="rounded bg-ink-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-ink-600"
          >
            re-check
          </button>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto rounded px-2 text-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        {!p ? (
          <div className="p-4 text-sm text-slate-500">No data — is the backend running?</div>
        ) : (
          <div className="space-y-3 p-4">
            <Check label="adb" ok={p.adb.ok} detail={p.adb.detail} />
            <Check label="mitmproxy CA" ok={p.mitmCA.ok} detail={p.mitmCA.detail} />

            <Row label="Host LAN IP">
              <span className="font-mono text-slate-300">{p.hostIp}</span>
            </Row>
            <Row label="Proxy">
              <span className="font-mono text-accent">{p.hostIp}:{p.proxyPort}</span>
              <span className="ml-2 text-xs text-slate-500">(set this in Nox if connecting manually)</span>
            </Row>

            <div>
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Firewall
                <button
                  onClick={() => navigator.clipboard?.writeText(p.firewallHint)}
                  className="rounded bg-ink-700 px-2 py-0.5 text-[10px] normal-case text-slate-400 hover:text-slate-200"
                >
                  copy
                </button>
              </div>
              <pre className="whitespace-pre-wrap rounded bg-ink-900 p-2 font-mono text-[11px] leading-relaxed text-slate-400">
                {p.firewallHint}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Check({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className={ok ? "text-emerald-400" : "text-red-400"}>{ok ? "✓" : "✗"}</span>
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        <div className="break-words font-mono text-xs text-slate-500">{detail}</div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-28 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
