import {
  ArrowDownToLine,
  FolderOpen,
  Globe,
  HelpCircle,
  Pause,
  Play,
  Save,
  Smartphone,
  Terminal,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { selectVisibleFlows, useStore } from "../store";
import { sendAction } from "../ws";
import { categoryColor, methodColor, sourceFromUA, statusColor } from "../util";
import type { Source } from "../util";

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
                  <span className="flex-1 truncate text-slate-500">{f.path}</span>
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

      <BottomBar count={visible.length} />
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

function BottomBar({ count }: { count: number }) {
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const autoscroll = useStore((s) => s.autoscroll);
  const setAutoscroll = useStore((s) => s.setAutoscroll);
  const capturePaused = useStore((s) => s.capturePaused);
  const setCapturePaused = useStore((s) => s.setCapturePaused);

  return (
    <div className="flex items-center gap-2 border-t border-paper-200 bg-paper-50 px-3 py-1.5">
      <div className="relative flex-1">
        <input
          value={filters.text}
          onChange={(e) => setFilters({ text: e.target.value })}
          placeholder="Filter by method, host, headers, status…"
          className="w-full rounded border border-paper-200 bg-white px-3 py-1.5 pr-8 text-[13px] text-slate-ink outline-none placeholder:text-slate-400 focus:border-accent focus:ring-1 focus:ring-accent"
        />
        <HelpCircle
          size={16}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
          aria-label="Filter help"
        />
      </div>

      <span className="whitespace-nowrap px-1 text-center text-[13px] leading-tight text-slate-500">
        {count} <span className="text-slate-400">requests</span>
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
