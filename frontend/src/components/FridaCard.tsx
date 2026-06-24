import { useMemo, useState } from "react";
import { FRIDA_STEPS, useStore } from "../store";
import { sendAction } from "../ws";

// "Android app via Frida" — the per-app interception path (HTTP Toolkit's Frida
// feature). Self-contained: renders the entry card, the live setup checklist,
// an installed-app picker, and the intercepting/stop state, all from the store.
//
// Standalone (like HTTP Toolkit's Frida interceptor): one click runs the full
// Connect flow itself (adb → device → root → CA → proxy) and then the Frida
// steps. The card is only disabled when the *host* can't run Frida at all (no
// frida package or no bundled frida-server binary); the rooted-device
// requirement is enforced by the flow and reported live in the checklist.
export default function FridaCard() {
  const frida = useStore((s) => s.frida);
  const fridaSteps = useStore((s) => s.fridaSteps);
  const fridaStatus = useStore((s) => s.fridaStatus);
  const fridaBusy = useStore((s) => s.fridaBusy);
  const startFrida = useStore((s) => s.startFrida);

  // Only the host capability blocks the card (no frida pkg / no bundled binary).
  // Device connection + root are handled by the flow itself and reported live,
  // so the card is a one-click standalone entry — no "connect first" required.
  const blocked = !frida.available
    ? frida.reason || "Frida is unavailable on this host."
    : null;

  const onStart = () => {
    if (fridaBusy) return;
    startFrida();
    sendAction({ action: "frida_start" });
  };

  // Intercepting → compact active card with a Stop button.
  if (frida.targetApp) {
    return (
      <div className="relative flex w-[380px] flex-col overflow-hidden rounded-2xl border border-violet-300 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700">
            Intercepting ●
          </span>
        </div>
        <h3 className="mt-3 text-xl font-semibold text-slate-800">Android app via Frida</h3>
        <dl className="mt-4 space-y-1.5 text-sm">
          <Row label="app" value={frida.targetApp} mono />
          <Row label="pid" value={frida.targetPid != null ? String(frida.targetPid) : "—"} mono />
          <Row label="frida" value={frida.fridaVersion ?? "—"} mono />
        </dl>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
          Certificate pinning and root detection are bypassed and the app's traffic is
          routed to the proxy — decrypted requests appear in the traffic list.
        </p>
        <div className="mt-5">
          <button
            onClick={() => sendAction({ action: "frida_stop" })}
            className="rounded border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-paper-100"
          >
            Stop interception
          </button>
        </div>
      </div>
    );
  }

  // Server running, choosing an app.
  if (frida.serverRunning) {
    return (
      <div className="flex w-[380px] flex-col overflow-hidden rounded-2xl border border-violet-300 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700">
            frida-server ●
          </span>
        </div>
        <h3 className="mt-3 text-xl font-semibold text-slate-800">Pick an app to intercept</h3>
        <AppPicker />
        {fridaStatus && !fridaStatus.ok && (
          <div className="mt-3 text-sm text-amber-700" title={fridaStatus.message}>
            {fridaStatus.message}
          </div>
        )}
      </div>
    );
  }

  // Entry card (idle / starting).
  return (
    <button
      onClick={blocked ? undefined : onStart}
      disabled={!!blocked || fridaBusy}
      className={`group relative flex h-[280px] w-[380px] flex-col overflow-hidden rounded-2xl border p-6 text-left shadow-sm transition ${
        blocked
          ? "cursor-default border-paper-200 bg-paper-50"
          : "border-paper-200 bg-white hover:border-violet-300 hover:shadow-md"
      }`}
    >
      <h3 className="text-2xl font-semibold leading-tight text-slate-800">
        Android app<br />via Frida
      </h3>
      <p className="mt-3 max-w-[18rem] text-[15px] leading-relaxed text-slate-600">
        Intercept a single app even when it pins certificates — connects the device,
        then frida-server injects SSL-unpinning + root-detection-bypass hooks and routes
        its traffic to the proxy.
      </p>

      {blocked ? (
        <p className="mt-auto rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800">
          {blocked}
        </p>
      ) : (
        <p className="mt-auto text-[13px] text-slate-500">
          One click — connects &amp; roots the device, then injects · frida {frida.fridaVersion ?? ""}
        </p>
      )}

      {/* live checklist + status while connecting and starting frida-server */}
      {(fridaBusy || Object.keys(fridaSteps).length > 0) && !blocked && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {FRIDA_STEPS.map((s) => {
              const st = fridaSteps[s.key];
              const running =
                fridaBusy && !st && FRIDA_STEPS.find((x) => !(x.key in fridaSteps))?.key === s.key;
              const state = st ? (st.ok ? "ok" : "error") : running ? "running" : "idle";
              return <StepChip key={s.key} label={s.label} state={state} title={st?.message} />;
            })}
          </div>
          {fridaStatus && (
            <div
              className={`mt-2 text-[13px] ${fridaStatus.ok ? "text-slate-500" : "text-amber-700"}`}
              title={fridaStatus.message}
            >
              {fridaStatus.message}
            </div>
          )}
        </>
      )}

      <FridaRobot className="pointer-events-none absolute -bottom-4 right-3 h-32 w-32 text-violet-100 transition group-hover:text-violet-200" />
    </button>
  );
}

function AppPicker() {
  const apps = useStore((s) => s.fridaApps);
  const fridaBusy = useStore((s) => s.fridaBusy);
  const beginFridaInject = useStore((s) => s.beginFridaInject);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? apps.filter((a) => a.toLowerCase().includes(q)) : apps;
    return list.slice(0, 200);
  }, [apps, query]);

  const choose = (pkg: string) => {
    if (fridaBusy) return;
    beginFridaInject();
    sendAction({ action: "frida_intercept", package: pkg });
  };

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${apps.length} apps…`}
          className="w-full rounded border border-paper-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-300"
        />
        <button
          onClick={() => sendAction({ action: "frida_list_apps" })}
          title="Refresh app list"
          className="shrink-0 rounded border border-paper-200 px-2 py-1.5 text-xs text-slate-600 hover:bg-paper-100"
        >
          ↻
        </button>
      </div>
      <ul className="mt-2 max-h-56 overflow-auto rounded border border-paper-200 divide-y divide-paper-100">
        {filtered.length === 0 && (
          <li className="px-3 py-2 text-sm text-slate-400">No matching apps.</li>
        )}
        {filtered.map((pkg) => (
          <li key={pkg}>
            <button
              onClick={() => choose(pkg)}
              disabled={fridaBusy}
              className="block w-full truncate px-3 py-1.5 text-left font-mono text-[13px] text-slate-700 hover:bg-violet-50 disabled:opacity-50"
            >
              {pkg}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd className={`min-w-0 break-all text-slate-700 ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

type ChipState = "idle" | "running" | "ok" | "error";

function StepChip({ label, state, title }: { label: string; state: ChipState; title?: string }) {
  const icon = state === "ok" ? "✓" : state === "error" ? "✗" : state === "running" ? "◴" : "○";
  const cls = {
    idle: "border-paper-200 text-slate-400",
    running: "border-violet-400 text-violet-500 animate-pulse",
    ok: "border-emerald-300 text-emerald-600",
    error: "border-red-300 text-red-600",
  }[state];
  return (
    <span title={title} className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${cls}`}>
      <span>{icon}</span>
      {label}
    </span>
  );
}

// A faint "spy/inspect" mascot to distinguish the Frida card from the ADB one.
function FridaRobot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="30" opacity="0.25" />
      <circle cx="32" cy="26" r="12" />
      <circle cx="28" cy="24" r="3" fill="#fff" />
      <circle cx="36" cy="24" r="3" fill="#fff" />
      <rect x="20" y="40" width="24" height="14" rx="6" />
    </svg>
  );
}
