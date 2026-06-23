import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { MockResponse, Rule, RuleAction } from "../types";
import { sendAction } from "../ws";

const METHODS = ["any", "GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

const ACTIONS: { value: RuleAction; label: string; hint: string }[] = [
  { value: "pause", label: "Pause for edit", hint: "intercept and let you edit before it continues" },
  { value: "drop", label: "Drop", hint: "kill the request — it never reaches the server" },
  { value: "mock", label: "Mock response", hint: "return a fixed response without contacting the server" },
];

const newRule = (): Rule => ({
  id: crypto.randomUUID(),
  name: "New rule",
  enabled: true,
  direction: "request",
  action: "pause",
  match: { method: "any", hostContains: "", urlRegex: "" },
});

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Shared light-theme input styling, matching the View screen's filter field.
const inputCls =
  "rounded border border-paper-200 bg-white px-2 py-1 text-slate-ink outline-none placeholder:text-slate-400 focus:border-accent focus:ring-1 focus:ring-accent";

// Rules side drawer (SPEC §8). Edits are local drafts — nothing is applied until
// you press Save on a card (or Save all). A rule can pause matching flows for
// edit, drop them, or return a fixed mock response. Persists via the backend
// (set_rules → rules.json), not browser storage.
export default function RulesPanel() {
  const open = useStore((s) => s.rulesOpen);
  const setOpen = useStore((s) => s.setRulesOpen);
  const saved = useStore((s) => s.rules);
  const ruleSeed = useStore((s) => s.ruleSeed);
  const clearRuleSeed = useStore((s) => s.clearRuleSeed);

  // Local working copy. Seeded from the saved rules each time the drawer opens.
  const [drafts, setDrafts] = useState<Rule[]>([]);
  useEffect(() => {
    if (open) setDrafts(saved.map((r) => structuredClone(r)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Intercept such request" (from the detail screen) hands us a pre-filled
  // rule: append it as an unsaved draft so the user can review and Save it.
  // Runs whether the drawer was just opened or already open.
  useEffect(() => {
    if (open && ruleSeed) {
      setDrafts((ds) => [...ds, structuredClone(ruleSeed)]);
      clearRuleSeed();
    }
  }, [open, ruleSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const savedById = new Map(saved.map((r) => [r.id, r]));
  const commit = (next: Rule[]) => sendAction({ action: "set_rules", rules: next });

  const isDirty = (r: Rule) => {
    const s = savedById.get(r.id);
    return !s || !eq(s, r);
  };
  const anyDirty = drafts.some(isDirty) || drafts.length !== saved.length;

  const update = (id: string, patch: Partial<Rule>) =>
    setDrafts((ds) => ds.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const updateMatch = (id: string, patch: Partial<Rule["match"]>) =>
    setDrafts((ds) =>
      ds.map((r) => (r.id === id ? { ...r, match: { ...r.match, ...patch } } : r)),
    );

  const updateMock = (id: string, patch: Partial<MockResponse>) =>
    setDrafts((ds) =>
      ds.map((r) => (r.id === id ? { ...r, mock: { ...(r.mock || {}), ...patch } } : r)),
    );

  const addRule = () => setDrafts((ds) => [...ds, newRule()]);

  // Save just this card: keep previously-saved cards untouched, commit this
  // one at its current position, and don't yet commit other unsaved cards.
  const saveOne = (rule: Rule) => {
    const next: Rule[] = [];
    for (const d of drafts) {
      if (d.id === rule.id) next.push(rule);
      else {
        const s = savedById.get(d.id);
        if (s) next.push(s);
      }
    }
    commit(next);
  };

  const saveAll = () => commit(drafts);

  const remove = (id: string) => {
    setDrafts((ds) => ds.filter((r) => r.id !== id));
    if (savedById.has(id)) commit(saved.filter((r) => r.id !== id));
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= drafts.length) return;
    setDrafts((ds) => {
      const next = [...ds];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-[440px] flex-col border-l border-paper-200 bg-paper-50 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-paper-200 bg-white px-4 py-2">
        <span className="text-sm font-semibold text-slate-700">Rules</span>
        <span className="text-xs text-slate-400">pause, drop, or mock matching flows</span>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto rounded px-2 text-slate-400 hover:text-slate-700"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-3">
        {drafts.length === 0 && (
          <div className="text-sm text-slate-400">
            No rules yet. Add one, configure it, then press Save to apply it.
          </div>
        )}

        {drafts.map((r, i) => {
          const dirty = isDirty(r);
          const isNew = !savedById.has(r.id);
          return (
            <div
              key={r.id}
              className={`rounded border bg-white p-3 shadow-sm ${
                dirty ? "border-amber-400" : "border-paper-200"
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => update(r.id, { enabled: e.target.checked })}
                  title="enabled"
                />
                <input
                  value={r.name}
                  onChange={(e) => update(r.id, { name: e.target.value })}
                  className={`flex-1 text-sm ${inputCls}`}
                />
                <button onClick={() => move(i, -1)} className="px-1 text-slate-400 hover:text-slate-700">↑</button>
                <button onClick={() => move(i, 1)} className="px-1 text-slate-400 hover:text-slate-700">↓</button>
                <button onClick={() => remove(r.id)} className="px-1 text-slate-400 hover:text-red-500">✕</button>
              </div>

              <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1.5 text-xs">
                <label className="text-slate-400">direction</label>
                <select
                  value={r.direction}
                  onChange={(e) => update(r.id, { direction: e.target.value as Rule["direction"] })}
                  className="rounded border border-paper-200 bg-white px-2 py-1 text-slate-700 outline-none focus:border-accent"
                >
                  <option value="request">request</option>
                  <option value="response">response</option>
                </select>

                <label className="text-slate-400">action</label>
                <select
                  value={r.action}
                  onChange={(e) => update(r.id, { action: e.target.value as RuleAction })}
                  title={ACTIONS.find((a) => a.value === r.action)?.hint}
                  className="rounded border border-paper-200 bg-white px-2 py-1 text-slate-700 outline-none focus:border-accent"
                >
                  {ACTIONS.map((a) => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>

                <label className="text-slate-400">method</label>
                <select
                  value={r.match.method || "any"}
                  onChange={(e) => updateMatch(r.id, { method: e.target.value })}
                  className="rounded border border-paper-200 bg-white px-2 py-1 text-slate-700 outline-none focus:border-accent"
                >
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>

                <label className="text-slate-400">host contains</label>
                <input
                  value={r.match.hostContains || ""}
                  onChange={(e) => updateMatch(r.id, { hostContains: e.target.value })}
                  placeholder="api.example.com"
                  className={`font-mono ${inputCls}`}
                />

                <label className="text-slate-400">url regex</label>
                <input
                  value={r.match.urlRegex || ""}
                  onChange={(e) => updateMatch(r.id, { urlRegex: e.target.value })}
                  placeholder="/v1/login"
                  className={`font-mono ${inputCls}`}
                />
              </div>

              {r.action === "mock" && <MockEditor mock={r.mock} onChange={(p) => updateMock(r.id, p)} />}

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => saveOne(r)}
                  disabled={!dirty}
                  className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:brightness-110 disabled:opacity-40"
                >
                  Save
                </button>
                {dirty && (
                  <span className="text-[11px] text-amber-600">● {isNew ? "not saved yet" : "unsaved changes"}</span>
                )}
                {!dirty && <span className="text-[11px] text-emerald-600">saved</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 border-t border-paper-200 bg-white p-3">
        <button
          onClick={addRule}
          className="flex-1 rounded border border-paper-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-paper-100"
        >
          + Add rule
        </button>
        <button
          onClick={saveAll}
          disabled={!anyDirty}
          className="flex-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
        >
          Save all
        </button>
      </div>
    </div>
  );
}

function MockEditor({
  mock,
  onChange,
}: {
  mock?: MockResponse;
  onChange: (patch: Partial<MockResponse>) => void;
}) {
  const headers = Object.entries(mock?.headers || {});
  const setHeaders = (rows: [string, string][]) => {
    const o: Record<string, string> = {};
    for (const [k, v] of rows) if (k.trim()) o[k] = v;
    onChange({ headers: o });
  };

  return (
    <div className="mt-3 space-y-2 rounded border border-paper-200 bg-paper-50 p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Mock response
      </div>
      <div className="flex items-center gap-2 text-xs">
        <label className="text-slate-400">status</label>
        <input
          value={mock?.status ?? 200}
          onChange={(e) => onChange({ status: Number(e.target.value) || 0 })}
          className={`w-20 font-mono ${inputCls}`}
        />
      </div>

      <div className="space-y-1">
        <div className="text-[11px] text-slate-400">headers</div>
        {headers.map(([k, v], i) => (
          <div key={i} className="flex gap-1">
            <input
              value={k}
              onChange={(e) => {
                const next = [...headers];
                next[i] = [e.target.value, v];
                setHeaders(next);
              }}
              placeholder="Content-Type"
              className={`w-1/3 font-mono text-xs ${inputCls}`}
            />
            <input
              value={v}
              onChange={(e) => {
                const next = [...headers];
                next[i] = [k, e.target.value];
                setHeaders(next);
              }}
              placeholder="application/json"
              className={`flex-1 font-mono text-xs ${inputCls}`}
            />
            <button
              onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
              className="rounded bg-paper-100 px-2 text-slate-400 hover:text-red-500"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => setHeaders([...headers, ["", ""]])}
          className="rounded bg-paper-100 px-2 py-1 text-xs text-slate-500 hover:text-slate-700"
        >
          + header
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[11px] text-slate-400">body</div>
        <textarea
          value={mock?.body || ""}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={4}
          placeholder={`{ "ok": true }`}
          className={`w-full p-2 font-mono text-xs ${inputCls}`}
        />
      </div>
    </div>
  );
}
