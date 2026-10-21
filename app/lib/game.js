// Game state from Dota 2 Game State Integration (GSI).
// Spectating / casting (and replays) deliver all 10 players; while playing Dota only reports yourself.
//
// - parsePlayers(): one flat object per player
// - Recorder: keeps the live game, writes a match file when the game ends, detects highlights (multi-kills, fights)
//
// Hard-won facts (from live use at Rumble in the Jungle VI):
// - Dota sends 2-3 game states back to back (HERO_SELECTION→STRATEGY_TIME, WAIT_FOR_MAP→PRE_GAME→GAME_IN_PROGRESS).
// - In ABILITY DRAFT, GSI's per-player ability lists are shuffled between players while spectating. Never show them as
//   a player's draft – use Ability Draft Plus (adplus.js), matched by hero.
const fs = require("fs");
const path = require("path");
const { heroName } = require("./heroes");

const num = v => (typeof v === "number" && isFinite(v) ? v : (typeof v === "string" && v !== "" && isFinite(+v) ? +v : null));
const sum = (...v) => v.reduce((a, b) => a + (num(b) || 0), 0);

function parsePlayers(j) {
  const out = [];
  for (const [teamKey, team] of [["team2", "radiant"], ["team3", "dire"]]) {
    const pb = j.player && j.player[teamKey];
    if (!pb || typeof pb !== "object") continue;
    for (const [slotKey, p] of Object.entries(pb)) {
      const slot = +slotKey.replace("player", "");
      const h = (j.hero && j.hero[teamKey] && j.hero[teamKey][slotKey]) || {};
      const it = (j.items && j.items[teamKey] && j.items[teamKey][slotKey]) || {};
      const ab = (j.abilities && j.abilities[teamKey] && j.abilities[teamKey][slotKey]) || {};
      const items = [];
      for (let i = 0; i < 6; i++) { const s = it["slot" + i]; items.push(s && s.name && s.name !== "empty" ? s.name : null); }
      const neutral = it.neutral0 && it.neutral0.name !== "empty" ? it.neutral0.name : null;
      const abilities = Object.values(ab).filter(a => a && a.name && !a.name.startsWith("plus_") && !a.name.startsWith("special_bonus") && a.name !== "generic_hidden")
        .map(a => ({ name: a.name, level: num(a.level), ultimate: !!a.ultimate }));
      const hero = h.name ? h.name.replace("npc_dota_hero_", "") : null;
      out.push({
        slot, team, name: p.name || null, accountId: p.accountid || p.steamid || null,
        hero, heroName: heroName(hero), heroId: num(h.id), level: num(h.level),
        kills: num(p.kills), deaths: num(p.deaths), assists: num(p.assists),
        lastHits: num(p.last_hits), denies: num(p.denies),
        gpm: num(p.gpm), xpm: num(p.xpm), netWorth: num(p.net_worth),
        heroDamage: num(p.hero_damage), towerDamage: num(p.tower_damage), heroHealing: num(p.hero_healing),
        damageTaken: sum(p.damage_received_post_reduction_physical, p.damage_received_post_reduction_magical, p.damage_received_post_reduction_pure),
        wardsPlaced: num(p.wards_placed), campsStacked: num(p.camps_stacked), runes: num(p.runes_activated),
        commands: num(p.commands_issued), killStreak: num(p.kill_streak),
        items, neutral, gsiAbilities: abilities,
      });
    }
  }
  return out.sort((a, b) => (a.team === b.team ? a.slot - b.slot : a.team === "radiant" ? -1 : 1));
}

function derive(p, clock) {
  const min = Math.max(1, (clock || 0) / 60);
  p.kda = p.deaths ? +(((p.kills || 0) + (p.assists || 0)) / p.deaths).toFixed(2) : (p.kills || 0) + (p.assists || 0);
  p.apm = p.commands != null ? Math.round(p.commands / min) : null;
  return p;
}

// Broadcast-style MVP score, normalised inside the match; like Valve, the MVP comes from the winning team.
const MVP_WEIGHTS = { kills: 1.2, assists: 0.8, deaths: -1.0, netWorth: 1.0, heroDamage: 1.3, towerDamage: 0.6, heroHealing: 0.5, wardsPlaced: 0.3, campsStacked: 0.2 };
function rankMvp(players, winTeam) {
  const max = {};
  for (const k of Object.keys(MVP_WEIGHTS)) max[k] = Math.max(1, ...players.map(p => p[k] || 0));
  for (const p of players) {
    let s = 0;
    for (const [k, w] of Object.entries(MVP_WEIGHTS)) s += w * ((p[k] || 0) / max[k]);
    if (winTeam && p.team === winTeam) s *= 1.25;
    p.mvpScore = +s.toFixed(3);
  }
  return [...players].sort((a, b) => ((b.team === winTeam) - (a.team === winTeam)) || b.mvpScore - a.mvpScore);
}

const MULTI = { 3: "Triple kill", 4: "Ultra kill", 5: "Rampage" };

class Recorder {
  constructor({ dataDir, log, onHighlight, onPhase, onMatch, draftedFor }) {
    this.dir = path.join(dataDir, "matches");
    fs.mkdirSync(this.dir, { recursive: true });
    this.log = log; this.onHighlight = onHighlight; this.onPhase = onPhase; this.onMatch = onMatch;
    this.draftedFor = draftedFor;     // (players) => attaches .drafted (AD mode) – provided by the server
    this.state = { connected: false, gameState: null, winTeam: null, matchId: null, clock: null, radiantScore: null, direScore: null,
                   updated: null, changed: null, spectating: false };
    this.live = null;                 // { matchId, clock, players, timeline }
    this.kc = null;                   // kill tracking for highlights
    this.hlSeq = 0;
    setInterval(() => this.checkFight(), 1000);
  }

  onGsi(j) {
    const map = j.map || {};
    const gs = map.game_state || null;
    const win = map.win_team && map.win_team !== "none" ? map.win_team : null;
    const mid = map.matchid || null;
    const st = this.state;
    st.connected = true; st.updated = Date.now();
    st.clock = map.clock_time ?? null; st.radiantScore = map.radiant_score ?? null; st.direScore = map.dire_score ?? null;
    st.spectating = !!(j.player && (j.player.team2 || j.player.team3));
    if (j.player && (j.player.team2 || j.player.team3)) this.seen = parsePlayers(j);
    if (j.draft && typeof j.draft === "object") this.draft = parseDraft(j.draft, gs);   // names/heroes in any phase (draft board)
    const inGame = /GAME_IN_PROGRESS|PRE_GAME|POST_GAME/.test(gs || "");
    if (inGame) {
      const players = parsePlayers(j);
      if (players.length) {
        if (!this.live || this.live.matchId !== mid) this.live = { matchId: mid, clock: 0, players: [], timeline: [] };
        this.live.players = players; this.live.clock = map.clock_time || this.live.clock;
        const t = this.live.timeline, last = t[t.length - 1];
        if (map.clock_time > 0 && (!last || map.clock_time - last.t >= 30)) {
          const nw = team => players.filter(p => p.team === team).reduce((a, p) => a + (p.netWorth || 0), 0);
          t.push({ t: map.clock_time, radiantNw: nw("radiant"), direNw: nw("dire"), rk: map.radiant_score, dk: map.dire_score });
        }
        if (gs === "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS") this.trackKills(players, mid, map.clock_time ?? null);
      }
    }
    if (gs && (gs !== st.gameState || win !== st.winTeam || mid !== st.matchId)) {
      const prev = st.gameState, ended = win && !st.winTeam;
      st.gameState = gs; st.winTeam = win; st.matchId = mid; st.changed = Date.now();
      this.log(`game state ${(prev || "-").replace("DOTA_GAMERULES_STATE_", "")} → ${gs.replace("DOTA_GAMERULES_STATE_", "")}${win ? " (winner: " + win + ")" : ""}`);
      this.onPhase && this.onPhase(phaseOf(gs), gs);
      if (ended || gs === "DOTA_GAMERULES_STATE_POST_GAME") setTimeout(() => this.finalize(win || st.winTeam), 1500);
    }
  }

  livePlayers() {
    if (!this.live) return null;
    const players = this.live.players.map(p => derive({ ...p }, this.live.clock));
    this.draftedFor && this.draftedFor(players);
    return { matchId: this.live.matchId, clock: this.live.clock, players, timeline: this.live.timeline, live: true };
  }

  finalize(win) {
    if (!this.live || !this.live.players.length) return;
    const lp = this.livePlayers();
    const ranked = rankMvp(lp.players, win);
    const file = `${this.live.matchId || Date.now()}`;
    if (this.lastFinal === file) return; this.lastFinal = file;
    const match = { matchId: this.live.matchId, endedAt: Date.now(), duration: this.live.clock, winTeam: win,
      score: { radiant: this.state.radiantScore, dire: this.state.direScore },
      mvp: ranked[0] && ranked[0].name, players: lp.players, timeline: this.live.timeline };
    this.onMatch && this.onMatch(match);           // server adds team info (which team was radiant)
    writeJson(path.join(this.dir, `${file}.json`), match);
    this.log(`match ${match.matchId} saved – ${win || "?"} won, MVP ${match.mvp}`);
  }

  // ---------------------------------------------------------------- highlights
  // A fight = kills with no more than ~8 s between them. When it is over it becomes a highlight if one player got 3+
  // kills or 4+ heroes died in total.
  trackKills(players, mid, clock) {
    if (!this.kc || this.kc.matchId !== mid) this.kc = { matchId: mid, kills: {}, events: [] };
    const now = Date.now();
    for (const p of players) {
      if (p.kills == null) continue;
      const key = p.team + p.slot, prev = this.kc.kills[key];
      this.kc.kills[key] = p.kills;
      if (prev == null) continue;
      if (p.kills < prev) { this.kc.events = []; continue; }        // replay rewound
      for (let i = prev; i < p.kills && i < prev + 6; i++)
        this.kc.events.push({ key, team: p.team, hero: p.hero, name: p.name, clock, real: now });
    }
  }
  checkFight() {
    const ev = this.kc && this.kc.events; if (!ev || !ev.length) return;
    const last = ev[ev.length - 1], clock = this.state.clock;
    const quiet = (clock != null && last.clock != null && clock - last.clock >= 8) || Date.now() - last.real >= 8000;
    if (!quiet) return;
    this.kc.events = [];
    const per = {}; for (const e of ev) per[e.key] = (per[e.key] || 0) + 1;
    const [topKey, topN] = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
    const top = ev.find(e => e.key === topKey);
    let label = null;
    if (topN >= 3) label = `${MULTI[Math.min(5, topN)]} · ${top.name || heroName(top.hero)}`;
    else if (ev.length >= 4) label = `Teamfight · ${ev.length} kills`;
    if (!label) return;
    const hl = { id: `${Date.now()}-${++this.hlSeq}`, label, kills: ev.length, hero: top.hero, first: ev[0].real, last: last.real, matchId: this.kc.matchId };
    this.log("highlight: " + label);
    this.onHighlight && this.onHighlight(hl);
  }

  // ---------------------------------------------------------------- recorded matches
  listMatches() {
    return fs.readdirSync(this.dir).filter(f => f.endsWith(".json")).map(f => readJson(path.join(this.dir, f)))
      .filter(Boolean).sort((a, b) => b.endedAt - a.endedAt);
  }
  getMatch(id) {
    if (!id || id === "latest") return this.listMatches()[0] || null;
    return readJson(path.join(this.dir, `${String(id).replace(/[^\w-]/g, "")}.json`));
  }
  leaders() {
    const agg = {}; const ms = this.listMatches();
    for (const m of ms) for (const p of m.players) {
      const key = p.accountId || p.name; if (!key) continue;
      const a = agg[key] = agg[key] || { name: p.name, games: 0, wins: 0, minutes: 0, kills: 0, deaths: 0, assists: 0, gpmSum: 0,
        wardsPlaced: 0, campsStacked: 0, heroDamage: 0, commands: 0, heroes: {} };
      a.name = p.name || a.name; a.games++; if (p.team === m.winTeam) a.wins++;
      a.minutes += (m.duration || 0) / 60;
      for (const k of ["kills", "deaths", "assists", "wardsPlaced", "campsStacked", "heroDamage", "commands"]) a[k] += p[k] || 0;
      a.gpmSum += p.gpm || 0;
      if (p.hero) a.heroes[p.hero] = (a.heroes[p.hero] || 0) + 1;
    }
    const players = Object.values(agg).map(a => ({ ...a, avgGpm: Math.round(a.gpmSum / a.games),
      kda: +((a.kills + a.assists) / Math.max(1, a.deaths)).toFixed(2), apm: a.minutes ? Math.round(a.commands / a.minutes) : null }));
    return { games: ms.length, players };
  }
}

// Captains Mode / hero draft from GSI "draft" block (spectating). Keys look like team2.pick0_class / ban0_class.
function parseDraft(d, gs) {
  const team = t => {
    const o = { picks: [], bans: [], bonusTime: num(t && t.bonus_time) };
    for (const [k, v] of Object.entries(t || {})) {
      const m = /^(pick|ban)(\d+)_class$/.exec(k); if (!m || !v || v === "") continue;
      const hero = String(v).replace("npc_dota_hero_", "");
      o[m[1] === "pick" ? "picks" : "bans"][+m[2]] = { hero, heroName: heroName(hero) };
    }
    return o;
  };
  return { active: d.activeteam === 2 ? "radiant" : d.activeteam === 3 ? "dire" : null, isPick: !!d.pick,
           timeLeft: num(d.activeteam_time_remaining), radiant: team(d.team2), dire: team(d.team3), state: gs, at: Date.now() };
}

function phaseOf(gs) {
  if (/HERO_SELECTION|STRATEGY_TIME|TEAM_SHOWCASE/.test(gs)) return "draft";
  if (/WAIT_FOR_MAP|PRE_GAME|GAME_IN_PROGRESS/.test(gs)) return "game";
  if (/POST_GAME/.test(gs)) return "post";
  return null;
}

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } }
function writeJson(f, o) { fs.writeFileSync(f + ".tmp", JSON.stringify(o, null, 1)); fs.renameSync(f + ".tmp", f); }

module.exports = { Recorder, parsePlayers, parseDraft, rankMvp, phaseOf, readJson, writeJson };
