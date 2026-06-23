import { Activity, Pencil, Search, Send, Unplug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStore } from "../store";

// HTTP Toolkit-style left icon rail. Each item is an icon stacked over a small
// label; the "View" (traffic list) item is the default/active surface, and the
// others open their respective overlays.
export default function Sidebar() {
  const mainView = useStore((s) => s.mainView);
  const setMainView = useStore((s) => s.setMainView);
  const rulesOpen = useStore((s) => s.rulesOpen);
  const diagOpen = useStore((s) => s.diagOpen);
  const resendOpen = useStore((s) => s.resendOpen);
  const setRulesOpen = useStore((s) => s.setRulesOpen);
  const setDiagOpen = useStore((s) => s.setDiagOpen);
  const openResend = useStore((s) => s.openResend);
  const closeResend = useStore((s) => s.closeResend);
  const prereqs = useStore((s) => s.prereqs);
  const prereqWarn = !!prereqs && (!prereqs.adb.ok || !prereqs.mitmCA.ok);

  // The base screen items (Intercept / View) are active only when no overlay is open.
  const noOverlay = !rulesOpen && !diagOpen && !resendOpen;
  const interceptActive = mainView === "intercept" && noOverlay;
  const viewActive = mainView === "view" && noOverlay;

  const closeAll = () => {
    setRulesOpen(false);
    setDiagOpen(false);
    closeResend();
  };

  return (
    <nav className="flex w-[68px] shrink-0 flex-col items-stretch bg-rail py-2 text-slate-300">
      {/* logo */}
      <div className="mb-2 flex items-center justify-center py-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand font-mono text-lg font-bold italic text-white">
          {"//"}
        </div>
      </div>

      <RailItem icon={Unplug} label="Intercept" active={interceptActive} onClick={() => { closeAll(); setMainView("intercept"); }} dot={prereqWarn} />
      <RailItem icon={Search} label="View" active={viewActive} onClick={() => { closeAll(); setMainView("view"); }} />
      <RailItem icon={Pencil} label="Modify" active={rulesOpen} onClick={() => { closeAll(); setRulesOpen(true); }} />
      <RailItem icon={Send} label="Send" active={resendOpen} onClick={() => { closeAll(); openResend(); }} />

      <div className="mt-auto">
        <RailItem icon={Activity} label="Status" active={diagOpen} onClick={() => { closeAll(); setDiagOpen(true); }} />
      </div>
    </nav>
  );
}

function RailItem({
  icon: Icon,
  label,
  active,
  onClick,
  dot,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  dot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-1 py-2.5 text-[10px] transition-colors ${
        active ? "bg-rail-active text-white" : "text-slate-400 hover:bg-rail-hover hover:text-slate-200"
      }`}
    >
      {active && <span className="absolute left-0 top-0 h-full w-[3px] bg-brand" />}
      <Icon size={20} strokeWidth={1.75} />
      <span className="tracking-wide">{label}</span>
      {dot && <span className="absolute right-3 top-2 h-2 w-2 rounded-full bg-amber-400" />}
    </button>
  );
}
