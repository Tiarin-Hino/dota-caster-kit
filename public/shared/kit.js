// Shared helpers for every overlay page. Overlays are 1920×1080 browser sources.
//   ?theme=<id>   preview another theme without changing the active one
//   ?scale=0.5    shrink the stage (previews in the control panel)
(function () {
  const qs = new URLSearchParams(location.search);
  const CDN = "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react";
  const listeners = {};
  const KIT = window.KIT = {
    qs, state: null, assets: {},
    logo(cls = "logo") { return KIT.assets.logo ? `<img class="${cls}" src="${KIT.assets.logo}" alt="">` : ""; },
    on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); if (type === "state" && KIT.state) fn(KIT.state); },
    esc: s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    hero: npc => npc ? `${CDN}/heroes/${npc}.png` : "",
    heroRender: npc => npc ? `https://cdn.steamstatic.com/apps/dota2/videos/dota_react/heroes/renders/${npc}.png` : "",
    item: n => n ? `${CDN}/items/${n.replace(/^item_/, "")}.png` : "",
    ability: n => n ? `${CDN}/abilities/${n}.png` : "",
    k: n => n == null ? "–" : n >= 10000 ? (n / 1000).toFixed(1) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(Math.round(n)),
    num: n => n == null ? "–" : Math.round(n).toLocaleString("en-US"),
    clock: s => { if (s == null) return "–"; s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; },
    get: (u) => fetch(u, { cache: "no-store" }).then(r => r.json()),
    post: (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) }).then(r => r.json()),
    // team shown on a side ("radiant"/"dire") of the current series
    sideTeam(st, side) { const m = st.match; const aRad = m.aSide === "radiant"; return (side === "radiant") === aRad ? m.teamA : m.teamB; },
    teamLogo(t, cls = "tlogo") { if (!t) return ""; return t.logo ? `<img class="${cls}" src="${t.logo}" alt="">` : `<span class="${cls} tlogo-text" style="--tc:${t.color || "var(--accent)"}">${KIT.esc((t.short || t.name || "?").slice(0, 4))}</span>`; },
    img(src, cls = "") { return src ? `<img class="${cls}" src="${src}" alt="" onerror="this.style.visibility='hidden'">` : `<span class="${cls} noimg"></span>`; },
  };

  // stage scaling (previews) + theme stylesheet
  const scale = +qs.get("scale") || 0;
  if (scale) document.documentElement.style.setProperty("--stage-scale", scale);
  const link = document.createElement("link"); link.rel = "stylesheet"; document.head.appendChild(link);
  let theme = null;
  function setTheme(id) { if (id === theme) return; theme = id; link.href = `/theme.css?theme=${encodeURIComponent(id)}&v=${Date.now()}`; document.documentElement.dataset.theme = id; }
  if (qs.get("theme")) { setTheme(qs.get("theme")); fetch("/api/assets?theme=" + encodeURIComponent(qs.get("theme"))).then(r => r.json()).then(a => { KIT.assets = a; KIT.state && (listeners.state || []).forEach(f => f(KIT.state)); }); }

  // Overlays poll the state (short requests) instead of keeping a live connection open: browsers allow only
  // ~6 open connections per host, and OBS shares them between all browser sources.
  let lastJson = "", lastThemeRev = null;
  async function poll() {
    try {
      const txt = await fetch("/api/state", { cache: "no-store" }).then(r => r.text());
      if (txt !== lastJson) {
        lastJson = txt;
        const st = KIT.state = JSON.parse(txt);
        if (!qs.get("theme")) KIT.assets = st.assets || {};
        if (lastThemeRev !== null && st.themeRev !== lastThemeRev) { const id = theme; theme = null; setTheme(qs.get("theme") || id); }
        lastThemeRev = st.themeRev;
        if (!qs.get("theme")) setTheme(st.theme);
        (listeners.state || []).forEach(f => { try { f(st); } catch (e) { console.error(e); } });
      }
    } catch {}
    setTimeout(poll, +qs.get("poll") || 400);
  }
  poll();
})();
