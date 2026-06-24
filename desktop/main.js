// Electron main process for the Nox Traffic Inspector desktop app.
//
// Responsibilities (see desktop/README.md and the project SPEC):
//   1. Spawn the existing Python backend (`python -m backend`) as a child process.
//   2. Wait until its web/WS server on 127.0.0.1:8770 is reachable.
//   3. Open a native window pointing at that origin (prod) or the Vite dev server.
//   4. Tear the backend down cleanly on quit so no orphan proxy is left on :8080.
//
// The frontend and backend are unchanged: the backend already serves the built
// frontend + /ws + /api on one origin, and the frontend builds its URLs from
// location.host, so the window just loads http://127.0.0.1:8770.

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const REPO_ROOT = path.resolve(__dirname, "..");
const WEB_PORT = 8770;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const HEALTH_URL = `${WEB_ORIGIN}/api/prereqs`;
const DEV_URL = "http://localhost:5173";
const IS_DEV = process.env.NOX_DESKTOP_MODE === "dev";

let mainWindow = null;
let backend = null;
let isQuitting = false;

// --- backend process -------------------------------------------------------

// Candidate launchers, tried in order until one spawns without ENOENT.
//
// Packaged app: launch the frozen backend exe shipped as an extraResource
// (process.resourcesPath/backend/nox-backend.exe) — no system Python needed.
// Dev/source: run `python -m backend` (NOX_PYTHON → py -3 → python).
function backendCandidates() {
  if (app.isPackaged) {
    const dir = path.join(process.resourcesPath, "backend");
    const exe = path.join(dir, process.platform === "win32" ? "nox-backend.exe" : "nox-backend");
    return [{ cmd: exe, args: [], cwd: dir }];
  }
  if (process.env.NOX_PYTHON) {
    return [{ cmd: process.env.NOX_PYTHON, args: ["-m", "backend"], cwd: REPO_ROOT }];
  }
  if (process.platform === "win32") {
    return [
      { cmd: "py", args: ["-3", "-m", "backend"], cwd: REPO_ROOT },
      { cmd: "python", args: ["-m", "backend"], cwd: REPO_ROOT },
    ];
  }
  return [
    { cmd: "python3", args: ["-m", "backend"], cwd: REPO_ROOT },
    { cmd: "python", args: ["-m", "backend"], cwd: REPO_ROOT },
  ];
}

function startBackend() {
  const candidates = backendCandidates();

  const tryCandidate = (i) => {
    if (i >= candidates.length) {
      const msg = app.isPackaged
        ? "The bundled backend executable could not be started."
        : "No working Python interpreter found. Install Python 3.11+ or set NOX_PYTHON to its path.";
      fatal("Could not start the backend", msg);
      return;
    }
    const { cmd, args, cwd } = candidates[i];
    console.log(`[backend] launching: ${cmd} ${args.join(" ")} (cwd=${cwd})`);
    const child = spawn(cmd, args, { cwd, env: process.env });

    let spawned = false;
    child.once("spawn", () => {
      spawned = true;
      backend = child;
    });
    child.on("error", (err) => {
      if (!spawned && err.code === "ENOENT") {
        console.warn(`[backend] '${cmd}' not found, trying next candidate...`);
        tryCandidate(i + 1);
      } else {
        fatal("Backend process error", String(err));
      }
    });
    child.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
    child.on("exit", (code, signal) => {
      backend = null;
      if (isQuitting) return;
      // Unexpected death while the app is meant to be running.
      fatal("Backend exited", `The Python backend stopped unexpectedly (code ${code}, signal ${signal}).`);
    });
  };

  tryCandidate(0);
}

// Kill the backend and its child tree (mitmproxy may spawn helpers).
function stopBackend() {
  if (!backend || backend.killed) return;
  const pid = backend.pid;
  if (process.platform === "win32") {
    // /T kills the whole tree, /F forces it.
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
  } else {
    backend.kill("SIGTERM");
  }
}

// --- health wait -----------------------------------------------------------

function pingHealth() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      res.resume(); // drain
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(timeoutMs = 30000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  // Date.now() is fine here (runtime), not in workflow scripts.
  while (Date.now() < deadline) {
    if (await pingHealth()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// --- window ----------------------------------------------------------------

const LOADING_HTML =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8">
  <style>
    html,body{height:100%;margin:0}
    body{display:flex;align-items:center;justify-content:center;flex-direction:column;
      background:#0f1419;color:#e6e6e6;font-family:Segoe UI,system-ui,sans-serif}
    .logo{font-weight:800;font-size:42px;color:#ff5c35;letter-spacing:-2px}
    .msg{margin-top:18px;opacity:.7;font-size:14px}
    .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff5c35;
      margin-left:6px;animation:p 1s infinite}
    @keyframes p{0%,100%{opacity:.3}50%{opacity:1}}
  </style></head><body>
  <div class="logo">//</div>
  <div class="msg">Starting Nox Traffic Inspector<span class="dot"></span></div>
  </body></html>`);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0f1419",
    title: "Nox Traffic Inspector",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Show a branded loading screen immediately so the window is never blank.
  mainWindow.loadURL(LOADING_HTML);

  // Open external links (e.g. docs) in the real browser, not the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function loadApp() {
  if (!mainWindow) return;
  const target = IS_DEV ? DEV_URL : WEB_ORIGIN;
  console.log(`[window] loading ${target}`);
  mainWindow.loadURL(target);
  if (IS_DEV) mainWindow.webContents.openDevTools({ mode: "detach" });
}

function fatal(title, detail) {
  console.error(`[fatal] ${title}: ${detail}`);
  if (!isQuitting) {
    dialog.showErrorBox(title, detail);
    isQuitting = true;
    stopBackend();
    app.quit();
  }
}

// --- app lifecycle ---------------------------------------------------------

// Only one instance — two would fight over :8080/:8770.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    createWindow();
    startBackend();

    const ready = await waitForBackend();
    if (!ready) {
      fatal("Backend did not start", `The backend never became reachable at ${HEALTH_URL} within 30s.`);
      return;
    }
    loadApp();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        loadApp();
      }
    });
  });

  app.on("window-all-closed", () => {
    app.quit(); // quit on all platforms — this is a single-window desktop app
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopBackend();
  });
}

// --- menu ------------------------------------------------------------------

function buildMenu() {
  const template = [
    {
      label: "File",
      submenu: [{ role: "quit" }],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
