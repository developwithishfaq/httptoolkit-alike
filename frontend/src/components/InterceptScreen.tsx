import { CONNECT_STEPS, INTERCEPT_STEPS, useStore } from "../store";
import { sendAction } from "../ws";
import FridaCard from "./FridaCard";

// Intercept screen — three distinct features as cards. The ADB device *link*
// (feature 1) is the prerequisite: until it's connected, "Intercept traffic"
// (feature 2) and "Frida" (feature 3) are disabled.
//
//   1. Connect device (ADB)        — adb → device online → root detection
//   2. Intercept traffic           — install CA + point device proxy at mitmproxy
//   3. Bypass SSL pinning & root   — per-app Frida interception (FridaCard)
export default function InterceptScreen() {
  const prereqs = useStore((s) => s.prereqs);
  const adbMissing = !!prereqs && !prereqs.adb.ok;

  return (
    <div className="h-full w-full overflow-auto bg-paper-50">
      <div className="mx-auto max-w-6xl px-8 py-10">
        <h1 className="text-2xl font-semibold text-slate-800">Intercept</h1>
        <p className="mt-1 text-[15px] text-slate-500">
          Connect a device, then capture its traffic device-wide or intercept a single app with Frida.
        </p>

        {adbMissing && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            adb not found — add Android platform-tools (<code className="font-mono">adb</code>) to PATH, or install Nox.
            Open <span className="font-medium">Status</span> for details.
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-6">
          <ConnectCard />
          <InterceptTrafficCard />
          <FridaCard />
        </div>
      </div>
    </div>
  );
}

// --- Feature 1: device link -------------------------------------------------

function ConnectCard() {
  const conn = useStore((s) => s.conn);
  const steps = useStore((s) => s.steps);
  const connecting = useStore((s) => s.connecting);
  const lastStatus = useStore((s) => s.lastStatus);
  const startConnect = useStore((s) => s.startConnect);

  const onConnect = () => {
    if (connecting) return;
    startConnect();
    sendAction({ action: "connect" });
  };

  if (conn.connected) {
    return (
      <div className="relative flex w-[360px] flex-col overflow-hidden rounded-2xl border border-emerald-300 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
            Linked ●
          </span>
        </div>
        <h3 className="mt-3 text-xl font-semibold text-slate-800">Device connected (ADB)</h3>
        <dl className="mt-4 space-y-1.5 text-sm">
          <Row label="device" value={conn.deviceSerial ?? "—"} mono />
          <Row
            label="android"
            value={
              conn.androidSdk != null
                ? `API ${conn.androidSdk}${conn.rooted ? " · rooted" : conn.rooted === false ? " · not rooted" : ""}`
                : "—"
            }
          />
        </dl>
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => sendAction({ action: "disconnect" })}
            className="rounded border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-paper-100"
          >
            Disconnect
          </button>
          <button
            onClick={() => sendAction({ action: "reboot_device" })}
            className="rounded border border-paper-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-paper-100"
            title="Reboot the connected device/emulator"
          >
            Reboot device
          </button>
        </div>
        <AndroidRobot className="pointer-events-none absolute -bottom-5 right-3 h-28 w-28 text-emerald-100" />
      </div>
    );
  }

  return (
    <button
      onClick={onConnect}
      disabled={connecting}
      className="group relative flex h-[280px] w-[360px] flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white p-6 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md disabled:cursor-default"
    >
      <h3 className="text-2xl font-semibold leading-tight text-slate-800">
        Connect device<br />via ADB
      </h3>
      <p className="mt-3 max-w-[18rem] text-[15px] leading-relaxed text-slate-600">
        Link any Android device or emulator over ADB (USB or network) and detect root —
        the first step that unlocks capture and Frida.
      </p>

      {(connecting || Object.keys(steps).length > 0) && (
        <Checklist steps={CONNECT_STEPS} results={steps} running={connecting} lastStatus={lastStatus} accent="emerald" />
      )}

      <AndroidRobot className="pointer-events-none absolute -bottom-5 right-3 h-36 w-36 text-emerald-200 transition group-hover:text-emerald-300" />

      {connecting && (
        <div className="absolute inset-0 grid place-items-center bg-white/75">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <Spinner /> Connecting…
          </div>
        </div>
      )}
    </button>
  );
}

// --- Feature 2: device-wide capture ----------------------------------------

function InterceptTrafficCard() {
  const conn = useStore((s) => s.conn);
  const interceptSteps = useStore((s) => s.interceptSteps);
  const intercepting = useStore((s) => s.intercepting);
  const lastStatus = useStore((s) => s.lastStatus);
  const startIntercept = useStore((s) => s.startIntercept);

  const blocked = !conn.connected ? "Connect a device first to capture its traffic." : null;

  const onIntercept = () => {
    if (intercepting || blocked) return;
    startIntercept();
    sendAction({ action: "intercept_traffic" });
  };

  if (conn.capturing) {
    return (
      <div className="relative flex w-[360px] flex-col overflow-hidden rounded-2xl border border-accent/40 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-accent">
            Capturing ●
          </span>
        </div>
        <h3 className="mt-3 text-xl font-semibold text-slate-800">Intercept traffic</h3>
        <dl className="mt-4 space-y-1.5 text-sm">
          <Row label="proxy" value={conn.hostProxy ?? "—"} mono valueClass="text-accent" />
          <Row
            label="cert"
            value={conn.certMode === "system" ? "system store" : conn.certMode === "user" ? "user cert — action needed" : "—"}
            valueClass={conn.certMode === "system" ? "text-emerald-600" : conn.certMode === "user" ? "text-amber-600" : "text-slate-400"}
          />
        </dl>

        {conn.certMode === "user" && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800">
            <div className="font-semibold">HTTPS needs one manual step</div>
            HTTP is captured now. To decrypt HTTPS, install the CA copied to the device:{" "}
            <span className="font-medium">Settings → Security → Install a certificate → CA certificate</span>,
            then pick <code className="font-mono">nox-mitmproxy-ca.crt</code> from Downloads.
          </div>
        )}

        <div className="mt-5">
          <button
            onClick={() => sendAction({ action: "stop_intercept" })}
            className="rounded border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-paper-100"
          >
            Stop capture
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onIntercept}
      disabled={!!blocked || intercepting}
      className={`group relative flex h-[280px] w-[360px] flex-col overflow-hidden rounded-2xl border p-6 text-left shadow-sm transition ${
        blocked ? "cursor-default border-paper-200 bg-paper-50 opacity-80" : "border-paper-200 bg-white hover:border-accent/50 hover:shadow-md"
      }`}
    >
      <h3 className="text-2xl font-semibold leading-tight text-slate-800">
        Intercept<br />traffic
      </h3>
      <p className="mt-3 max-w-[18rem] text-[15px] leading-relaxed text-slate-600">
        Capture the whole device: install the HTTPS CA (system store on rooted devices, else a
        user cert) and point the device proxy at mitmproxy.
      </p>

      {blocked ? (
        <p className="mt-auto rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800">
          {blocked}
        </p>
      ) : (
        <p className="mt-auto text-[13px] text-slate-500">Device-wide · all apps that honor the proxy</p>
      )}

      {!blocked && (intercepting || Object.keys(interceptSteps).length > 0) && (
        <Checklist steps={INTERCEPT_STEPS} results={interceptSteps} running={intercepting} lastStatus={lastStatus} accent="sky" />
      )}

      {intercepting && (
        <div className="absolute inset-0 grid place-items-center bg-white/75">
          <div className="flex items-center gap-2 text-sm font-medium text-accent">
            <Spinner /> Setting up…
          </div>
        </div>
      )}
    </button>
  );
}

// --- shared bits ------------------------------------------------------------

function Checklist({
  steps,
  results,
  running,
  lastStatus,
  accent,
}: {
  steps: { key: string; label: string }[];
  results: Record<string, { ok: boolean; message: string }>;
  running: boolean;
  lastStatus: { step: string; ok: boolean; message: string } | null;
  accent: "emerald" | "sky";
}) {
  const runningKey = running ? steps.find((s) => !(s.key in results))?.key : undefined;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((s) => {
          const st = results[s.key];
          const state = st ? (st.ok ? "ok" : "error") : s.key === runningKey ? "running" : "idle";
          return <StepChip key={s.key} label={s.label} state={state} title={st?.message} accent={accent} />;
        })}
      </div>
      {lastStatus && (
        <div className={`mt-2 text-[13px] ${lastStatus.ok ? "text-slate-500" : "text-amber-700"}`} title={lastStatus.message}>
          {lastStatus.message}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  valueClass,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`min-w-0 break-all ${mono ? "font-mono" : ""} ${valueClass ?? "text-slate-700"}`}>{value}</dd>
    </div>
  );
}

type ChipState = "idle" | "running" | "ok" | "error";

function StepChip({
  label,
  state,
  title,
  accent,
}: {
  label: string;
  state: ChipState;
  title?: string;
  accent: "emerald" | "sky";
}) {
  const icon = state === "ok" ? "✓" : state === "error" ? "✗" : state === "running" ? "◴" : "○";
  const runningCls = accent === "emerald" ? "border-emerald-400 text-emerald-600" : "border-accent text-accent";
  const cls = {
    idle: "border-paper-200 text-slate-400",
    running: `${runningCls} animate-pulse`,
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

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-current" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4Z" />
    </svg>
  );
}

// The Android "bugdroid" mascot, used as a faint decorative watermark.
function AndroidRobot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 70" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20 14 16 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M44 14 48 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M16 26a16 16 0 0 1 32 0Z" />
      <circle cx="26" cy="18" r="2" fill="#fff" />
      <circle cx="38" cy="18" r="2" fill="#fff" />
      <rect x="16" y="28" width="32" height="28" rx="5" />
      <rect x="7" y="30" width="6" height="22" rx="3" />
      <rect x="51" y="30" width="6" height="22" rx="3" />
      <rect x="22" y="54" width="6" height="14" rx="3" />
      <rect x="36" y="54" width="6" height="14" rx="3" />
    </svg>
  );
}
