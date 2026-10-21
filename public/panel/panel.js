// Control panel. Talks to the local server only (same origin).
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const api = (u, o) => fetch(u, { cache: "no-store", ...o }).then(r => r.json());
const post = (u, b) => api(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
const ORIGIN = location.origin;
let st = null, cfg = null, match = null;

function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : ""); clearTimeout(t._h); t._h = setTimeout(() => t.className = "toast", 2600); }
async function act(name, q = "") {
  const r = await api(`/api/action/${name}${q ? "?" + q : ""}`).catch(e => ({ ok: false, error: e.message }));
  toast(r.ok ? r.message : r.error, !r.ok); return r;
}
async function save(patch, quiet) {
  const r = await post("/api/settings", patch);
  if (r.ok) { cfg.settings = r.settings; if (st) { st.mode = r.settings.mode; st.theme = r.settings.theme; } render(); if (!quiet) toast("Saved"); }
  else toast(r.error || "Could not save", true);
}
const debounce = (fn, ms = 500) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

// ------------------------------------------------------------------ tabs
function showTab(id) {
  $$("nav a").forEach(a => a.classList.toggle("on", a.dataset.tab === id));
  $$("main section").forEach(s => s.classList.toggle("on", s.dataset.tab === id));
  store.set("dck-tab", id); fitPreviews();
  if (id === "deck") loadLog();
}
$$("nav a").forEach(a => a.onclick = () => showTab(a.dataset.tab));

// ------------------------------------------------------------------ previews scale to their box
function fitPreviews() {
  for (const f of $$(".preview iframe, .theme .pv iframe")) { const w = f.parentElement.clientWidth; if (w) f.style.transform = `scale(${w / 1920})`; }
}
new ResizeObserver(fitPreviews).observe(document.body);
$$("#pvSel button").forEach(b => b.onclick = () => { $$("#pvSel button").forEach(x => x.classList.toggle("on", x === b)); $("#pv").src = `/overlays/${b.dataset.pv}.html`; });

// ------------------------------------------------------------------ live state
function connect() {
  const es = new EventSource("/api/events");
  es.addEventListener("state", e => { st = JSON.parse(e.data); render(); });
  es.addEventListener("gsi", e => { if (st) { st.gsi = JSON.parse(e.data); renderStatus(); renderGame(); } });
  es.addEventListener("log", e => { const l = $("#log"); if (l) { l.textContent += JSON.parse(e.data) + "\n"; l.scrollTop = l.scrollHeight; } });
  es.onerror = () => { es.close(); renderStatus(true); setTimeout(connect, 2000); };
}

function render() {
  if (!st || !cfg) return;
  document.body.classList.toggle("ad", st.mode === "ad");
  $("#ver").textContent = "v" + st.version;
  renderStatus(); renderGame(); renderLive(); renderMatch(); renderClips(); renderDesign(); renderSetup();
}

function renderStatus(down) {
  if (down) { $("#status").innerHTML = `<div class="chip"><span class="dot"></span>App not running<b>restart it</b></div>`; return; }
  const g = st.gsi, app = st.app;
  const chips = [
    [g.fresh ? "ok" : g.connected ? "mid" : "", "Dota 2", g.fresh ? (g.spectating ? "live" : "playing") : g.connected ? "idle" : "not connected"],
    [app.kind === "none" ? "off" : app.connected ? "ok" : "", app.kind === "streamlabs" ? "Streamlabs" : "OBS", app.kind === "none" ? "not used" : app.connected ? "connected" : (app.error || "connecting…")],
  ];
  if (st.mode === "ad") chips.push([st.adplus.connected ? "ok" : "", "AD+", st.adplus.connected ? "connected" : "not found"]);
  chips.push(["off", "Mode", st.mode === "ad" ? "Ability Draft" : "All Pick"]);
  $("#status").innerHTML = chips.map(([c, l, v]) => `<div class="chip"><span class="dot ${c}"></span>${l}<b title="${esc(v)}">${esc(String(v).slice(0, 18))}</b></div>`).join("");
  $("#gsiDot").className = "dot " + (g.fresh ? "ok" : g.connected ? "mid" : "");
  $("#appDot").className = "dot " + (app.kind === "none" ? "off" : app.connected ? "ok" : "");
}
function renderGame() {
  const g = st.gsi; if (!g.gameState) return;
  const clock = g.clock == null ? "" : ` · ${Math.floor(Math.max(0, g.clock) / 60)}:${String(Math.max(0, g.clock) % 60).padStart(2, "0")}`;
  $("#gameLine").textContent = `${g.gameState.replace("DOTA_GAMERULES_STATE_", "").replace(/_/g, " ").toLowerCase()}${clock}${g.radiantScore != null ? ` · ${g.radiantScore} : ${g.direScore}` : ""}${g.winTeam ? " · " + g.winTeam + " won" : ""}`;
}

// ------------------------------------------------------------------ LIVE tab
const SCENES = [["draft", "Draft"], ["game", "Game"], ["postgame", "Post-game"], ["replay", "Replay"], ["between", "Between games"]];
function renderLive() {
  $("#autoScenes").checked = st.scenes.auto; $("#autoCapture").checked = st.autoCapture;
  const can = st.app.kind !== "none";
  $("#sceneBtns").innerHTML = can ? SCENES.map(([k, l]) => `<button data-scene="${k}" title="${esc(st.scenes[k])}">${l}</button>`).join("")
    : `<p class="hint">No streaming app connected – switch scenes in your app. Connect one in <a onclick="showTab('setup')">Setup</a> for automatic scenes.</p>`;
  $$("#sceneBtns button").forEach(b => b.onclick = () => act("scene", "name=" + b.dataset.scene));
  const r = st.ready;
  $("#ready").innerHTML = r ? `Latest clip: <b>${esc(r.label || r.file)}</b> · ${new Date(r.at).toLocaleTimeString()}${r.playable ? "" : ` · <span style="color:var(--warn)">MKV – set MP4</span>`}${st.replay.playing ? " · <b style='color:var(--acc)'>playing " + st.replay.speed + "×</b>" : ""}`
    : st.replayFolder ? "No clip yet – press Capture (or your app's Save Replay hotkey)" : `Replay folder not set – see <a onclick="showTab('setup')">Setup step 4</a>`;
  $$("#screens button").forEach(b => b.classList.toggle("on", b.dataset.screen === st.display.screen));
  $("#animated").checked = st.display.animated !== false;
  loadMatch();
}
async function loadMatch() {
  if ($("#screens").parentElement.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
  const key = st.gsi.matchId + "|" + st.display.rev + "|" + (st.gsi.gameState || "");
  if (loadMatch.key === key) return; loadMatch.key = key;
  match = await api("/api/match?id=latest");
  const ps = (match && match.players) || [];
  const opt = (sel, val, first) => `${first ? `<option value="">${first}</option>` : ""}${ps.map(p => `<option value="${p.team[0] + p.slot}" ${val === p.team[0] + p.slot ? "selected" : ""}>${esc(p.name || "?")} – ${esc(p.heroName)} (${p.team})</option>`).join("")}`;
  $("#pl1").innerHTML = opt("pl1", st.display.player, "auto (top Radiant)"); $("#pl2").innerHTML = opt("pl2", st.display.player2, "auto (top Dire)");
  $("#standSel").innerHTML = opt("stand", st.display.standout, "auto (best of the losing team)");
  $("#mvpSel").innerHTML = opt("mvp", st.display.mvp, `auto${match && match.mvp ? " (" + esc(match.mvp) + ")" : ""}`);
  $("#matchLine").textContent = match ? `latest game: ${match.matchId || "?"} · ${match.winTeam || "?"} won · ${new Date(match.endedAt).toLocaleTimeString()}` : "no finished game yet – try tools/fake-gsi.js";
}
$$("#screens button").forEach(b => b.onclick = () => showScreen(b.dataset.screen));
const selection = () => ({ player: $("#pl1").value, player2: $("#pl2").value, standout: $("#standSel").value, mvp: $("#mvpSel").value, animated: $("#animated").checked ? "1" : "0" });
function showScreen(screen) { act("postgame", new URLSearchParams({ ...selection(), screen })); }
// changing a selection only stores it – the screen changes when you click a screen button
["#pl1", "#pl2", "#mvpSel", "#standSel", "#animated"].forEach(s => $(s).onchange = () => api("/api/action/postgame?" + new URLSearchParams({ ...selection(), keep: 1 })));
$$("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.q || ""));
$("#autoScenes").onchange = e => save({ scenes: { auto: e.target.checked } }, true);
$("#autoCapture").onchange = e => save({ autoCapture: e.target.checked }, true);

// ------------------------------------------------------------------ MATCH tab
function renderMatch() {
  const s = cfg.settings, m = st.match, teams = st.teams;
  const opts = sel => teams.map(t => `<option value="${t.id}" ${t.id === sel ? "selected" : ""}>${esc(t.name)}</option>`).join("");
  if (document.activeElement.tagName !== "SELECT") { $("#mA").innerHTML = opts(m.a); $("#mB").innerHTML = opts(m.b); }
  $("#autoResult").checked = st.autoResult;
  $("#aSide").value = m.aSide; $("#bo").value = m.bo;
  if (document.activeElement !== $("#round")) $("#round").value = m.round || "";
  $("#scoreBig").innerHTML = `${esc(m.teamA && m.teamA.short || "A")} ${m.score.a} – ${m.score.b} ${esc(m.teamB && m.teamB.short || "B")}<small>${m.result ? "series over – " + (m.result === "draw" ? "draw" : esc((m.result === "a" ? m.teamA : m.teamB).name) + " win") : "game " + m.game + " of up to " + m.bo}</small>`;
  $("#winA").textContent = `${m.teamA ? m.teamA.name : "Team A"} won`; $("#winB").textContent = `${m.teamB ? m.teamB.name : "Team B"} won`;
  $("#winA").disabled = $("#winB").disabled = !!m.result;
  for (const [id, v] of [["#tName", st.tournament.name], ["#tTag", st.tournament.tagline], ["#between", st.betweenText]]) if (document.activeElement !== $(id)) $(id).value = v || "";
  if (!$("#teams").contains(document.activeElement)) renderTeams();
}
const saveMatch = debounce(() => save({ match: { a: $("#mA").value, b: $("#mB").value, aSide: $("#aSide").value, bo: +$("#bo").value, round: $("#round").value } }, true), 300);
["#mA", "#mB", "#aSide", "#bo"].forEach(s => $(s).onchange = saveMatch); $("#round").oninput = saveMatch;
$("#swap").onclick = () => { const a = $("#mA").value; $("#mA").value = $("#mB").value; $("#mB").value = a; saveMatch(); };
$("#winA").onclick = () => post("/api/match/result", { winner: "a" }); $("#winB").onclick = () => post("/api/match/result", { winner: "b" });
$("#autoResult").onchange = e => save({ autoResult: e.target.checked }, true);
$("#undo").onclick = () => post("/api/match/undo");
$("#newSeries").onclick = () => post("/api/match/new", {}).then(() => toast("Score reset – pick the teams"));
const saveT = debounce(() => save({ tournament: { name: $("#tName").value, tagline: $("#tTag").value }, betweenText: $("#between").value }, true));
["#tName", "#tTag", "#between"].forEach(s => $(s).oninput = saveT);

function renderTeams() {
  $("#teams").innerHTML = st.teams.map(t => `<div class="team" data-id="${t.id}">
    <div class="logo" style="${t.logo ? `background-image:url('${t.logo}?${Date.now() % 1e6}')` : ""}" title="Upload 256×256 PNG">${t.logo ? "" : "logo"}</div>
    <div class="f"><label>Name<input data-k="name" value="${esc(t.name)}"></label><label>Short<input data-k="short" maxlength="5" value="${esc(t.short)}"></label><label>Colour<input data-k="color" type="color" value="${esc(t.color || "#888888")}"></label>
    </div><div class="a"><button class="small ghost danger" data-del>Remove</button></div></div>`).join("");
  $$(".team").forEach(el => {
    const id = el.dataset.id;
    el.querySelectorAll("input").forEach(i => i.oninput = debounce(() => saveTeams(), 400));
    el.querySelector("[data-del]").onclick = () => { if (st.teams.length <= 2) return toast("Keep at least two teams", true); saveTeams(id); };
    el.querySelector(".logo").onclick = () => pickFile(f => upload(`team-${id}`, f));
  });
}
function saveTeams(removeId) {
  const teams = $$(".team").filter(el => el.dataset.id !== removeId).map(el => { const t = { id: el.dataset.id }; el.querySelectorAll("input").forEach(i => t[i.dataset.k] = i.value); return t; });
  return save({ teams }, true);
}
$("#addTeam").onclick = async () => { const id = "t" + Date.now().toString(36); await save({ teams: [...cfg.settings.teams, { id, name: "New team", short: "NEW", color: "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0") }] }, true); };

// ------------------------------------------------------------------ REPLAYS tab
function renderClips() {
  const el = $("#clips"); if (el.contains(document.activeElement)) return;
  if (!st.clips.length) { el.innerHTML = `<div class="empty">No clips yet. Save the replay buffer (Capture button, your app's hotkey, or a multi-kill with auto-capture on).</div>`; return; }
  el.innerHTML = st.clips.map(c => `<div class="clip ${c.inReel ? "reel" : ""}" data-id="${c.id}">
    <div class="t">${new Date(c.at).toLocaleTimeString()}<br>${c.auto ? "auto" : "manual"}</div>
    <div><input data-label value="${esc(c.label || "")}" placeholder="Label, e.g. Rampage by …"><div class="f">${esc(c.file)}${c.playable ? "" : ` <span class="bad">– MKV, can't play in browser</span>`}</div></div>
    <label class="switch"><input type="checkbox" data-reel ${c.inReel ? "checked" : ""}><span></span>In reel</label>
    <div class="btns"><button class="small" data-play="20">▶ 20 s</button><button class="small" data-play="full">▶ All</button><button class="small ghost danger" data-rm title="Remove from the list (file stays)">✕</button></div></div>`).join("");
  $$(".clip").forEach(row => {
    const id = row.dataset.id, upd = patch => post("/api/clip", { id, patch });
    row.querySelector("[data-label]").onchange = e => upd({ label: e.target.value || null });
    row.querySelector("[data-reel]").onchange = e => upd({ inReel: e.target.checked });
    row.querySelectorAll("[data-play]").forEach(b => b.onclick = () => act("show", `clip=${id}&last=${b.dataset.play}`));
    row.querySelector("[data-rm]").onclick = () => post("/api/clip", { id, remove: true });
  });
}
$("#archive").onclick = () => act("archive");

// ------------------------------------------------------------------ DESIGN tab
const VARS = [["accent", "Accent"], ["accent-2", "Second accent"], ["radiant", "Radiant"], ["dire", "Dire"], ["text", "Text"], ["muted", "Muted text"], ["win", "Winner / MVP"], ["accent-text", "Text on accent"]];
function renderDesign() {
  const themes = cfg.themes, cur = st.theme;
  if ($("#themes").dataset.k !== themes.map(t => t.id).join()) {
    $("#themes").dataset.k = themes.map(t => t.id).join();
    $("#themes").innerHTML = themes.map(t => `<div class="theme" data-id="${t.id}"><div class="pv"><iframe loading="lazy" src="/overlays/between.html?theme=${t.id}&reel=0"></iframe></div>
      <div class="m"><b>${esc(t.name)}${t.custom ? `<span class="own">YOURS</span>` : ""}</b><span>${esc(t.description || "")}</span></div></div>`).join("");
    $$(".theme").forEach(el => el.onclick = () => save({ theme: el.dataset.id, themeVars: {} }).then(() => toast("Theme: " + el.querySelector("b").textContent)));
    setTimeout(fitPreviews, 50);
  }
  $$(".theme").forEach(el => el.classList.toggle("on", el.dataset.id === cur));
  const meta = themes.find(t => t.id === cur) || {};
  $("#ownTheme").classList.toggle("on", !!meta.custom);
  if (meta.custom && $("#ownTheme").dataset.id !== cur) loadOwn(cur);
  $("#thName").textContent = meta.name || cur;
  $("#slots").innerHTML = Object.entries(cfg.slots).map(([k, s]) => `<div class="slot"><div class="img" style="${st.assets[k] ? `background-image:url('${st.assets[k]}')` : ""}"></div>
    <div><b>${esc(s.label)}</b><span>${s.max ? "max " : ""}${s.w}×${s.h} px · ${esc(s.hint)}</span></div>
    <div class="a"><button class="small" data-up="${k}">Upload</button>${st.assets[k] && st.assets[k].startsWith("/uploads/") ? `<button class="small ghost danger" data-rm="${k}">✕</button>` : ""}</div></div>`).join("");
  $$("[data-up]").forEach(b => b.onclick = () => pickFile(f => upload(b.dataset.up, f)));
  $$("#slots [data-rm]").forEach(b => b.onclick = () => api(`/api/upload?slot=${b.dataset.rm}`, { method: "DELETE" }));
  if (!$("#vars").contains(document.activeElement)) {
    const vals = { ...(meta.vars || {}), ...cfg.settings.themeVars };
    $("#vars").innerHTML = VARS.map(([k, l]) => `<label>${l}<input type="color" data-var="${k}" value="${toHex(vals[k])}"></label>`).join("");
    $$("[data-var]").forEach(i => i.oninput = debounce(() => save({ themeVars: { ...cfg.settings.themeVars, [i.dataset.var]: i.value } }, true), 250));
  }
}
$("#resetVars").onclick = () => save({ themeVars: {} });
function toHex(v) { if (/^#[0-9a-f]{6}$/i.test(v || "")) return v; if (/^#[0-9a-f]{3}$/i.test(v || "")) return "#" + v.slice(1).split("").map(c => c + c).join(""); return "#888888"; }
function pickFile(cb) { const i = document.createElement("input"); i.type = "file"; i.accept = "image/png,image/jpeg,image/webp"; i.onchange = () => i.files[0] && cb(i.files[0]); i.click(); }
async function upload(slot, file) {
  const r = await fetch(`/api/upload?slot=${encodeURIComponent(slot)}`, { method: "POST", body: file }).then(r => r.json());
  toast(r.ok ? "Uploaded" : "Not uploaded: " + r.error, !r.ok);
}

// ------------------------------------------------------------------ SETUP tab
function renderSetup() {
  const s = cfg.settings;
  $$("#modeSeg button").forEach(b => b.classList.toggle("on", b.dataset.mode === s.mode));
  $$("#layoutSeg button").forEach(b => b.classList.toggle("on", b.dataset.layout === s.draftLayout));
  $(".camonly").classList.toggle("on", s.draftLayout === "cam"); $("#camFrames").value = String(s.camFrames);
  $("#layoutHint").innerHTML = s.draftLayout === "cam"
    ? "Picks and bans in a bar at the bottom; the rest is transparent. Put your camera or video source <b>below</b> the draft browser source in the scene and size it into the frame."
    : "A full draft screen in your theme – team names, picks, bans and the timer. Works without any cameras.";
  $("#modeHint").innerHTML = s.mode === "ad"
    ? `Ability Draft needs <a href="https://github.com/Tiarin-Hino/ability-draft-plus" target="_blank">Ability Draft Plus (AD+)</a> running on this PC – it reads the drafted abilities, which Dota's own data mixes up while spectating. Adds the <b>AD draft</b> overlay and drafted abilities on the post-game screens.`
    : "All Pick, Captains Mode, Turbo… Hero picks and bans come from Dota while you spectate the draft (bans: Captains Mode).";
  if (document.activeElement !== $("#adUrl")) $("#adUrl").value = s.adplusUrl;
  $$("#appSeg button").forEach(b => b.classList.toggle("on", b.dataset.app === (setupApp || s.app)));
  $$(".appcfg").forEach(d => d.classList.toggle("on", d.dataset.for === (setupApp || s.app)));
  for (const [id, v] of [["#obsHost", s.obs.host], ["#obsPort", s.obs.port], ["#obsPass", s.obs.password], ["#slPort", s.streamlabs.port], ["#slToken", s.streamlabs.token], ["#rFolder", s.replays.folder]])
    if (document.activeElement !== $(id) && !$(id).dataset.dirty) $(id).value = v ?? "";
  $("#appMsg").className = "msg " + (st.app.connected ? "ok" : st.app.error ? "bad" : "");
  $("#appMsg").textContent = s.app === "none" ? "" : st.app.connected ? "Connected." : st.app.error ? "Not connected: " + st.app.error : "Connecting…";
  $("#askFolder").style.display = s.app === "obs" && st.app.connected ? "" : "none";
  renderSceneMap(); renderUrls();
}
let setupApp = null;
$$("#modeSeg button").forEach(b => b.onclick = () => save({ mode: b.dataset.mode }));
$$("#layoutSeg button").forEach(b => b.onclick = () => save({ draftLayout: b.dataset.layout }, true));
$("#camFrames").onchange = e => save({ camFrames: +e.target.value }, true);
$("#adUrl").onchange = e => save({ adplusUrl: e.target.value.trim() });
$$("#appSeg button").forEach(b => b.onclick = () => { setupApp = b.dataset.app; renderSetup(); if (setupApp === "none") { save({ app: "none" }); setupApp = null; } });
$$("#st-app input, #rFolder").forEach(i => i.oninput = () => i.dataset.dirty = 1);
$("#saveApp").onclick = async () => {
  const app = setupApp || cfg.settings.app;
  await save({ app, obs: { host: $("#obsHost").value || "127.0.0.1", port: +$("#obsPort").value || 4455, password: $("#obsPass").value }, streamlabs: { port: +$("#slPort").value || 59650, token: $("#slToken").value } }, true);
  $$("#st-app input").forEach(i => delete i.dataset.dirty); setupApp = null; toast("Connecting to " + app + "…");
  setTimeout(() => { sceneList = null; renderSceneMap(); }, 2500);
};
$("#gsiInstall").onclick = async () => { const r = await post("/api/gsi/install"); $("#gsiMsg").className = "msg " + (r.ok ? "ok" : "bad"); $("#gsiMsg").textContent = r.ok ? `Installed in ${r.dir}. Add -gamestateintegration to the launch options and restart Dota.` : r.error; };
$("#saveFolder").onclick = async () => { await save({ replays: { folder: $("#rFolder").value.trim() } }); delete $("#rFolder").dataset.dirty; };
$("#askFolder").onclick = async () => { const r = await api("/api/app/replay-folder"); if (r.folder) { $("#rFolder").value = r.folder; $("#rFolder").dataset.dirty = 1; $("#folderMsg").textContent = "From OBS – press Save."; } else $("#folderMsg").textContent = "OBS didn't say – type it in."; };

let sceneList = null;
async function renderSceneMap() {
  const el = $("#sceneMap"); if (el.contains(document.activeElement)) return;
  if (cfg.settings.app === "none") { el.innerHTML = ""; return; }
  if (st.app.connected && !sceneList) { sceneList = await api("/api/app/scenes").catch(() => []); }
  const s = cfg.settings.scenes;
  el.innerHTML = `<p class="hint" style="grid-column:1/-1;margin-top:8px">Which of your scenes to use – used by auto scenes and the scene buttons:</p>` + SCENES.map(([k, l]) => `<label>${l}${sceneList && sceneList.length
    ? `<select data-sc="${k}">${[...new Set([s[k], ...sceneList])].map(n => `<option ${n === s[k] ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : `<input data-sc="${k}" value="${esc(s[k])}">`}</label>`).join("")
    + `<label>Post-game delay (s)<input data-sc="postDelay" type="number" min="0" value="${s.postDelay}"></label>`;
  el.querySelectorAll("[data-sc]").forEach(i => i.onchange = () => save({ scenes: { [i.dataset.sc]: i.dataset.sc === "postDelay" ? +i.value : i.value } }, true));
}

const PAGES = [["postgame", "Post-game screens", "scoreboard, MVP, standout, head to head, net worth, leaders"], ["between", "Between games", "up next + highlight reel"], ["replay", "Replay", "plays the clip you pick"], ["draft", "Draft", ""]];
function renderUrls() {
  const draftDesc = st.mode === "ad" ? "Ability Draft board – needs AD+" : st.draftLayout === "cam" ? "picks & bans bar + camera space – put cameras below this source" : "picks, bans & timer – full screen";
  const html = PAGES.map(([f, l, d]) => urlRow(l, f === "draft" ? draftDesc : d, `${ORIGIN}/overlays/${f}.html`)).join("");
  if ($("#urls").dataset.k !== html) { $("#urls").dataset.k = html; $("#urls").innerHTML = html; bindCopy($("#urls")); }
  const acts = [["capture", "Capture replay"], ["show?last=10", "Replay last 10 s"], ["show?last=20", "Replay last 20 s"], ["show?last=30", "Replay last 30 s"], ["show?last=full", "Replay whole clip"],
    ["slower", "Slower"], ["normal", "Normal speed"], ["faster", "Faster"], ["live", "Back to live"], ["postgame?screen=board", "Post-game: scoreboard"], ["postgame?screen=mvp", "Post-game: MVP"],
    ["postgame?screen=graph", "Post-game: net worth"], ["postgame?screen=leaders", "Post-game: leaders"], ["postgame?screen=off", "Post-game: hide"], ["scene?name=between", "Scene: between games"], ["scene?name=game", "Scene: game"], ["auto", "Toggle auto scenes"], ["archive", "Archive highlight reel"]];
  const a = acts.map(([q, l]) => urlRow(l, "", `${ORIGIN}/api/action/${q}`)).join("");
  if ($("#actions").dataset.k !== a) { $("#actions").dataset.k = a; $("#actions").innerHTML = a; bindCopy($("#actions")); }
}
const urlRow = (l, d, u) => `<div class="url"><b>${esc(l)}${d ? `<span>${esc(d)}</span>` : ""}</b><code>${esc(u)}</code><button class="small" data-copy="${esc(u)}">Copy</button></div>`;
function bindCopy(root) { root.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Copied"), () => toast(b.dataset.copy)); }); }
async function loadLog() { $("#log").textContent = (await api("/api/log")).join("\n") + "\n"; $("#log").scrollTop = 1e9; }

// ------------------------------------------------------------------ start
(async () => {
  cfg = await api("/api/settings");
  showTab(store.get("dck-tab") || (cfg.settings.replays.folder || cfg.settings.app !== "none" ? "live" : "setup"));
  connect();
  setInterval(async () => { const c = await api("/api/settings").catch(() => null); if (c) { cfg = c; } }, 10000);
})();

// ------------------------------------------------------------------ own themes
async function loadOwn(id) {
  const t = await api("/api/theme?id=" + encodeURIComponent(id));
  $("#ownTheme").dataset.id = id; $("#ownName").textContent = t.meta.name;
  $("#ownTitle").value = t.meta.name || ""; $("#ownDesc").value = t.meta.description || ""; $("#ownCss").value = t.css || "";
}
async function refreshThemes(r) { if (r.themes) { cfg.themes = r.themes; $("#themes").dataset.k = ""; } cfg = await api("/api/settings"); render(); }
$("#newTheme").onclick = async () => {
  const name = $("#newThemeName").value.trim(); if (!name) return toast("Give your theme a name first", true);
  const r = await post("/api/theme/new", { name, from: st.theme });
  if (r.ok) { $("#newThemeName").value = ""; $("#ownTheme").dataset.id = ""; toast("Theme created – it's now active"); await refreshThemes(r); } else toast(r.error, true);
};
$("#saveOwn").onclick = async () => {
  const r = await post("/api/theme", { id: st.theme, name: $("#ownTitle").value.trim(), description: $("#ownDesc").value, css: $("#ownCss").value });
  toast(r.ok ? "Theme saved" : r.error, !r.ok); if (r.ok) { $("#ownName").textContent = $("#ownTitle").value; await refreshThemes(r); }
};
$("#bakeVars").onclick = async () => {
  const r = await post("/api/theme", { id: st.theme, vars: cfg.settings.themeVars });
  if (r.ok) { await save({ themeVars: {} }, true); toast("Colours saved into the theme"); await refreshThemes(r); } else toast(r.error, true);
};
$("#delTheme").onclick = async () => {
  if ($("#delTheme").dataset.armed !== "1") { $("#delTheme").dataset.armed = "1"; $("#delTheme").textContent = "Click again to delete"; setTimeout(() => { $("#delTheme").dataset.armed = ""; $("#delTheme").textContent = "Delete theme"; }, 3000); return; }
  const r = await api("/api/theme?id=" + encodeURIComponent(st.theme), { method: "DELETE" });
  toast(r.ok ? "Theme deleted" : r.error, !r.ok); if (r.ok) { $("#ownTheme").dataset.id = ""; await refreshThemes(r); }
};
