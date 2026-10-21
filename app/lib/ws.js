// Minimal WebSocket client (RFC 6455, ws:// only, text frames) – keeps the app free of npm dependencies.
const http = require("http");
const crypto = require("crypto");
const { EventEmitter } = require("events");

class WS extends EventEmitter {
  constructor(url) {
    super();
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString("base64");
    this.open = false; this.buf = Buffer.alloc(0); this.frag = [];
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" } });
    req.setTimeout(5000, () => req.destroy(new Error("timeout")));
    req.on("upgrade", (res, socket, head) => {
      this.sock = socket; this.open = true; socket.setNoDelay(true);
      socket.on("data", d => this.onData(d));
      socket.on("close", () => { if (this.open) { this.open = false; this.emit("close"); } });
      socket.on("error", e => this.emit("error", e));
      if (head && head.length) this.onData(head);
      this.emit("open");
    });
    req.on("response", res => this.emit("error", new Error("HTTP " + res.statusCode)));
    req.on("error", e => this.emit("error", e));
    req.end();
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? b.slice(off, off + 4) : null; if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.slice(off, off + len); this.buf = b.slice(off + len);
      if (mask) payload = Buffer.from(payload.map((x, i) => x ^ mask[i % 4]));
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.frame(0xA, payload); continue; }
      if (op === 0xA) continue;
      this.frag.push(payload);
      if (fin) { const msg = Buffer.concat(this.frag).toString("utf8"); this.frag = []; this.emit("message", msg); }
    }
  }
  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length, mask = crypto.randomBytes(4);
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, 0x80 | len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(len), 2); }
    const body = Buffer.from(payload.map((x, i) => x ^ mask[i % 4]));
    this.sock.write(Buffer.concat([head, mask, body]));
  }
  send(text) { this.frame(0x1, Buffer.from(text, "utf8")); }
  close() { if (!this.open) return; try { this.frame(0x8, Buffer.alloc(0)); } catch {} this.open = false; this.sock && this.sock.end(); this.emit("close"); }
}

module.exports = { WS };
