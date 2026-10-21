// Ability Draft Plus (AD+) connector – only used in Ability Draft mode.
// AD+ is a separate desktop app that scans the AD draft; its local server (default http://127.0.0.1:58873) pushes
// the drafted picks over SSE (/picks/events). We match AD+ rows to GSI players BY HERO (AD+ often has no player names
// while spectating), then by name. Picks AD+ missed are filled from the one GSI ability list that contains all of the
// player's known picks (GSI lists are shuffled between players, so they are never used on their own).
const http = require("http");

const heroOfRow = r => { const m = /heroes\/([a-z0-9_]+)\./i.exec(r.portraitPath || ""); return m ? m[1].toLowerCase() : null; };
const norm = s => (s || "").toLowerCase().replace(/\s+/g, "");

class AdPlus {
  constructor({ url, log }) {
    this.url = url; this.log = log;
    this.picks = null; this.lastDraft = null; this.connected = false; this.req = null;
  }
  start() {
    this.stop();
    let u; try { u = new URL("/picks/events", this.url); } catch { return; }
    this.req = http.get(u, res => {
      this.connected = res.statusCode === 200;
      let buf = "";
      res.on("data", c => {
        buf += c; let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          try { const m = JSON.parse(line.slice(5)); if (m && m.payload) { this.picks = m.payload; if ((this.picks.players || []).some(heroOfRow)) this.lastDraft = this.picks; } } catch {}
        }
      });
      res.on("end", () => { this.connected = false; this.retry(5000); });
    });
    this.req.on("error", () => { this.connected = false; this.retry(10000); });
  }
  retry(ms) { clearTimeout(this.t); this.t = setTimeout(() => this.start(), ms); }
  stop() { clearTimeout(this.t); if (this.req) { this.req.removeAllListeners("error"); this.req.on("error", () => {}); this.req.destroy(); } this.req = null; }

  // attaches p.drafted = [std, std, std, ult] (null = unknown) to every player it can match
  attach(players) {
    const rows = ((this.lastDraft || this.picks) || {}).players || [];
    const used = new Set(); let matched = 0;
    for (const p of players) {
      let r = rows.find(x => !used.has(x) && p.hero && heroOfRow(x) === p.hero);
      if (!r && p.name) r = rows.find(x => !used.has(x) && x.playerName && norm(x.playerName) === norm(p.name));
      if (!r) { p.drafted = null; continue; }
      used.add(r); matched++;
      p.drafted = (r.picks || []).map(a => (a && a.name ? { name: a.name, displayName: a.displayName, icon: a.iconPath } : null));
      while (p.drafted.length < 4) p.drafted.push(null);
    }
    if (matched < 3) { for (const p of players) p.drafted = null; return; }     // stale snapshot from another game
    const lists = players.map(p => p.gsiAbilities || []);
    for (const p of players) {
      const d = p.drafted; if (!d || d.every(Boolean)) continue;
      const known = d.filter(Boolean).map(a => a.name); if (known.length < 2) continue;
      const cand = lists.filter(l => known.every(k => l.some(a => a.name === k)));
      if (cand.length !== 1) continue;
      const spare = cand[0].filter(a => !known.includes(a.name));
      let std = spare.filter(a => !a.ultimate);
      const needStd = [0, 1, 2].filter(i => !d[i]).length;
      if (std.length > needStd && p.hero) std = std.filter(a => !a.name.startsWith(p.hero + "_"));
      const ult = spare.filter(a => a.ultimate);
      const mk = a => ({ name: a.name, displayName: a.name, icon: null });
      if (!d[3] && ult.length === 1) d[3] = mk(ult[0]);
      if (needStd && std.length === needStd) { let k = 0; for (let i = 0; i < 3; i++) if (!d[i]) d[i] = mk(std[k++]); }
    }
  }
}

module.exports = { AdPlus };
