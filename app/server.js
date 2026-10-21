#!/usr/bin/env node
// Dota Caster Kit – local production helper for Dota 2 tournament streams.
//   node app/server.js            → control panel at http://127.0.0.1:58900/
// Node 18+, no npm dependencies. Data (settings, matches, uploads) lives in ./data next to the app.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { Recorder, readJson, writeJson } = require("./lib/game");
const { AdPlus } = require("./lib/adplus");
const { Replays } = require("./lib/replays");
const { Themes, SLOTS, TEAM_LOGO } = require("./lib/themes");
const { makeConnector } = require("./lib/connectors");
const { heroName } = require("./lib/heroes");

const ROOT = path.resolve(__dirname, "..");
const DATA = process.env.DCK_DATA || path.join(ROOT, "data");
const PORT = +(process.env.DCK_PORT || 58900);
const VERSION = require(path.join(ROOT, "package.json")).version;
fs.mkdirSync(DATA, { recursive: true });

// ------------------------------------------------------------------ log
const logLines = [];
function log(...a) {
  const line = `${new Date().toLocaleTimeString()} ${a.join(" ")}`;
  console.log(line); logLines.push(line); if (logLines.length > 200) logLines.shift();
  broadcast("log", line);
}

// ------------------------------------------------------------------ settings
const DEFAULTS = {
  mode: "ap",                                   // "ap" (All Pick, CM, Turbo…) | "ad" (Ability Draft – needs AD+)
  theme: "esports",
  themeVars: {},                                // per-variable overrides from the panel (colours)
  tournament: { name: "My Dota Tournament", tagline: "" },
  teams: [
    { id: "t1", name: "Team Radiant", short: "RAD", color: "#5ad16a" },
    { id: "t2", name: "Team Dire", short: "DIRE", color: "#e0554a" },
  ],
  match: { a: "t1", b: "t2", aSide: "radiant", bo: 3, round: "", games: [], result: null },
  betweenText: "Coming soon",
  replays: { folder: "", defaultSeconds: 30 },
  app: "none",                                  // "none" | "obs" | "streamlabs"
  obs: { host: "127.0.0.1", port: 4455, password: "" },
  streamlabs: { port: 59650, token: "" },
  scenes: { auto: true, draft: "Draft", game: "Game", postgame: "Postgame", replay: "Replay", between: "Between Games", postDelay: 5 },
  autoCapture: true,
  autoResult: true,                             // add the finished game to the series score automatically
  adplusUrl: "http://127.0.0.1:58873",
};
const SETTINGS_FILE = path.join(DATA, "settings.json");
let settings = merge(DEFAULTS, readJson(SETTINGS_FILE) || {});
function merge(a, b) { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k]) ? merge(a[k], v) : v; return o; }
function saveSettings() { writeJson(SETTINGS_FILE, settings); }

// ------------------------------------------------------------------ live push to panel + overlays (SSE)
const clients = new Set();
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) { try { c.write(msg); } catch { clients.delete(c); } }
}
let themeRev = 0;
function bumpTheme() { themeRev++; broadcast("theme", {}); }
function pushState() { broadcast("state", publicState()); }

// ------------------------------------------------------------------ components
const themes = new Themes({ root: path.join(ROOT, "themes"), dataDir: DATA });
const adplus = new AdPlus({ url: settings.adplusUrl, log });
const display = { screen: "off", player: null, player2: null, mvp: null, rev: 0 };      // post-game overlay
const replay = { clipId: null, fromEnd: null, speed: 1, playing: false, rev: 0, start: 0 };   // start++ = (re)start playback        // replay overlay
let ready = null;               // newest captured clip id (what "show last N s" plays)
let pendingHl = null;           // highlight waiting for its replay file
let connector = null;

const recorder = new Recorder({
  dataDir: DATA, log,
  draftedFor: players => { if (settings.mode === "ad") adplus.attach(players); },
  onMatch: m => { const s = sides(); m.teams = { radiant: teamInfo(s.radiant), dire: teamInfo(s.dire) }; m.mode = settings.mode;
                  // series score: the winning side's team gets the game (turn off in Match tab if you watch old replays)
                  if (settings.autoResult && m.winTeam && !settings.match.result && settings.match.lastMatchId !== m.matchId) {
                    settings.match.lastMatchId = m.matchId; recordResult(s[m.winTeam] === settings.match.a ? "a" : "b");
                  }
                  setTimeout(pushState, 100); },
  onPhase: (phase) => onPhase(phase),
  onHighlight: hl => onHighlight(hl),
});
const replays = new Replays({ dataDir: DATA, log, onClip: c => onClip(c) });
replays.setFolder(settings.replays.folder);
if (settings.mode === "ad") adplus.start();
startConnector();

function teamInfo(id) { const t = settings.teams.find(x => x.id === id); return t ? { ...t, logo: teamLogo(t.id) } : null; }
function teamLogo(id) { const dir = path.join(DATA, "uploads", "teams"); try { const f = fs.readdirSync(dir).find(x => x.startsWith(id + ".")); return f ? `/uploads/teams/${f}` : null; } catch { return null; } }
function sides() { const m = settings.match; return m.aSide === "radiant" ? { radiant: m.a, dire: m.b } : { radiant: m.b, dire: m.a }; }
function seriesScore() { const g = settings.match.games || []; return { a: g.filter(x => x === "a").length, b: g.filter(x => x === "b").length }; }

function publicState() {
  const m = settings.match, sc = seriesScore();
  return {
    assets: assetsOf(settings.theme), themeRev,
    version: VERSION, mode: settings.mode, theme: settings.theme, tournament: settings.tournament, betweenText: settings.betweenText,
    match: { ...m, teamA: teamInfo(m.a), teamB: teamInfo(m.b), score: sc, game: (m.games || []).length + 1, need: Math.floor(m.bo / 2) + 1 },
    teams: settings.teams.map(t => ({ ...t, logo: teamLogo(t.id) })),
    display, replay: { ...replay, clip: replay.clipId ? clipPublic(replays.get(replay.clipId)) : null },
    ready: clipPublic(replays.get(ready) || replays.latest()),
    reel: replays.reel().map(clipPublic),
    clips: replays.clips.slice(-30).reverse().map(clipPublic),
    gsi: { ...recorder.state, fresh: recorder.state.updated && Date.now() - recorder.state.updated < 30000 },
    adplus: { enabled: settings.mode === "ad", connected: adplus.connected },
    app: { kind: settings.app, ...(connector ? connector.status() : { connected: false, error: null }) },
    scenes: settings.scenes, autoCapture: settings.autoCapture, autoResult: settings.autoResult, replayFolder: settings.replays.folder,
  };
}
function assetsOf(id) { return Object.fromEntries(Object.keys(SLOTS).map(k => [k, themes.asset(id, k)])); }
function clipPublic(c) { return c && { id: c.id, file: c.file, label: c.label, auto: c.auto, inReel: c.inReel, fromEnd: c.fromEnd, at: c.at, url: `/media/${c.id}`, playable: c.browserPlayable }; }

// ------------------------------------------------------------------ automation
let lastPhase = null, firstPhase = true, postTimer = null;
function onPhase(phase) {
  if (!phase || phase === lastPhase) return;
  lastPhase = phase;
  if (firstPhase) { firstPhase = false; return; }          // app started mid-game: don't jump scenes
  if (phase === "draft" && replays.reel().length) { const s = sides(); replays.archive(`${teamInfo(s.radiant)?.name || ""} vs ${teamInfo(s.dire)?.name || ""}`); pushState(); }
  if (!settings.scenes.auto || !connector) return;
  clearTimeout(postTimer);
  if (replay.playing) return;                               // never cut a replay
  if (phase === "draft") switchScene(settings.scenes.draft);
  if (phase === "game") switchScene(settings.scenes.game);
  if (phase === "post") postTimer = setTimeout(() => { setDisplay({ screen: "board", matchId: "latest" }); switchScene(settings.scenes.postgame); }, (settings.scenes.postDelay || 0) * 1000);
}
function switchScene(name) {
  if (!connector || !name) return Promise.resolve();
  return connector.switchScene(name).then(() => log("scene → " + name)).catch(e => log(`scene "${name}": ${e.message}`));
}
function onHighlight(hl) {
  broadcast("highlight", hl);
  if (!settings.autoCapture || !connector) return;
  pendingHl = { ...hl, savedAt: Date.now(), fromEnd: Math.min(90000, Date.now() - hl.first + 7000) };
  connector.saveReplay().then(() => log("auto-capture: " + hl.label)).catch(e => { pendingHl = null; log("auto-capture failed: " + e.message + " (replay buffer running?)"); });
}
function onClip(c) {
  if (pendingHl && Date.now() - pendingHl.savedAt < 15000) {
    replays.update(c.id, { label: pendingHl.label, auto: true, inReel: true, fromEnd: pendingHl.fromEnd }); pendingHl = null;
  }
  ready = c.id; pushState();
}

// ------------------------------------------------------------------ actions (panel buttons, Stream Deck / Companion / AutoHotkey)
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const ACTIONS = {
  capture: async () => { if (!connector) throw new Error("no streaming app connected – use your app's own Save Replay hotkey"); await connector.saveReplay(); return "replay buffer saved"; },
  show: async (q) => {
    const id = q.clip || ready || (replays.latest() || {}).id; const c = replays.get(id);
    if (!c) throw new Error("no replay clip yet – save the replay buffer first");
    const sec = q.last === "full" ? null : +(q.last || settings.replays.defaultSeconds);
    Object.assign(replay, { clipId: c.id, fromEnd: sec ? sec * 1000 : null, speed: 1, playing: true, rev: replay.rev + 1, start: replay.start + 1 });
    replays.update(c.id, { inReel: true, fromEnd: sec ? sec * 1000 : null });
    await switchScene(settings.scenes.replay); pushState();
    return `replay ${sec ? "last " + sec + " s" : "whole clip"} of ${c.file}`;
  },
  slower: async () => setSpeed(-1), faster: async () => setSpeed(1), normal: async () => setSpeed(0),
  live: async () => { replay.playing = false; replay.rev++; pushState(); await switchScene(settings.scenes.game); return "back to live"; },
  auto: async () => { settings.scenes.auto = !settings.scenes.auto; saveSettings(); pushState(); return "auto scenes " + (settings.scenes.auto ? "on" : "off"); },
  postgame: async (q) => { setDisplay({ screen: q.screen || "board", player: q.player || null, player2: q.player2 || null, mvp: q.mvp === undefined ? display.mvp : q.mvp || null });
                           if (q.screen !== "off") await switchScene(settings.scenes.postgame); return "post-game → " + (q.screen || "board"); },
  scene: async (q) => { const n = settings.scenes[q.name] || q.name; if (!connector) throw new Error("no streaming app connected"); await switchScene(n); return "scene " + n; },
  between: async () => { await switchScene(settings.scenes.between); return "between games"; },
  archive: async () => { const s = sides(); const r = replays.archive(`${teamInfo(s.radiant)?.name || ""} vs ${teamInfo(s.dire)?.name || ""}`); pushState(); return `archived ${r.moved} clip(s)`; },
};
function setSpeed(d) {
  const i = d === 0 ? 3 : Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(replay.speed) + d));
  replay.speed = SPEEDS[i]; replay.rev++; pushState(); return "speed " + replay.speed + "x";
}
function setDisplay(p) { Object.assign(display, p); display.rev++; pushState(); }

function startConnector() {
  if (connector) connector.stop();
  connector = makeConnector(settings, log);
  if (connector) connector.connect();
}

// ------------------------------------------------------------------ match / series
function recordResult(winner) {         // winner: "a" | "b"
  const m = settings.match; m.games = m.games || [];
  if (m.result) return;
  m.games.push(winner);
  const sc = seriesScore(), need = Math.floor(m.bo / 2) + 1;           // Bo2 can end 1-1
  if (sc.a >= need || sc.b >= need || m.games.length >= m.bo) m.result = sc.a > sc.b ? "a" : sc.b > sc.a ? "b" : "draw";
  saveSettings(); pushState();
  log(`game ${m.games.length} → ${teamInfo(m[winner])?.name} (${sc.a}-${sc.b})${m.result ? " – series over" : ""}`);
}

// ------------------------------------------------------------------ GSI config installer (Windows)
function gsiCfg() {
  return `"Dota Caster Kit"
{
  "uri"           "http://127.0.0.1:${PORT}/gsi"
  "timeout"       "5.0"
  "buffer"        "0.1"
  "throttle"      "0.1"
  "heartbeat"     "10.0"
  "data"
  {
    "provider"    "1"
    "map"         "1"
    "player"      "1"
    "hero"        "1"
    "abilities"   "1"
    "items"       "1"
    "allplayers"  "1"
  }
}
`;
}
function findDotaCfgDir() {
  return new Promise(resolve => {
    if (process.platform !== "win32") return resolve(null);
    execFile("reg", ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], (err, out) => {
      const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out || ""); if (err || !m) return resolve(null);
      const steam = m[1].trim().replace(/\//g, "\\");
      const libs = [steam];
      try { const vdf = fs.readFileSync(path.join(steam, "steamapps", "libraryfolders.vdf"), "utf8");
            for (const x of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(x[1].replace(/\\\\/g, "\\")); } catch {}
      for (const lib of libs) {
        const dir = path.join(lib, "steamapps", "common", "dota 2 beta", "game", "dota", "cfg");
        if (fs.existsSync(dir)) return resolve(path.join(dir, "gamestate_integration"));
      }
      resolve(null);
    });
  });
}

// ------------------------------------------------------------------ HTTP
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const json = (res, o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
function serveFile(res, base, rel) {
  const f = path.normalize(path.join(base, rel));
  if (!f.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.end();
  const u = new URL(req.url, "http://x"), p = decodeURIComponent(u.pathname), q = Object.fromEntries(u.searchParams);
  try {
    // --- Dota GSI
    if (req.method === "POST" && (p === "/gsi" || p === "/")) {
      const b = await body(req); res.end("ok");
      try { recorder.onGsi(JSON.parse(b)); } catch {}
      if (Date.now() - (server.lastGsiPush || 0) > 1000) { server.lastGsiPush = Date.now(); broadcast("gsi", publicState().gsi); }
      return;
    }
    // --- live updates
    if (p === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res); req.on("close", () => clients.delete(res));
      return;
    }
    if (p === "/api/state") return json(res, publicState());
    if (p === "/api/log") return json(res, logLines);
    // --- data for overlays
    if (p === "/api/match") {
      const m = q.id === "live" ? recorder.livePlayers() : recorder.getMatch(q.id || "latest");
      if (m && !m.teams) { const s = sides(); m.teams = { radiant: teamInfo(s.radiant), dire: teamInfo(s.dire) }; }
      if (m && settings.mode === "ad" && m.players && m.players.some(x => !x.drafted)) adplus.attach(m.players);
      return json(res, m || null);
    }
    if (p === "/api/matches") return json(res, recorder.listMatches().map(m => ({ matchId: m.matchId, endedAt: m.endedAt, winTeam: m.winTeam, teams: m.teams, mvp: m.mvp })));
    if (p === "/api/draft") {         // AD mode: AD+ picks, names from GSI when AD+ has none
      const rows = ((adplus.picks || {}).players || []).map((r, i) => ({ index: i, team: i < 5 ? "radiant" : "dire", name: r.playerName || null,
        hero: (/heroes\/([a-z0-9_]+)\./i.exec(r.portraitPath || "") || [])[1] || null,
        heroName: heroName((/heroes\/([a-z0-9_]+)\./i.exec(r.portraitPath || "") || [])[1] || null),
        picks: (r.picks || []).map(a => a && a.name ? { name: a.name, displayName: a.displayName } : null) }));
      // AD+ often has no names while spectating: take them from Dota (same hero, else same seat – lobby seats = draft order)
      const seen = recorder.seen || [];
      for (const r of rows) { if (r.name) continue; const g = seen.find(p => p.hero && p.hero === r.hero) || seen[r.index]; if (g) r.name = g.name; }
      const s = sides();
      return json(res, { connected: adplus.connected, players: rows, teams: { radiant: teamInfo(s.radiant), dire: teamInfo(s.dire) } });
    }
    if (p === "/api/leaders") return json(res, recorder.leaders());
    if (p.startsWith("/media/")) return replays.serve(req, res, p.slice(7));
    // --- actions (GET or POST – GET works from a Stream Deck "website" button / Companion / curl)
    if (p.startsWith("/api/action/")) {
      const name = p.slice(12), fn = ACTIONS[name];
      if (!fn) return json(res, { ok: false, error: "unknown action " + name }, 404);
      const b = req.method === "POST" ? await body(req) : null;
      let args = { ...q }; try { if (b && b.length) args = { ...args, ...JSON.parse(String(b)) }; } catch {}
      try { const msg = await fn(args); log("action " + name + ": " + msg); return json(res, { ok: true, message: msg }); }
      catch (e) { log(`action ${name}: ${e.message}`); return json(res, { ok: false, error: e.message }, 400); }
    }
    if (p === "/api/replay/ended" && req.method === "POST") {
      if (replay.playing) { replay.playing = false; replay.rev++; pushState(); await switchScene(settings.scenes.game); }
      return json(res, { ok: true });
    }
    // --- clips
    if (p === "/api/clip" && req.method === "POST") {
      const b = JSON.parse(String(await body(req)) || "{}");
      if (b.remove) replays.remove(b.id); else replays.update(b.id, b.patch || {});
      pushState(); return json(res, { ok: true });
    }
    // --- settings / match
    if (p === "/api/settings" && req.method === "GET") return json(res, { settings, slots: SLOTS, teamLogo: TEAM_LOGO, themes: themes.list(), gsiPort: PORT });
    if (p === "/api/settings" && req.method === "POST") {
      const patch = JSON.parse(String(await body(req)) || "{}");
      const before = JSON.stringify([settings.app, settings.obs, settings.streamlabs]);
      settings = merge(settings, patch);
      if (patch.teams) settings.teams = patch.teams;
      if (patch.themeVars) settings.themeVars = patch.themeVars;
      if (patch.match && patch.match.games) settings.match.games = patch.match.games;
      saveSettings();
      if (patch.replays) replays.setFolder(settings.replays.folder);
      if (patch.mode || patch.adplusUrl) { adplus.url = settings.adplusUrl; settings.mode === "ad" ? adplus.start() : adplus.stop(); }
      if (patch.theme || patch.themeVars) bumpTheme();
      if (before !== JSON.stringify([settings.app, settings.obs, settings.streamlabs])) startConnector();
      pushState(); return json(res, { ok: true, settings });
    }
    if (p === "/api/match/result" && req.method === "POST") { const b = JSON.parse(String(await body(req))); recordResult(b.winner); return json(res, { ok: true }); }
    if (p === "/api/match/undo" && req.method === "POST") { const m = settings.match; (m.games || []).pop(); m.result = null; saveSettings(); pushState(); return json(res, { ok: true }); }
    if (p === "/api/match/new" && req.method === "POST") {
      const b = JSON.parse(String(await body(req)) || "{}");
      settings.match = { ...settings.match, ...b, games: [], result: null }; saveSettings(); pushState(); return json(res, { ok: true });
    }
    // --- streaming app helpers
    if (p === "/api/app/scenes") return json(res, connector ? await connector.scenes() : []);
    if (p === "/api/app/replay-folder") return json(res, { folder: connector ? await connector.replayFolder() : null });
    // --- GSI config
    if (p === "/api/gsi/cfg") { res.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="gamestate_integration_dck.cfg"' }); return res.end(gsiCfg()); }
    if (p === "/api/gsi/install" && req.method === "POST") {
      const dir = await findDotaCfgDir();
      if (!dir) return json(res, { ok: false, error: "Dota 2 folder not found automatically – download the file and copy it yourself" });
      fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "gamestate_integration_dck.cfg"), gsiCfg());
      log("GSI config installed in " + dir); return json(res, { ok: true, dir });
    }
    // --- themes & uploads
    if (p === "/theme.css") { res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" }); return res.end(themes.css(q.theme || settings.theme, settings.themeVars)); }
    if (p === "/api/upload" && req.method === "POST") {
      const r = themes.saveUpload(q.theme || settings.theme, q.slot, await body(req)); if (r.ok) { bumpTheme(); pushState(); }
      return json(res, r, r.ok ? 200 : 400);
    }
    if (p === "/api/upload" && req.method === "DELETE") { themes.removeUpload(q.theme || settings.theme, q.slot); bumpTheme(); pushState(); return json(res, { ok: true }); }
    if (p.startsWith("/uploads/")) return serveFile(res, path.join(DATA, "uploads"), p.slice(9));
    if (p.startsWith("/themes/")) return serveFile(res, path.join(ROOT, "themes"), p.slice(8));
    if (p === "/api/assets") return json(res, assetsOf(q.theme || settings.theme));
    if (p === "/api/heroname") return json(res, { name: heroName(q.npc) });
    // --- pages
    if (p === "/" || p === "/panel") return serveFile(res, path.join(ROOT, "public"), "panel/index.html");
    return serveFile(res, path.join(ROOT, "public"), p.slice(1));
  } catch (e) { log("error " + p + ": " + e.message); if (!res.headersSent) json(res, { ok: false, error: e.message }, 500); }
});

setInterval(() => broadcast("ping", Date.now()), 15000);
server.listen(PORT, "127.0.0.1", () => {
  log(`Dota Caster Kit ${VERSION} – control panel: http://127.0.0.1:${PORT}/`);
  log(`mode ${settings.mode.toUpperCase()} · theme ${settings.theme} · streaming app: ${settings.app}`);
});
