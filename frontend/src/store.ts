import { create } from "zustand";
import type { ConnState, Flow, Prereqs, Rule } from "./types";

// Prefill for the Resend screen. Headers are kept as ordered pairs so the
// editor can show/edit duplicates and preserve order.
export interface ResendSeed {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

const MAX_FLOWS = 5000;

// Ordered Connect steps for the checklist UI (SPEC §7.5).
export const CONNECT_STEPS: { key: string; label: string }[] = [
  { key: "adb_found", label: "adb" },
  { key: "proxy_running", label: "proxy" },
  { key: "device_connected", label: "device" },
  { key: "rooted", label: "root" },
  { key: "android_checked", label: "android" },
  { key: "cert_installed", label: "cert" },
  { key: "proxy_set", label: "set proxy" },
  { key: "connected", label: "connected" },
];
const STEP_KEYS = new Set(CONNECT_STEPS.map((s) => s.key));

export interface StepState {
  ok: boolean;
  message: string;
}

export interface Filters {
  text: string;
  method: string; // "" = any
  statusClass: string; // "", "2", "3", "4", "5"
}

interface AppStore {
  // connection / transport
  wsConnected: boolean;
  conn: ConnState;
  lastStatus: { step: string; ok: boolean; message: string } | null;
  steps: Record<string, StepState>;
  connecting: boolean;

  // flows
  flows: Map<string, Flow>;
  order: string[]; // insertion order of ids (oldest → newest)
  selectedId: string | null;

  // ui
  mainView: "intercept" | "view"; // which full screen occupies the main area
  autoscroll: boolean;
  capturePaused: boolean; // when true, incoming flows are ignored (toolbar pause)
  filters: Filters;
  rules: Rule[];
  rulesOpen: boolean;
  ruleSeed: Rule | null; // a pre-filled rule to drop into the Rules drawer as a draft
  interceptId: string | null; // paused flow currently open in the editor
  prereqs: Prereqs | null;
  diagOpen: boolean;
  resendOpen: boolean;
  resendSeed: ResendSeed | null;

  // actions
  setWsConnected: (v: boolean) => void;
  setConn: (c: ConnState) => void;
  setStatus: (s: { step: string; ok: boolean; message: string }) => void;
  setMainView: (v: "intercept" | "view") => void;
  startConnect: () => void;
  upsertFlow: (f: Flow) => void;
  clearFlows: () => void;
  select: (id: string | null) => void;
  setAutoscroll: (v: boolean) => void;
  setCapturePaused: (v: boolean) => void;
  setFilters: (f: Partial<Filters>) => void;
  setRules: (r: Rule[]) => void;
  setRulesOpen: (v: boolean) => void;
  openRulesWith: (seed: Rule) => void;
  clearRuleSeed: () => void;
  setInterceptId: (id: string | null) => void;
  setPrereqs: (p: Prereqs) => void;
  setDiagOpen: (v: boolean) => void;
  openResend: (seed?: ResendSeed) => void;
  closeResend: () => void;
}

export const useStore = create<AppStore>((set) => ({
  wsConnected: false,
  conn: {
    connected: false,
    proxyRunning: false,
    certInstalled: false,
    deviceSerial: null,
    androidSdk: null,
    hostProxy: null,
  },
  lastStatus: null,
  steps: {},
  connecting: false,

  flows: new Map(),
  order: [],
  selectedId: null,

  mainView: "intercept",
  autoscroll: true,
  capturePaused: false,
  filters: { text: "", method: "", statusClass: "" },
  rules: [],
  rulesOpen: false,
  ruleSeed: null,
  interceptId: null,
  prereqs: null,
  diagOpen: false,
  resendOpen: false,
  resendSeed: null,

  setWsConnected: (v) => set({ wsConnected: v }),
  setConn: (c) => set({ conn: c }),
  setStatus: (s) =>
    set((state) => {
      const next: Partial<AppStore> = { lastStatus: s };
      if (STEP_KEYS.has(s.step)) {
        next.steps = { ...state.steps, [s.step]: { ok: s.ok, message: s.message } };
        // Terminal: success on the final step, or any checklist-step failure.
        if (s.step === "connected" ? s.ok : !s.ok) next.connecting = false;
        // On a fully successful connect, jump straight to the traffic view.
        if (s.step === "connected" && s.ok) next.mainView = "view";
      }
      return next;
    }),
  setMainView: (v) => set({ mainView: v }),
  startConnect: () => set({ connecting: true, steps: {}, lastStatus: null }),

  upsertFlow: (f) =>
    set((state) => {
      // When capture is paused, ignore brand-new flows but still allow updates
      // to flows already in the list (e.g. a response arriving for a shown row).
      if (state.capturePaused && !state.flows.has(f.id)) return {};
      const flows = new Map(state.flows);
      const existed = flows.has(f.id);
      // Merge so a "response" message keeps any request-only fields if needed,
      // though the backend already sends the full flow each phase.
      flows.set(f.id, existed ? { ...flows.get(f.id)!, ...f } : f);

      let order = state.order;
      if (!existed) {
        order = [...state.order, f.id];
        if (order.length > MAX_FLOWS) {
          const drop = order.length - MAX_FLOWS;
          for (let i = 0; i < drop; i++) flows.delete(order[i]);
          order = order.slice(drop);
        }
      }
      return { flows, order };
    }),

  clearFlows: () => set({ flows: new Map(), order: [], selectedId: null }),
  select: (id) => set({ selectedId: id }),
  setAutoscroll: (v) => set({ autoscroll: v }),
  setCapturePaused: (v) => set({ capturePaused: v }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  setRules: (r) => set({ rules: r }),
  setRulesOpen: (v) => set(v ? { rulesOpen: true } : { rulesOpen: false, ruleSeed: null }),
  openRulesWith: (seed) => set({ rulesOpen: true, ruleSeed: seed }),
  clearRuleSeed: () => set({ ruleSeed: null }),
  setInterceptId: (id) => set({ interceptId: id }),
  setPrereqs: (p) => set({ prereqs: p }),
  setDiagOpen: (v) => set({ diagOpen: v }),
  openResend: (seed) => set({ resendOpen: true, resendSeed: seed ?? null }),
  closeResend: () => set({ resendOpen: false }),
}));

// Find the captured flow for a given replay token (the Resend screen's result).
export function selectByReplayToken(token: string | null) {
  return (state: AppStore): Flow | undefined => {
    if (!token) return undefined;
    for (const id of state.order) {
      const f = state.flows.get(id);
      if (f && f.replayToken === token) return f;
    }
    return undefined;
  };
}

// Paused flows awaiting forward/drop, oldest first (the intercept queue).
export function selectPending(state: AppStore): Flow[] {
  const out: Flow[] = [];
  for (const id of state.order) {
    const f = state.flows.get(id);
    if (f && f.phase === "paused") out.push(f);
  }
  return out;
}

// Derived helper: apply filters to the ordered flow list.
export function selectVisibleFlows(state: AppStore): Flow[] {
  const { flows, order, filters } = state;
  const text = filters.text.trim().toLowerCase();
  const out: Flow[] = [];
  for (const id of order) {
    const f = flows.get(id);
    if (!f) continue;
    if (filters.method && f.method.toUpperCase() !== filters.method) continue;
    if (filters.statusClass) {
      if (!f.status || String(f.status)[0] !== filters.statusClass) continue;
    }
    if (text) {
      // Single filter box matches across method, status, host and path so it
      // covers HTTP Toolkit's "filter by method, host, headers, status" box.
      const hay = `${f.method} ${f.status ?? ""} ${f.host}${f.path}`.toLowerCase();
      if (!hay.includes(text)) continue;
    }
    out.push(f);
  }
  return out;
}
