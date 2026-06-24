import {
  ArrowDownToLine,
  FolderOpen,
  Globe,
  Pause,
  Play,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Smartphone,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  filtersActive,
  matchedScope,
  SCOPE_LABELS,
  selectVisibleFlows,
  useStore,
} from "../store";
import type { FilterScope } from "../store";
import { sendAction } from "../ws";
import { categoryColor, methodColor, sourceFromUA, statusColor } from "../util";
import type { Source } from "../util";

// Short labels for the little "where it matched" badge shown on a row when the
// hit was in a hidden field (headers / body) rather than the visible URL.
const MATCH_BADGE: Record<FilterScope, string> = {
  url: "",
  headers: "header",
  reqBody: "req body",
  respBody: "resp body",
};

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const STATUS_CLASSES: { key: string; label: string }[] = [
  { key: "2", label: "2xx" },
  { key: "3", label: "3xx" },
  { key: "4", label: "4xx" },
  { key: "5", label: "5xx" },
];

const ROW_H = 33;
const OVERSCAN = 8;

export default function FlowList() {
  const flows = useStore((s) => s.flows);
  const order = useStore((s) => s.order);
  const filters = useStore((s) => s.filters);
  const selectedId = useStore((s) => s.selectedId);
  const autoscroll = useStore((s) => s.autoscroll);
  const setAutoscroll = useStore((s) => s.setAutoscroll);
  const select = useStore((s) => s.select);
  const setInterceptId = useStore((s) => s.setInterceptId);

  // recompute visible list (depends on flows/order/filters via the subs above)
  const visible = selectVisibleFlows({ flows, order, filters } as never);
  const search = filters.text.trim().toLowerCase();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    setViewport(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Auto-scroll to newest when enabled.
  useEffect(() => {
    if (autoscroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible.length, autoscroll]);

  const total = visible.length * ROW_H;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);
  const slice = visible.slice(start, end);

  return (
    <div className="flex h-full min-w-0 flex-col bg-white">
      {/* column header */}
      <div className="flex items-center gap-3 border-b border-paper-200 bg-paper-50 pl-4 pr-3 py-2 text-[13px] font-medium text-slate-500">
        <span className="w-20">Method</span>
        <span className="w-16">Status</span>
        <span className="w-14 text-center">Source</span>
        <span className="w-56 truncate">Host</span>
        <span className="flex-1 truncate">Path and query</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          // Stick-to-bottom: keep following new flows only while the user is at
          // the bottom. The moment they scroll up to read an earlier request we
          // stop yanking them down, and resume once they scroll back to the end.
          const el = e.currentTarget;
          setScrollTop(el.scrollTop);
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H;
          if (atBottom !== autoscroll) setAutoscroll(atBottom);
        }}
        className="relative flex-1 overflow-auto"
      >
        <div style={{ height: total }}>
          <div style={{ transform: `translateY(${start * ROW_H}px)` }}>
            {slice.map((f) => {
              const paused = f.phase === "paused";
              const selected = f.id === selectedId;
              const aborted = !!f.error && !f.host;
              // Show a hint when the search matched a field that isn't on screen
              // (a header or body) so the user understands why the row is here.
              const loc = search ? matchedScope(f, search, filters.scopes) : null;
              const badge = loc && loc !== "url" ? MATCH_BADGE[loc] : "";

              if (aborted) {
                return (
                  <div
                    key={f.id}
                    style={{ height: ROW_H }}
                    className="flex items-center justify-center border-b border-paper-100 bg-paper-50 text-[13px] italic text-slate-400"
                  >
                    {f.error || "Aborted connection to unknown domain"}
                  </div>
                );
              }

              return (
                <div
                  key={f.id}
                  onClick={() => (paused ? setInterceptId(f.id) : select(f.id))}
                  style={{ height: ROW_H, borderLeft: `4px solid ${categoryColor(f.host)}` }}
                  className={`flex cursor-pointer items-center gap-3 border-b border-paper-100 pl-3 pr-3 font-mono text-[14px] ${
                    selected
                      ? "bg-blue-50"
                      : paused
                      ? "bg-amber-50 hover:bg-amber-100"
                      : "hover:bg-paper-50"
                  }`}
                >
                  <span className={`flex w-20 items-center font-semibold ${methodColor(f.method)}`}>
                    {paused && <span className="mr-1" title="paused">⏸</span>}
                    {f.replay && <span className="mr-1 text-cyan-600" title="resent">⟳</span>}
                    {f.reqMocked && <span className="mr-1 text-purple-600" title="request body mocked">✎</span>}
                    <span className="truncate">{f.method}</span>
                  </span>
                  <span
                    className={`w-16 font-semibold ${
                      f.dropped || f.error ? "text-red-600" : statusColor(f.status)
                    }`}
                    title={f.error}
                  >
                    {f.dropped ? "drop" : f.error && f.status == null ? "err" : f.status ?? "···"}
                    {f.mocked && <span className="ml-1 text-purple-600" title="mocked">◆</span>}
                  </span>
                  <span className="flex w-14 items-center justify-center">
                    <SourceIcon source={sourceFromUA(f.reqHeaders)} />
                  </span>
                  <span className="w-56 truncate text-slate-700">{f.host}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-slate-500">{f.path}</span>
                    {badge && (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1.5 py-[1px] text-[11px] font-medium text-amber-700"
                        title={`matches your search in the ${badge}`}
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {visible.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            No flows yet — point Nox's proxy at the host and browse.
          </div>
        )}
      </div>

      <FilterBar shown={visible.length} total={order.length} />
    </div>
  );
}

function SourceIcon({ source }: { source: Source }) {
  switch (source) {
    case "android":
      return <Smartphone size={17} className="text-emerald-600" />;
    case "node":
      return <Terminal size={17} className="text-slate-500" />;
    case "chrome":
      return <Globe size={17} className="text-sky-600" />;
    default:
      return <Globe size={17} className="text-slate-400" />;
  }
}

function FilterBar({ shown, total }: { shown: number; total: number }) {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const autoscroll = useStore((s) => s.autoscroll);
  const setAutoscroll = useStore((s) => s.setAutoscroll);
  const capturePaused = useStore((s) => s.capturePaused);
  const setCapturePaused = useStore((s) => s.setCapturePaused);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const active = filtersActive(filters);
  const scopeCount = SCOPE_LABELS.filter((s) => filters.scopes[s.key]).length;
  // Reflect the active scopes in the placeholder so the box never lies about
  // what it searches.
  const scopeText =
    scopeCount === SCOPE_LABELS.length
      ? "URL, headers & bodies"
      : SCOPE_LABELS.filter((s) => filters.scopes[s.key]).map((s) => s.label).join(", ");

  return (
    <div className="flex items-center gap-2 border-t border-paper-200 bg-paper-50 px-3 py-1.5">
      <div className="relative flex-1">
        <Search
          size={15}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          value={filters.text}
          onChange={(e) => setFilters({ text: e.target.value })}
          placeholder={`Search ${scopeText}…`}
          className="w-full rounded border border-paper-200 bg-white pl-8 pr-8 py-1.5 text-[13px] text-slate-ink outline-none placeholder:text-slate-400 focus:border-accent focus:ring-1 focus:ring-accent"
        />
        {filters.text && (
          <button
            title="Clear search"
            onClick={() => setFilters({ text: "" })}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-paper-200 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="relative">
        <button
          title="Advanced filters"
          onClick={() => setFiltersOpen((o) => !o)}
          className={`flex h-8 items-center gap-1.5 rounded border px-2.5 text-[13px] font-medium transition-colors ${
            active || filtersOpen
              ? "border-accent bg-accent/10 text-accent"
              : "border-paper-200 text-slate-500 hover:bg-paper-200 hover:text-slate-700"
          }`}
        >
          <SlidersHorizontal size={15} />
          Filters
          {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
        {filtersOpen && <FiltersPopover onClose={() => setFiltersOpen(false)} />}
      </div>

      <span className="whitespace-nowrap px-1 text-center text-[13px] leading-tight text-slate-500">
        {active && shown !== total ? (
          <>
            <span className="font-semibold text-slate-600">{shown}</span>
            <span className="text-slate-400"> / {total}</span>
          </>
        ) : (
          <span className="font-semibold text-slate-600">{shown}</span>
        )}{" "}
        <span className="text-slate-400">requests</span>
      </span>

      <ToolButton
        title={capturePaused ? "Resume capturing" : "Pause capturing"}
        onClick={() => setCapturePaused(!capturePaused)}
        active={capturePaused}
      >
        {capturePaused ? <Play size={17} /> : <Pause size={17} />}
      </ToolButton>
      <ToolButton
        title={autoscroll ? "Auto-scroll on" : "Scroll to bottom"}
        onClick={() => setAutoscroll(!autoscroll)}
        active={autoscroll}
      >
        <ArrowDownToLine size={17} />
      </ToolButton>
      <ToolButton title="Save (coming soon)" disabled>
        <Save size={17} />
      </ToolButton>
      <ToolButton title="Open (coming soon)" disabled>
        <FolderOpen size={17} />
      </ToolButton>
      <ToolButton title="Clear all" onClick={() => sendAction({ action: "clear" })}>
        <Trash2 size={17} />
      </ToolButton>
    </div>
  );
}

// Anchored panel that opens upward from the "Filters" button: pick which fields
// the search scans, plus method / status-class narrowing. Closes on outside
// click or Escape.
function FiltersPopover({ onClose }: { onClose: () => void }) {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const toggleScope = useStore((s) => s.toggleScope);
  const resetFilters = useStore((s) => s.resetFilters);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const dirty = filtersActive(filters);

  return (
    <div
      ref={ref}
      className="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-lg border border-paper-200 bg-white p-3 shadow-xl"
    >
      <div className="mb-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Search in
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SCOPE_LABELS.map((s) => (
            <Chip
              key={s.key}
              active={filters.scopes[s.key]}
              onClick={() => toggleScope(s.key)}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Method
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip active={filters.method === ""} onClick={() => setFilters({ method: "" })}>
            Any
          </Chip>
          {METHODS.map((m) => (
            <Chip
              key={m}
              active={filters.method === m}
              onClick={() => setFilters({ method: filters.method === m ? "" : m })}
            >
              {m}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Status
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            active={filters.statusClass === ""}
            onClick={() => setFilters({ statusClass: "" })}
          >
            Any
          </Chip>
          {STATUS_CLASSES.map((s) => (
            <Chip
              key={s.key}
              active={filters.statusClass === s.key}
              onClick={() =>
                setFilters({ statusClass: filters.statusClass === s.key ? "" : s.key })
              }
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </div>

      <button
        onClick={resetFilters}
        disabled={!dirty}
        className={`flex w-full items-center justify-center gap-1.5 rounded border border-paper-200 py-1.5 text-[13px] font-medium ${
          !dirty
            ? "cursor-not-allowed text-slate-300"
            : "text-slate-600 hover:bg-paper-100 hover:text-slate-800"
        }`}
      >
        <RotateCcw size={14} /> Reset filters
      </button>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active
          ? "bg-accent text-white"
          : "bg-paper-100 text-slate-500 hover:bg-paper-200 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

function ToolButton({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
        disabled
          ? "cursor-not-allowed text-slate-300"
          : active
          ? "bg-accent/15 text-accent"
          : "text-slate-500 hover:bg-paper-200 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
