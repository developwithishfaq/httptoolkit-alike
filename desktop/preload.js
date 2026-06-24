// Preload script (contextIsolation enabled).
//
// The UI talks to the backend over WebSocket + REST, so no Electron IPC bridge
// is needed today. This file is intentionally minimal but present, so native
// capabilities (e.g. a native "save certificate" dialog, OS notifications, or
// deep links) can be exposed here later via contextBridge without re-plumbing.

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("noxDesktop", {
  isDesktop: true,
  platform: process.platform,
});
