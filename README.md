# Nox Traffic Inspector & Interceptor

A desktop-style local app that captures, inspects, and (soon) live-edits the
network traffic of apps running inside the **Nox Android emulator**, using
**mitmproxy** as the interception engine and **adb** for emulator control.
Target platform: **Windows 11**. See [SPEC.md](SPEC.md) for the full design.

> **Build status — M0–M2 complete.** Passive capture + flow detail work today.
> One-click **Connect** (M3) and **rules / intercept-edit** (M4) are scaffolded
> but not yet wired — see [Milestone status](#milestone-status).

---

## What works right now

- **Live traffic view** — every HTTP/HTTPS flow from the emulator streams into a
  virtualized, filterable list in real time (method, status, host, path, size,
  duration), newest at the bottom with an autoscroll toggle.
- **Flow detail** — click any row for Request / Response tabs: full URL, parsed
  query params, header tables, and bodies with JSON pretty-print + raw toggle.
  Binary/oversized bodies are shown as "binary, N bytes", never dumped.
- **Copy as cURL**, free-text + method + status-class filtering, and Clear.
- Backend already binds the proxy on `0.0.0.0:8080` and generates the mitmproxy
  CA on first run, so M1 (manual cert + proxy) works end-to-end.

For M0–M2 you set the Nox proxy and install the CA **manually** (steps below).
M3 automates all of that behind the Connect button.

---

## Prerequisites

- **Python 3.11+** and **Node 18+**.
- **Nox App Player**, with (set these in Nox *before* using the tool):
  - **Root mode: ON** (Nox Settings → General → Root → enable, then restart Nox).
  - **Android 7 (Nougat) or 9 (Pie)** image. Android 10+ makes the system cert
    store hard to write to; M3 will detect and warn, but for v1 use 7 or 9.
- **adb** — the tool prefers Nox's bundled `nox_adb.exe`; otherwise `adb` on PATH.
- Allow **Python through Windows Firewall** on TCP **8080** the first time, or:
  ```
  netsh advfirewall firewall add rule name=NoxProxy dir=in action=allow protocol=TCP localport=8080
  ```

---

## Run (dev)

```powershell
# 1) backend  (proxy :8080, web/WS :8770)
cd backend
pip install -r requirements.txt
cd ..
python -m backend

# 2) frontend (separate terminal) — Vite dev server, proxies /ws + /api to :8770
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The connection bar should show `WS connected`
and `Proxy running`, with the host LAN IP the emulator should point at. Click
**Diagnostics** to check prerequisites (adb, mitmproxy CA) and copy the firewall
rule; a missing prerequisite shows an amber dot on that button.

Or use the convenience launcher from the repo root:

```powershell
./scripts/dev.ps1        # Windows
./scripts/dev.sh         # bash
```

### Prod-ish (single process)

```powershell
cd frontend && npm run build && cd ..
python -m backend        # serves frontend/dist at http://127.0.0.1:8770
```

### Desktop app (Electron)

Run it as a **native desktop window** instead of in a browser — an Electron shell
spawns the Python backend, waits for it, and loads the UI; closing the window tears
the backend down. No app code changes; see [desktop/README.md](desktop/README.md).

```powershell
cd desktop
npm install
npm run build:frontend   # builds frontend/dist
npm start                # opens the native window (backend on :8770/:8080)
```

For hot-reload development, run `npm --prefix frontend run dev` in one terminal and
`npm run dev` (in `desktop/`) in another. Packaging into a standalone installer
(PyInstaller + electron-builder) is documented as Phase 2 in the desktop README.

---

## Manual cert/proxy setup (fallback for Android 14+ images)

On an Android 7–13 image just click **Connect** — it does all of this for you
(≤9 writes to /system; 10–13 uses an in-memory tmpfs overlay). These manual steps
are the fallback for Android 14+, where the cert store moved to `/apex`:

1. Start the backend once so mitmproxy generates its CA at
   `%USERPROFILE%\.mitmproxy\mitmproxy-ca-cert.pem`.
2. Point Nox at the host proxy (the IP shown in the connection bar), e.g. via adb:
   ```
   adb -s 127.0.0.1:62001 shell "settings put global http_proxy <HOST_LAN_IP>:8080"
   ```
3. Install the CA into Nox's system store (Android 7/9, root on):
   ```
   # compute the Android filename <hash>.0 with OpenSSL (the backend computes it too):
   openssl x509 -inform PEM -subject_hash_old -in %USERPROFILE%\.mitmproxy\mitmproxy-ca-cert.pem
   adb -s 127.0.0.1:62001 root
   adb -s 127.0.0.1:62001 remount
   adb -s 127.0.0.1:62001 push <hash>.0 /system/etc/security/cacerts/<hash>.0
   adb -s 127.0.0.1:62001 shell "chmod 644 /system/etc/security/cacerts/<hash>.0"
   ```
4. Browse in the emulator — flows (incl. HTTPS) appear live in the list; click a
   row to inspect request/response.

---

## Milestone status

| Milestone | Scope | Status |
|-----------|-------|--------|
| **M0** | Scaffold; backend + frontend boot; WS connects | ✅ done |
| **M1** | Passive capture on `0.0.0.0:8080`, flows stream to UI | ✅ done |
| **M2** | Flow detail (tabs, headers, pretty JSON, binary handling) | ✅ done |
| **M3** | One-click Connect orchestration (adb → root → cert → proxy) | ✅ done — live checklist; system-CA auto-install on Android 7–13 (≤9 via /system push, 10–13 via tmpfs overlay) |
| **M4** | Rules panel + intercept / edit / forward / drop | ✅ done — rule actions: pause-for-edit, drop, or mock response; per-card Save (drafts until applied); editor forwards (with edits) or drops; plus a dedicated **Resend** screen that replays requests through the proxy |
| **M5** | Polish: rule persistence, reconnect, prereq detection, README | ✅ done — filtering, autoscroll, clear, copy-as-cURL, rule persistence, WS reconnect + banner, Diagnostics panel (`/api/prereqs`), firewall hint |

**Connect supports Android 7–13.** On 10–13 the cert is
installed via a tmpfs overlay (HTTP Toolkit's technique — no reboot, no APK, but
resets on emulator reboot). On **Android 14+** the cert store moved to `/apex`
and needs per-namespace mounts; Connect stops cleanly at the Android check there.

---

## Intercepting & editing requests (M4)

1. Click **Rules** (top bar) → **+ Add rule**. Set a name, direction
   (request/response), match criteria (method, *host contains*, *url regex*),
   and an **action**. Edits are local drafts — press **Save** on a card (or
   **Save all**) to apply them. Rules persist to
   `%APPDATA%\nox-inspector\rules.json`.
2. Each rule does one of three things when it matches:
   - **Pause for edit** — the flow pauses (⏸ badge + **N intercepted** button).
     Open it to change method/URL/headers/body (with a *format JSON* helper),
     then **Send** the edited request/response or **Drop** it. Flows queue;
     other traffic keeps flowing while one is paused.
   - **Drop** — the request is killed immediately; it never reaches the server
     (row shows `drop`).
   - **Mock response** — short-circuits with a fixed status/headers/body without
     contacting the server (row shows a ◆ badge).

## Resending requests

Click **⟳ Resend** on a captured flow (detail panel) to open the request builder
prefilled from it, or **⟳ Resend** in the top bar for a blank request. Edit the
method, URL, headers, and body, then **Send**. The replay is routed through the
proxy, so it's captured like any other flow — it appears in the list (with a ⟳
badge) and its response is shown inline in the screen. Works with or without a
connected device.

## Architecture (one process)

Everything runs in **one Python asyncio process** so the mitmproxy addon, the
WebSocket handler, the pending-flow registry, and the rule list share memory
directly — which is what will make intercept→edit→resume reliable in M4.

```
Frontend (React/Vite :5173)  ──WS /ws + REST /api──►  Python backend
                                                       ├ mitmproxy DumpMaster (proxy :8080, 0.0.0.0)
                                                       ├ aiohttp web/WS (:8770)
                                                       ├ adb orchestrator (nox_adb/adb subprocess)
                                                       └ cert manager + rules + flow store
        Nox emulator ──system http_proxy──► host:8080 ──► mitmproxy
```

See [SPEC.md §4–§10](SPEC.md) for details.

---

## Known limitations (v1)

- **Certificate pinning** — apps that pin their own cert won't decrypt; this is
  expected (optional Frida-based unpinning is a future phase, SPEC §13).
- **Android version** — auto cert install (M3) targets API ≤ 28 (Android ≤ 9).
  Android 10+ is detected and reported, not silently attempted.
- **QUIC / HTTP3** — bypasses an HTTP proxy and is out of scope; if traffic is
  missing, an app may be using QUIC (SPEC §12).
- **adb server conflicts** — `nox_adb` vs platform-tools `adb` can fight; the
  orchestrator handles "offline" with a `kill-server` + retry.

## Responsible use

This tool is for inspecting traffic from apps you run in **your own** emulator
(your own apps, or apps you're authorized to test). Intercepting third-party
services or bypassing pinning on apps you don't own may violate terms of service
or law. You are responsible for how you use it.
