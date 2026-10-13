/**
 * Live data layer, running off the main thread.
 *
 * As a SharedWorker it owns ONE WebSocket for every AeroOS tab and window in this browser (OCC desks
 * run several monitors). It authenticates, reconnects with backoff, and batches incoming events so
 * the UI applies them at most a few times per second instead of once per message.
 * Falls back to a dedicated Worker where SharedWorker is unavailable.
 */

interface Port { postMessage(m: unknown): void }
type Inbound = { type: 'init'; url: string; token: string } | { type: 'token'; token: string };

const ports = new Set<Port>();
let ws: WebSocket | null = null;
let url = '';
let token = '';
let connected = false;
let attempt = 0;
let pending: unknown[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const broadcast = (m: unknown) => ports.forEach(p => p.postMessage(m));

function setConnected(v: boolean) {
  connected = v;
  broadcast({ type: 'status', connected: v });
}

function queue(event: unknown) {
  pending.push(event);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    const batch = pending;
    pending = [];
    broadcast({ type: 'events', events: batch });
  }, 200);
}

function connect() {
  if (!url || !token || ws) return;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token }));
  sock.onmessage = e => {
    const m = JSON.parse(String(e.data)) as { type: string; event?: unknown };
    if (m.type === 'ready') {
      attempt = 0;
      setConnected(true);
    } else if (m.type === 'event') {
      queue(m.event);
    }
  };
  sock.onclose = () => {
    ws = null;
    setConnected(false);
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt++));
  };
}

function handle(port: Port, msg: Inbound) {
  if (msg.type === 'init') {
    url = msg.url;
    token = msg.token;
    connect();
    port.postMessage({ type: 'status', connected });
  } else if (msg.type === 'token') {
    token = msg.token;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'auth', token }));
  }
}

const scope = self as unknown as {
  onconnect?: (e: MessageEvent) => void;
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(m: unknown): void;
};

if ('onconnect' in scope) {
  scope.onconnect = (e: MessageEvent) => {
    const port = e.ports[0];
    ports.add(port);
    port.onmessage = ev => handle(port, ev.data as Inbound);
    port.start();
  };
} else {
  const self_ = scope as Port;
  ports.add(self_);
  scope.onmessage = ev => handle(self_, ev.data as Inbound);
}
