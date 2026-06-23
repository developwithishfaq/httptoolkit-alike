// WebSocket client with auto-reconnect (SPEC §5, M5 reconnect handling).

import { useStore } from "./store";
import type { ClientAction, ServerMsg } from "./types";

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let backoff = 500;

function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

function handleMessage(raw: string) {
  let msg: ServerMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  const store = useStore.getState();

  switch (msg.type) {
    case "flow":
      store.upsertFlow(msg);
      break;
    case "status":
      store.setConn(msg.state);
      store.setStatus({ step: msg.step, ok: msg.ok, message: msg.message });
      break;
    case "rules":
      store.setRules(msg.rules);
      break;
    case "prereqs":
      store.setPrereqs(msg.prereqs);
      break;
    case "cleared":
      store.clearFlows();
      break;
    case "error":
      store.setStatus({ step: "error", ok: false, message: msg.message });
      break;
  }
}

export function connectWs() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  socket = new WebSocket(wsUrl());

  socket.onopen = () => {
    backoff = 500;
    useStore.getState().setWsConnected(true);
  };
  socket.onmessage = (e) => handleMessage(e.data);
  socket.onclose = () => {
    useStore.getState().setWsConnected(false);
    scheduleReconnect();
  };
  socket.onerror = () => socket?.close();
}

function scheduleReconnect() {
  if (reconnectTimer != null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    backoff = Math.min(backoff * 2, 5000);
    connectWs();
  }, backoff);
}

export function sendAction(action: ClientAction) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(action));
  }
}
