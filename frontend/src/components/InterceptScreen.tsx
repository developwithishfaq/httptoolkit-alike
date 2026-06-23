import { CONNECT_STEPS, useStore } from "../store";
import { sendAction } from "../ws";

// Dedicated Intercept screen (HTTP Toolkit's interception page). One option for
// now — "Android Device via ADB" — presented as a clickable card. Clicking runs
// the full Connect orchestration against any online ADB device (a USB phone with
// developer-mode USB debugging, or an emulator). It shows a live checklist while
// connecting and a connected/device summary once a device is captured.
export default function InterceptScreen() {
  const conn = useStore((s) => s.conn);
  const steps = useStore((s) => s.steps);
  const connecting = useStore((s) => s.connecting);
  const lastStatus = useStore((s) => s.lastStatus);
  const startConnect = useStore((s) => s.startConnect);
  const prereqs = useStore((s) => s.prereqs);

  const adbMissing = !!prereqs && !prereqs.adb.ok;

  const onConnect = () => {
    if (connecting) return;
    startConnect();
    sendAction({ action: "connect" });
  };

  // The first step without a result is the one currently running.
  const runningKey = connecting
    ? CONNECT_STEPS.find((s) => !(s.key in steps))?.key
    : undefined;

  return (
    <div className="h-full w-full overflow-auto bg-paper-50">
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="text-2xl font-semibold text-slate-800">Intercept</h1>
        <p className="mt-1 text-[15px] text-slate-500">
          Pick a source to start capturing traffic.
        </p>

        {adbMissing && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            adb not found — install Nox (nox_adb.exe) or add <code className="font-mono">adb</code> to PATH.
            Open <span className="font-medium">Status</span> for details.
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-6">
          {conn.connected ? (
            <ConnectedCard />
          ) : (
            <AndroidCard onConnect={onConnect} connecting={connecting} />
          )}
        </div>

        {/* live checklist — visible while connecting or after an attempt */}
        {(connecting || Object.keys(steps).length > 0) && !conn.connected && (
          <div className="mt-8 max-w-2xl">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Connection progress
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {CONNECT_STEPS.map((s) => {
                const st = steps[s.key];
                const running = s.key === runningKey;
                const state = st ? (st.ok ? "ok" : "error") : running ? "running" : "idle";
                return <StepChip key={s.key} label={s.label} state={state} title={st?.message} />;
              })}
            </div>
            {lastStatus && (
              <div
                className={`mt-3 text-sm ${lastStatus.ok ? "text-emerald-600" : "text-amber-700"}`}
                title={lastStatus.message}
              >
                {lastStatus.message}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AndroidCard({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
  return (
    <button
      onClick={onConnect}
      disabled={connecting}
      className="group relative flex h-[280px] w-[380px] flex-col overflow-hidden rounded-2xl border border-paper-200 bg-white p-6 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md disabled:cursor-default"
    >
      <h3 className="text-2xl font-semibold leading-tight text-slate-800">
        Android Device<br />via ADB
      </h3>
      <p className="mt-3 max-w-[18rem] text-[15px] leading-relaxed text-slate-600">
        Intercept an Android device or emulator connected to ADB
      </p>
      <p className="mt-3 max-w-[18rem] text-[15px] leading-relaxed text-slate-600">
        Automatically injects system HTTPS certificates into rooted devices &amp; most emulators
      </p>

      <AndroidRobot className="pointer-events-none absolute -bottom-5 right-3 h-40 w-40 text-emerald-200 transition group-hover:text-emerald-300" />

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

function ConnectedCard() {
  const conn = useStore((s) => s.conn);
  return (
    <div className="relative flex w-[380px] flex-col overflow-hidden rounded-2xl border border-emerald-300 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
          Connected ●
        </span>
      </div>
      <h3 className="mt-3 text-xl font-semibold text-slate-800">Android Device via ADB</h3>

      <dl className="mt-4 space-y-1.5 text-sm">
        <Row label="device" value={conn.deviceSerial ?? "—"} mono />
        <Row label="android" value={conn.androidSdk != null ? `API ${conn.androidSdk}` : "—"} />
        <Row label="cert" value={conn.certInstalled ? "installed" : "—"} valueClass={conn.certInstalled ? "text-emerald-600" : "text-slate-400"} />
        <Row label="proxy" value={conn.hostProxy ?? "—"} mono valueClass="text-accent" />
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

      <AndroidRobot className="pointer-events-none absolute -bottom-5 right-3 h-32 w-32 text-emerald-100" />
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
      <dt className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </dt>
      <dd className={`min-w-0 break-all ${mono ? "font-mono" : ""} ${valueClass ?? "text-slate-700"}`}>
        {value}
      </dd>
    </div>
  );
}

type ChipState = "idle" | "running" | "ok" | "error";

function StepChip({ label, state, title }: { label: string; state: ChipState; title?: string }) {
  const icon =
    state === "ok" ? "✓" : state === "error" ? "✗" : state === "running" ? "◴" : "○";
  const cls = {
    idle: "border-paper-200 text-slate-400",
    running: "border-accent text-accent animate-pulse",
    ok: "border-emerald-300 text-emerald-600",
    error: "border-red-300 text-red-600",
  }[state];
  return (
    <span
      title={title}
      className={`flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${cls}`}
    >
      <span>{icon}</span>
      {label}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-emerald-600" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4Z" />
    </svg>
  );
}

// The Android "bugdroid" mascot, used as a faint decorative watermark.
function AndroidRobot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 70" fill="currentColor" aria-hidden="true" className={className}>
      {/* antennae */}
      <path d="M20 14 16 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M44 14 48 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* head dome */}
      <path d="M16 26a16 16 0 0 1 32 0Z" />
      {/* eyes */}
      <circle cx="26" cy="18" r="2" fill="#fff" />
      <circle cx="38" cy="18" r="2" fill="#fff" />
      {/* body */}
      <rect x="16" y="28" width="32" height="28" rx="5" />
      {/* arms */}
      <rect x="7" y="30" width="6" height="22" rx="3" />
      <rect x="51" y="30" width="6" height="22" rx="3" />
      {/* legs */}
      <rect x="22" y="54" width="6" height="14" rx="3" />
      <rect x="36" y="54" width="6" height="14" rx="3" />
    </svg>
  );
}
