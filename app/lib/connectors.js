// Streaming-app connectors (optional). They only do two things:
//   switchScene(name)  – automatic scenes (draft / game / post-game / replay)
//   saveReplay()       – capture the replay buffer (key action + automatic highlight capture)
// Replays themselves are played by the replay overlay (MP4 from the replay folder), so they work in every app.
//
// OBS Studio 28+:  obs-websocket v5 (Tools → WebSocket Server Settings).
// Streamlabs Desktop: Settings → Remote Control → show details → API token (JSON-RPC over the SockJS raw websocket
//   endpoint ws://127.0.0.1:59650/api/websocket). EXPERIMENTAL – verify on your version.
const crypto = require("crypto");
const { WS } = require("./ws");

class Base {
  constructor(log) { this.log = log; this.connected = false; this.error = null; this.ws = null; this.timer = null; this.stopped = false; }
  status() { return { connected: this.connected, error: this.error }; }
  stop() { this.stopped = true; clearTimeout(this.timer); try { this.ws && this.ws.close(); } catch {} this.connected = false; }
  retry() { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.connect(), 5000); }
}

class ObsConnector extends Base {
  constructor({ host = "127.0.0.1", port = 4455, password = "" }, log) { super(log); Object.assign(this, { host, port, password }); this.pending = new Map(); this.id = 0; }
  connect() {
    this.stopped = false;
    const ws = this.ws = new WS(`ws://${this.host}:${this.port}`);
    ws.on("message", txt => {
      let m; try { m = JSON.parse(txt); } catch { return; }
      if (m.op === 0) {          // Hello
        const d = { rpcVersion: 1, eventSubscriptions: 0 };
        const a = m.d.authentication;
        if (a) {
          const secret = crypto.createHash("sha256").update(this.password + a.salt).digest("base64");
          d.authentication = crypto.createHash("sha256").update(secret + a.challenge).digest("base64");
        }
        ws.send(JSON.stringify({ op: 1, d }));
      } else if (m.op === 2) { this.connected = true; this.error = null; this.log("OBS connected"); }
      else if (m.op === 7) {
        const p = this.pending.get(m.d.requestId); if (!p) return; this.pending.delete(m.d.requestId);
        m.d.requestStatus.result ? p.res(m.d.responseData || {}) : p.rej(new Error(m.d.requestStatus.comment || "OBS error " + m.d.requestStatus.code));
      }
    });
    ws.on("error", e => { this.error = /401|4009|auth/i.test(e.message) ? "wrong password" : e.message; });
    ws.on("close", () => { if (this.connected) this.log("OBS disconnected"); this.connected = false; if (!this.error) this.error = "closed (wrong password?)"; this.retry(); });
  }
  call(requestType, requestData = {}) {
    if (!this.connected) return Promise.reject(new Error("OBS not connected"));
    const requestId = String(++this.id);
    return new Promise((res, rej) => {
      this.pending.set(requestId, { res, rej });
      setTimeout(() => { if (this.pending.delete(requestId)) rej(new Error("OBS timeout")); }, 5000);
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }
  switchScene(name) { return this.call("SetCurrentProgramScene", { sceneName: name }); }
  saveReplay() { return this.call("SaveReplayBuffer"); }
  async replayFolder() { try { return (await this.call("GetRecordDirectory")).recordDirectory; } catch { return null; } }
  async scenes() { try { return (await this.call("GetSceneList")).scenes.map(s => s.sceneName); } catch { return []; } }
}

class StreamlabsConnector extends Base {
  constructor({ port = 59650, token = "" }, log) { super(log); Object.assign(this, { port, token }); this.pending = new Map(); this.id = 0; }
  connect() {
    this.stopped = false;
    const ws = this.ws = new WS(`ws://127.0.0.1:${this.port}/api/websocket`);
    ws.on("open", async () => {
      try { await this.rpc("auth", "TcpServerService", [this.token]); this.connected = true; this.error = null; this.log("Streamlabs connected"); }
      catch (e) { this.error = "auth failed: " + e.message; ws.close(); }
    });
    ws.on("message", txt => {
      let m; try { m = JSON.parse(txt); } catch { return; }
      const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message || "Streamlabs error")) : p.res(m.result);
    });
    ws.on("error", e => { this.error = e.message; });
    ws.on("close", () => { if (this.connected) this.log("Streamlabs disconnected"); this.connected = false; this.retry(); });
  }
  rpc(method, resource, args = []) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error("Streamlabs timeout")); }, 5000);
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params: { resource, args } }));
    });
  }
  async scenesFull() { return (await this.rpc("getScenes", "ScenesService")) || []; }
  async scenes() { try { return (await this.scenesFull()).map(s => s.name); } catch { return []; } }
  async switchScene(name) {
    const sc = (await this.scenesFull()).find(s => s.name === name);
    if (!sc) throw new Error(`scene "${name}" not found`);
    return this.rpc("makeSceneActive", "ScenesService", [sc.id]);
  }
  saveReplay() { return this.rpc("saveReplay", "StreamingService"); }
  async replayFolder() { return null; }
}

function makeConnector(cfg, log) {
  if (cfg.app === "obs") return new ObsConnector(cfg.obs || {}, log);
  if (cfg.app === "streamlabs") return new StreamlabsConnector(cfg.streamlabs || {}, log);
  return null;
}

module.exports = { makeConnector, ObsConnector, StreamlabsConnector };
