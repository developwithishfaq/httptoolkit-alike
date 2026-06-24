import { create } from "zustand";
import type { ConnState, Flow, FridaState, Prereqs, Rule } from "./types";

// Prefill for the Resend screen. Headers are kept as ordered pairs so the
// editor can show/edit duplicates and preserve order.
export interface ResendSeed {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}

const MAX_FLOWS = 5000;

// Feature 1 — "Connect device (ADB)" link steps (no cert/proxy here).
export const CONNECT_STEPS: { key: string; label: string }[] = [
  { key: "adb_found", label: "adb" },
  { key: "device_connected", label: "device" },
  { key: "rooted", label: "root" },
  { key: "android_checked", label: "android" },
  { key: "connected", label: "linked" },
];
const STEP_KEYS = new Set(CONNECT_STEPS.map((s) => s.key));

// Feature 2 — "Intercept traffic" (device-wide capture) steps.
export const INTERCEPT_STEPS: { key: string; label: string }[] = [
  { key: "proxy_running", label: "proxy" },
  { key: "cert_installed", label: "cert" },
  { key: "proxy_set", label: "set proxy" },
  { key: "capturing", label: "capturing" },
];
const INTERCEPT_STEP_KEYS = new Set(INTERCEPT_STEPS.map((s) => s.key));

// Ordered Frida steps for the per-app interception checklist.
export const FRIDA_STEPS: { key: string; label: string }[] = [
  { key: "frida_device", label: "device" },
  { key: "frida_abi", label: "cpu" },
  { key: "frida_push", label: "push" },
  { key: "frida_launch", label: "server" },
  { key: "frida_connect", label: "attach" },
  { key: "frida_inject", label: "inject" },
];
const FRIDA_STEP_KEYS = new Set(FRIDA_STEPS.map((s) => s.key));

export interface StepState {
  ok: boolean;
  message: string;
}

// Which parts of a flow the free-text box scans. Toggleable so the user can
// narrow a noisy search (e.g. body-only) — by default all four are on so the
// box "just finds it" wherever it lives.
export type FilterScope = "url" | "headers" | "reqBody" | "respBody";

export const SCOPE_LABELS: { key: FilterScope; label: string }[] = [
  { key: "url", label: "URL" },
  { key: "headers", label: "Headers" },
  { key: "reqBody", label: "Req body" },
  { key: "respBody", label: "Resp body" },
];

export interface Filters {
  text: string;
  method: string; // "" = any
  statusClass: string; // "", "2", "3", "4", "5"
  scopes: Record<FilterScope, boolean>;
}

export const DEFAULT_SCOPES: Record<FilterScope, boolean> = {
  url: true,
  headers: true,
  reqBody: true,
  respBody: true,
};

// True when filters are at their "show everything" defaults — drives the
// "active filters" indicator on the toolbar.
export function filtersActive(f: Filters): boolean {
  return (
    f.text.trim() !== "" ||
    f.method !== "" ||
    f.statusClass !== "" ||
    SCOPE_LABELS.some((s) => !f.scopes[s.key])
  );
}

interface AppStore {
  // connection / transport
  wsConnected: boolean;
  conn: ConnState;
  lastStatus: { step: string; ok: boolean; message: string } | null;
  steps: Record<string, StepState>;          // feature 1 (connect/link) checklist
  connecting: boolean;
  interceptSteps: Record<string, StepState>; // feature 2 (intercept traffic) checklist
  intercepting: boolean;

  // frida (per-app interception)
  frida: FridaState;
  fridaSteps: Record<string, StepState>;
  fridaStatus: { step: string; ok: boolean; message: string } | null;
  fridaApps: string[];
  fridaBusy: boolean; // a start/inject orchestration is in flight

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
  startIntercept: () => void;
  applyFridaStep: (m: { step: string; ok: boolean; message: string; frida: FridaState }) => void;
  setFridaApps: (apps: string[]) => void;
  startFrida: () => void;
  beginFridaInject: () => void;
  upsertFlow: (f: Flow) => void;
  clearFlows: () => void;
  select: (id: string | null) => void;
  setAutoscroll: (v: boolean) => void;
  setCapturePaused: (v: boolean) => void;
  setFilters: (f: Partial<Filters>) => void;
  toggleScope: (scope: FilterScope) => void;
  resetFilters: () => void;
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
    capturing: false,
    proxyRunning: false,
    certInstalled: false,
    deviceSerial: null,
    androidSdk: null,
    hostProxy: null,
    rooted: null,
    certMode: null,
  },
  lastStatus: null,
  steps: {},
  connecting: false,
  interceptSteps: {},
  intercepting: false,

  frida: {
    available: false,
    serverRunning: false,
    targetApp: null,
    targetPid: null,
    fridaVersion: null,
    reason: null,
  },
  fridaSteps: {},
  fridaStatus: null,
  fridaApps: [],
  fridaBusy: false,

  flows: new Map(),
  order: [],
  selectedId: null,

  mainView: "intercept",
  autoscroll: true,
  capturePaused: false,
  filters: { text: "", method: "", statusClass: "", scopes: { ...DEFAULT_SCOPES } },
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
        // Feature 1 — device link checklist.
        next.steps = { ...state.steps, [s.step]: { ok: s.ok, message: s.message } };
        // Terminal: success on the final step ("connected"=linked), or any failure.
        if (s.step === "connected" ? s.ok : !s.ok) next.connecting = false;
      } else if (INTERCEPT_STEP_KEYS.has(s.step)) {
        // Feature 2 — device-wide capture checklist.
        next.interceptSteps = { ...state.interceptSteps, [s.step]: { ok: s.ok, message: s.message } };
        if (s.step === "capturing" ? s.ok : !s.ok) next.intercepting = false;
        // Only once traffic is actually flowing do we jump to the traffic view.
        if (s.step === "capturing" && s.ok) next.mainView = "view";
      } else if (!s.ok) {
        // A non-step failure (e.g. "capture"/"connect" guard) clears both spinners.
        next.connecting = false;
        next.intercepting = false;
      }
      return next;
    }),
  setMainView: (v) => set({ mainView: v }),
  startConnect: () => set({ connecting: true, steps: {}, lastStatus: null }),
  startIntercept: () => set({ intercepting: true, interceptSteps: {}, lastStatus: null }),

  applyFridaStep: (m) =>
    set((state) => {
      const next: Partial<AppStore> = { frida: m.frida, fridaStatus: m };
      if (FRIDA_STEP_KEYS.has(m.step)) {
        next.fridaSteps = { ...state.fridaSteps, [m.step]: { ok: m.ok, message: m.message } };
        // The flow has two phases that each end "busy". The start phase ends at
        // frida_connect (server up → app picker becomes interactive); the inject
        // phase ends at frida_inject. Either terminal, or any failure, frees the UI.
        const startPhaseDone = m.step === "frida_connect" && m.ok;
        const injectDone = m.step === "frida_inject";
        if (startPhaseDone || injectDone || !m.ok) next.fridaBusy = false;
        // Once the app is hooked, jump to the traffic view so the user sees
        // its flows immediately (mirrors the device-wide capture behaviour).
        if (m.step === "frida_inject" && m.ok) next.mainView = "view";
      } else if (!m.ok) {
        next.fridaBusy = false;
      }
      return next;
    }),
  setFridaApps: (apps) => set({ fridaApps: apps }),
  // Start frida-server: reset the checklist (device→attach), keep app picker.
  startFrida: () => set({ fridaBusy: true, fridaSteps: {}, fridaStatus: null }),
  // Begin injecting into a chosen app: only the inject step is pending now.
  beginFridaInject: () =>
    set((s) => {
      const kept: Record<string, StepState> = { ...s.fridaSteps };
      delete kept.frida_inject;
      return { fridaBusy: true, fridaSteps: kept };
    }),

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
  toggleScope: (scope) =>
    set((s) => {
      const scopes = { ...s.filters.scopes, [scope]: !s.filters.scopes[scope] };
      // Never let the user turn off every scope — a text query with no field to
      // search would silently hide everything. Keep the one they just toggled.
      if (!SCOPE_LABELS.some((sc) => scopes[sc.key])) scopes[scope] = true;
      return { filters: { ...s.filters, scopes } };
    }),
  resetFilters: () =>
    set((s) => ({
      filters: { ...s.filters, text: "", method: "", statusClass: "", scopes: { ...DEFAULT_SCOPES } },
    })),
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

function headersContain(h: Record<string, string> | undefined, text: string): boolean {
  if (!h) return false;
  for (const k of Object.keys(h)) {
    if (k.toLowerCase().includes(text) || (h[k] ?? "").toLowerCase().includes(text)) return true;
  }
  return false;
}

// Returns the first enabled scope in which `text` (already trimmed + lowercased)
// is found, or null for no match. The scopes are probed cheap→expensive (URL,
// then headers, then bodies) with early-exit so a busy filter over 5000 flows
// rarely touches a body. Callers pass non-empty text; empty text → null.
export function matchedScope(
  f: Flow,
  text: string,
  scopes: Record<FilterScope, boolean>,
): FilterScope | null {
  if (!text) return null;
  if (scopes.url && `${f.method} ${f.status ?? ""} ${f.url}`.toLowerCase().includes(text))
    return "url";
  if (scopes.headers && (headersContain(f.reqHeaders, text) || headersContain(f.respHeaders, text)))
    return "headers";
  if (scopes.reqBody && !f.reqBinary && f.reqBody && f.reqBody.toLowerCase().includes(text))
    return "reqBody";
  if (scopes.respBody && !f.respBinary && f.respBody && f.respBody.toLowerCase().includes(text))
    return "respBody";
  return null;
}

// Derived helper: apply filters to the ordered flow list. The free-text box is
// an advanced multi-field search (URL / headers / request + response bodies),
// scoped by `filters.scopes`; method and status narrow it further.
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
    if (text && matchedScope(f, text, filters.scopes) === null) continue;
    out.push(f);
  }
  return out;
}
