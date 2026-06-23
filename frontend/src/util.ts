import type { Flow, Rule } from "./types";

export function fmtTime(tStart: number): string {
  const d = new Date(tStart * 1000);
  return d.toLocaleTimeString("en-US", { hour12: false }) + "." +
    String(d.getMilliseconds()).padStart(3, "0");
}

export function fmtSize(bytes?: number): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// Method label color tuned for a light background (HTTP Toolkit keeps these
// fairly muted — the row is identified more by its category stripe).
export function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "text-emerald-700";
    case "POST":
      return "text-amber-700";
    case "PUT":
      return "text-blue-700";
    case "DELETE":
      return "text-red-700";
    case "PATCH":
      return "text-purple-700";
    default:
      return "text-slate-700";
  }
}

export function statusColor(status?: number): string {
  if (!status) return "text-slate-400";
  if (status < 300) return "text-emerald-600";
  if (status < 400) return "text-cyan-700";
  if (status < 500) return "text-orange-600";
  return "text-red-600";
}

// Stable per-host hue for the thin colored stripe on the left of each row,
// mirroring HTTP Toolkit's category coloring. Same host → same color.
export function categoryColor(host?: string): string {
  if (!host) return "hsl(220 6% 70%)";
  let h = 0;
  for (let i = 0; i < host.length; i++) {
    h = (h * 31 + host.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 65% 55%)`;
}

export type Source = "chrome" | "android" | "node" | "generic";

// HTTP Toolkit shows the originating client. We don't capture the client app,
// so approximate it from the request User-Agent.
export function sourceFromUA(headers?: Record<string, string>): Source {
  const ua = (headerVal(headers, "user-agent") || "").toLowerCase();
  if (!ua) return "generic";
  if (ua.includes("android") || ua.includes("dalvik") || ua.includes("okhttp")) return "android";
  if (ua.includes("chrome") || ua.includes("chromium") || ua.includes("crios")) return "chrome";
  if (ua.includes("node") || ua.includes("python") || ua.includes("curl") || ua.includes("aiohttp"))
    return "node";
  return "generic";
}

// Try to pretty-print a JSON body; returns null if it isn't JSON.
export function tryPrettyJson(body?: string, contentType?: string): string | null {
  if (!body) return null;
  const looksJson =
    (contentType && contentType.toLowerCase().includes("json")) ||
    /^\s*[[{]/.test(body);
  if (!looksJson) return null;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return null;
  }
}

export function headerVal(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}

// Build a copy-as-cURL string for a request (SPEC §8 nice-to-have).
export function toCurl(f: Flow): string {
  const parts = [`curl -X ${f.method} ${JSON.stringify(f.url)}`];
  for (const [k, v] of Object.entries(f.reqHeaders || {})) {
    parts.push(`  -H ${JSON.stringify(`${k}: ${v}`)}`);
  }
  if (f.reqBody && !f.reqBinary) {
    parts.push(`  --data ${JSON.stringify(f.reqBody)}`);
  }
  return parts.join(" \\\n");
}

// Escape a string so it can be embedded in a RegExp as a literal.
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build a "pause for edit" rule that intercepts requests just like this flow:
// same HTTP method and the exact same URL (matched literally, anchored). Used
// by the "Intercept such request" action on the detail screen.
export function ruleFromFlow(f: Flow): Rule {
  return {
    id: crypto.randomUUID(),
    name: `Intercept ${f.method} ${f.host}`,
    enabled: true,
    direction: "request",
    action: "pause",
    match: {
      method: f.method.toUpperCase(),
      hostContains: "",
      urlRegex: `^${escapeRegex(f.url)}$`,
    },
  };
}
