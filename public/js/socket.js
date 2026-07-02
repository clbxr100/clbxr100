// WebSocket wrapper: JSON event protocol + auto-reconnect.
import { getToken } from './api.js';

let ws = null;
let wantOpen = false;
let retryMs = 800;
const handlers = new Map(); // event -> Set<fn>

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, new Set());
  handlers.get(event).add(fn);
  return () => handlers.get(event).delete(fn);
}

function dispatch(event, data) {
  for (const fn of handlers.get(event) || []) {
    try { fn(data); } catch (err) { console.error(`handler ${event}`, err); }
  }
}

export function send(event, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data: data || {} }));
  }
}

export function connect() {
  wantOpen = true;
  open();
}

export function disconnect() {
  wantOpen = false;
  if (ws) ws.close();
  ws = null;
}

function open() {
  const token = getToken();
  if (!token || !wantOpen) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

  ws.onopen = () => {
    retryMs = 800;
    dispatch('_open');
  };
  ws.onmessage = (msg) => {
    try {
      const { event, data } = JSON.parse(msg.data);
      dispatch(event, data);
    } catch { /* ignore malformed */ }
  };
  ws.onclose = () => {
    ws = null;
    dispatch('_closed');
    if (wantOpen) {
      setTimeout(open, retryMs);
      retryMs = Math.min(8000, retryMs * 1.7);
    }
  };
}
