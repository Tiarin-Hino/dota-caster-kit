#!/usr/bin/env node
// Fake Dota 2 spectator feed – try the kit without Dota running.
//   node tools/fake-gsi.js            → draft (10 s) → game with a triple kill and a teamfight → post-game
//   node tools/fake-gsi.js --fast     → same, 4× faster
//   DCK_PORT=58900 (default)
const http = require("http");
const PORT = +(process.env.DCK_PORT || 58900);
const FAST = process.argv.includes("--fast") ? 4 : 1;
const send = body => new Promise(r => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path: "/gsi", method: "POST", headers: { "Content-Type": "application/json" } }, res => { res.resume(); r(); });
  req.on("error", e => { console.error("server not running? " + e.message); process.exit(1); }); req.end(JSON.stringify(body));
});
const sleep = ms => new Promise(r => setTimeout(r, ms / FAST));

const HEROES = ["juggernaut", "crystal_maiden", "pudge", "lina", "earthshaker", "phantom_assassin", "lion", "tidehunter", "zuus", "sniper"];
const NAMES = ["Nightfall", "Mossy", "Kettle", "Brightwing", "Owl", "Vex", "Pebble", "Grimlock", "Sunny", "Quill"];
const ITEMS = ["item_power_treads", "item_black_king_bar", "item_blink", "item_magic_wand", "item_manta", "item_desolator", "item_glimmer_cape", "item_force_staff", "item_aghanims_shard", "item_butterfly"];
const ABIL = { juggernaut: ["juggernaut_blade_fury", "juggernaut_healing_ward", "juggernaut_blade_dance", "juggernaut_omni_slash"], pudge: ["pudge_meat_hook", "pudge_rot", "pudge_flesh_heap", "pudge_dismember"] };
const MATCH = String(7000000000 + Math.floor(Math.random() * 1e6));

const players = HEROES.map((h, i) => ({ h, name: NAMES[i], team: i < 5 ? "team2" : "team3", slot: i, k: 0, d: 0, a: 0, nw: 600, lh: 0 }));

function state(gs, clock, win) {
  const j = { provider: { name: "Dota 2", appid: 570 }, map: { matchid: MATCH, game_state: gs, clock_time: clock, win_team: win || "none",
    radiant_score: players.slice(0, 5).reduce((a, p) => a + p.k, 0), dire_score: players.slice(5).reduce((a, p) => a + p.k, 0) },
    player: { team2: {}, team3: {} }, hero: { team2: {}, team3: {} }, items: { team2: {}, team3: {} }, abilities: { team2: {}, team3: {} } };
  for (const p of players) {
    const key = "player" + p.slot, m = Math.max(1, clock / 60);
    j.player[p.team][key] = { name: p.name, accountid: String(100 + p.slot), kills: p.k, deaths: p.d, assists: p.a, last_hits: p.lh, denies: Math.round(p.lh / 12),
      gpm: Math.round(p.nw / m), xpm: Math.round(p.nw / m * 1.1), net_worth: p.nw, hero_damage: p.k * 2100 + p.a * 700 + Math.round(clock * 3),
      tower_damage: p.slot % 5 === 0 ? Math.round(clock * 2) : Math.round(clock * 0.3), hero_healing: p.h === "crystal_maiden" ? 2400 : 0,
      wards_placed: p.slot % 5 >= 3 ? Math.round(clock / 120) : 0, camps_stacked: p.slot % 5 === 4 ? 4 : 0, commands_issued: Math.round(clock * 2.6), kill_streak: 0 };
    j.hero[p.team][key] = { id: p.slot + 1, name: "npc_dota_hero_" + p.h, level: Math.min(30, 1 + Math.floor(clock / 100)) };
    const it = {}; for (let s = 0; s < 6; s++) it["slot" + s] = { name: clock > s * 300 ? ITEMS[(p.slot + s) % ITEMS.length] : "empty" };
    it.neutral0 = { name: clock > 1200 ? "item_mysterious_hat" : "empty" }; j.items[p.team][key] = it;
    const ab = ABIL[p.h] || [p.h + "_a", p.h + "_b", p.h + "_c", p.h + "_ult"];
    j.abilities[p.team][key] = Object.fromEntries(ab.map((n, i) => ["ability" + i, { name: n, level: 1, ultimate: i === 3 }]));
  }
  return j;
}

(async () => {
  console.log(`fake match ${MATCH} → http://127.0.0.1:${PORT}/gsi`);
  for (let t = 0; t < 10; t++) { await send(state(t < 6 ? "DOTA_GAMERULES_STATE_HERO_SELECTION" : "DOTA_GAMERULES_STATE_STRATEGY_TIME", -90)); await sleep(1000); }
  await send(state("DOTA_GAMERULES_STATE_PRE_GAME", -60)); await sleep(2000);
  let clock = 0;
  const tick = async (sec = 30) => { clock += sec; for (const p of players) { const lead = p.team === "team3" ? (clock < 1100 ? 1.25 : 0.85) : (clock < 1100 ? 0.9 : 1.2);
      p.nw += Math.round(sec * (p.slot % 5 < 2 ? 9 : 5) * lead * (0.9 + (p.slot % 3) * 0.08)); p.lh += Math.round(sec / (p.slot % 5 < 2 ? 5 : 15)); } await send(state("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", clock)); await sleep(1000); };
  for (let i = 0; i < 8; i++) await tick();
  console.log("triple kill by " + players[0].name);
  for (let k = 0; k < 3; k++) { players[0].k++; players[5 + k].d++; players[1].a++; await tick(2); }
  for (let i = 0; i < 12; i++) await tick();           // 8+ s of quiet → highlight fires
  console.log("teamfight");
  for (const [w, l] of [[6, 2], [5, 3], [2, 7], [9, 4], [1, 8]]) { players[w].k++; players[l].d++; players[(w + 1) % 10].a++; await tick(2); }
  for (let i = 0; i < 30; i++) await tick(60);
  for (let i = 0; i < 6; i++) { players[i % 5].k++; players[5 + (i % 5)].d++; }
  await send(state("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", clock, "radiant")); await sleep(500);
  await send(state("DOTA_GAMERULES_STATE_POST_GAME", clock, "radiant"));
  console.log("game over – radiant wins");
})();
