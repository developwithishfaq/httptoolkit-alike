// Wire types mirroring the backend protocol (SPEC §9).

export type FlowPhase = "request" | "paused" | "response";

export interface Flow {
  type: "flow";
  phase: FlowPhase;
  id: string;
  tStart: number;
  method: string;
  scheme: string;
  host: string;
  path: string;
  url: string;
  reqHeaders: Record<string, string>;
  reqBody?: string;
  reqBinary: boolean;
  reqSize?: number;
  reqTruncated?: boolean;
  status?: number;
  reason?: string;
  respHeaders?: Record<string, string>;
  respBody?: string;
  respBinary?: boolean;
  respSize?: number;
  respTruncated?: boolean;
  durationMs?: number;
  dropped?: boolean;
  mocked?: boolean;
  reqMocked?: boolean; // request body was replaced by a "mock request body" rule
  error?: string;
  replay?: boolean;
  replayToken?: string;
}

export interface ConnState {
  connected: boolean;
  proxyRunning: boolean;
  certInstalled: boolean;
  deviceSerial: string | null;
  androidSdk: number | null;
  hostProxy: string | null;
  rooted: boolean | null;
  certMode: "system" | "user" | null;
}

export interface StatusMsg {
  type: "status";
  step: string;
  ok: boolean;
  message: string;
  state: ConnState;
}

// Per-app Frida interception state (separate from the system-proxy ConnState).
export interface FridaState {
  available: boolean;       // feature can run on this host (pkg + binary present)
  serverRunning: boolean;   // frida-server up + host attached
  targetApp: string | null; // package currently intercepted
  targetPid: number | null;
  fridaVersion: string | null;
  reason: string | null;    // why unavailable / last error, for the UI
}

export interface FridaMsg {
  type: "frida";
  step: string;
  ok: boolean;
  message: string;
  frida: FridaState;
}

export interface FridaAppsMsg {
  type: "frida_apps";
  apps: string[];
}

export interface RuleMatch {
  method?: string;
  hostContains?: string;
  urlRegex?: string;
}

// What a matching rule does. "pause" = intercept for manual edit; "drop" =
// kill the request (never reaches the server); "mock" = short-circuit with a
// fixed response without contacting the server; "mock_request" = replace the
// outgoing request body with a fixed one, then forward it to the server.
export type RuleAction = "pause" | "drop" | "mock" | "mock_request";

export interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  direction: "request" | "response";
  action: RuleAction;
  match: RuleMatch;
  mock?: MockResponse;
  mockReqBody?: string; // body substituted when action is "mock_request"
}

export interface RulesMsg {
  type: "rules";
  rules: Rule[];
}

export interface PrereqCheck {
  ok: boolean;
  detail: string;
}

export interface Prereqs {
  adb: PrereqCheck;
  mitmCA: PrereqCheck;
  hostIp: string;
  proxyPort: number;
  firewallHint: string;
}

export interface PrereqsMsg {
  type: "prereqs";
  prereqs: Prereqs;
}

export interface ErrorMsg {
  type: "error";
  message: string;
}

export interface ClearedMsg {
  type: "cleared";
}

export type ServerMsg =
  | Flow
  | StatusMsg
  | FridaMsg
  | FridaAppsMsg
  | RulesMsg
  | PrereqsMsg
  | ErrorMsg
  | ClearedMsg;

export type ClientAction =
  | { action: "connect" }
  | { action: "disconnect" }
  | { action: "reboot_device" }
  | { action: "clear" }
  | { action: "set_rules"; rules: Rule[] }
  | { action: "forward"; id: string; edits: Record<string, unknown> }
  | { action: "drop"; id: string }
  | {
      action: "resend";
      request: {
        method: string;
        url: string;
        headers: Record<string, string>;
        body: string;
        token: string;
      };
    }
  | { action: "check_prereqs" }
  | { action: "frida_start" }
  | { action: "frida_list_apps" }
  | { action: "frida_intercept"; package: string }
  | { action: "frida_stop" };
