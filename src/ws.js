// Minimal RFC 6455 WebSocket server (text frames + ping/pong + close).
// Replaces socket.io with a JSON event protocol: {"event": name, "data": {...}}.

const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 64 * 1024;

class WSClient {
  constructor(socket) {
    this.socket = socket;
    this.alive = true;
    this.closed = false;
    this.handlers = new Map(); // event -> [fn]
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.data = {}; // app scratch space (userId etc.)

    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.destroy());
    socket.on('close', () => this.destroy());
    socket.setNoDelay(true);
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emitLocal(event, data) {
    for (const fn of this.handlers.get(event) || []) {
      try { fn(data); } catch (err) { console.error(`ws handler ${event}:`, err); }
    }
  }

  send(event, data) {
    if (this.closed) return;
    this.sendFrame(1, Buffer.from(JSON.stringify({ event, data })));
  }

  sendFrame(opcode, payload) {
    if (this.closed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.from([0x80 | opcode, len]);
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this.destroy(); }
  }

  ping() {
    this.alive = false;
    this.sendFrame(9, Buffer.alloc(0));
  }

  close(code = 1000) {
    const body = Buffer.alloc(2);
    body.writeUInt16BE(code);
    this.sendFrame(8, body);
    this.destroy();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch { /* already gone */ }
    this.emitLocal('_close');
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = this.parseFrame();
      if (!frame) break;
      const { fin, opcode, payload } = frame;

      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { this.sendFrame(10, payload); continue; }  // ping → pong
      if (opcode === 10) { this.alive = true; continue; }           // pong

      if (opcode === 1 || opcode === 2 || opcode === 0) {
        if (opcode !== 0) this.fragments = [payload];
        else if (this.fragments) this.fragments.push(payload);
        else continue;
        if (!fin) continue;
        const message = Buffer.concat(this.fragments);
        this.fragments = null;
        if (message.length > MAX_MESSAGE) { this.close(1009); return; }
        let parsed;
        try { parsed = JSON.parse(message.toString()); } catch { continue; }
        if (parsed && typeof parsed.event === 'string') {
          this.emitLocal(parsed.event, parsed.data);
        }
      }
    }
  }

  parseFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return null;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(MAX_MESSAGE)) { this.close(1009); return null; }
      len = Number(big);
      offset = 10;
    }
    if (len > MAX_MESSAGE) { this.close(1009); return null; }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return null;
    let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
    if (masked) {
      const mask = buf.subarray(offset, offset + 4);
      const unmasked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    this.buffer = buf.subarray(offset + maskLen + len);
    return { fin, opcode, payload };
  }
}

// attach(server, { path, onConnection(client, req) })
function attach(server, { path = '/ws', onConnection }) {
  const clients = new Set();

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const client = new WSClient(socket);
    client.request = req;
    client.query = url.searchParams;
    clients.add(client);
    client.on('_close', () => clients.delete(client));
    onConnection(client, req);
  });

  // Keepalive: ping every 30s, drop clients that never pong back.
  const interval = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) { client.destroy(); continue; }
      client.ping();
    }
  }, 30000);
  interval.unref();

  return { clients };
}

module.exports = { attach };
