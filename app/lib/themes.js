// Themes = folders in /themes/<id>/ with theme.json (+ optional theme.css and images).
// Users can replace any image slot from the control panel; uploads live in data/uploads/<theme>/<slot>.<ext> and win
// over the theme's own files. Everything the overlays need comes from GET /theme.css (CSS variables + extra css).
const fs = require("fs");
const path = require("path");

// Image slots every theme can use. Sizes are exact unless "max".
const SLOTS = {
  background: { w: 1920, h: 1080, label: "Background", hint: "full-screen background behind post-game / between-games screens (JPG or PNG)" },
  logo:       { w: 600, h: 240, max: true, label: "Tournament logo", hint: "transparent PNG, at most 600×240" },
  texture:    { w: 512, h: 512, label: "Panel texture", hint: "seamless tile used inside panels (optional)" },
};
const TEAM_LOGO = { w: 256, h: 256, label: "Team logo", hint: "square transparent PNG, 256×256" };

function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: "png" };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {               // JPEG: walk the segments to SOFn
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), type: "jpg" };
      i += 2 + len;
    }
  }
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), type: "webp" };
    if (chunk === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, type: "webp" };
    if (chunk === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, type: "webp" }; }
  }
  return null;
}

function checkSize(spec, dim) {
  if (!dim) return "not a PNG, JPG or WebP image";
  if (spec.max ? (dim.w > spec.w || dim.h > spec.h) : (dim.w !== spec.w || dim.h !== spec.h))
    return `${dim.w}×${dim.h} – needs ${spec.max ? "at most " : "exactly "}${spec.w}×${spec.h}`;
  return null;
}

// Built-in themes live in themes/ (part of the app, replaced on update). Your own themes live in data/themes/
// (created from the panel or copied there by hand) and are never touched by updates.
class Themes {
  constructor({ root, dataDir }) {
    this.root = root; this.custom = path.join(dataDir, "themes"); this.up = path.join(dataDir, "uploads");
    fs.mkdirSync(this.up, { recursive: true }); fs.mkdirSync(this.custom, { recursive: true });
  }
  dir(id) {
    if (!/^[\w-]+$/.test(id || "")) return null;
    if (fs.existsSync(path.join(this.custom, id, "theme.json"))) return path.join(this.custom, id);
    if (fs.existsSync(path.join(this.root, id, "theme.json"))) return path.join(this.root, id);
    return null;
  }
  urlBase(id) { return this.dir(id) && this.dir(id).startsWith(this.custom) ? `/custom-themes/${id}` : `/themes/${id}`; }
  list() {
    const ids = new Set();
    for (const r of [this.root, this.custom]) for (const d of fs.readdirSync(r)) if (fs.existsSync(path.join(r, d, "theme.json"))) ids.add(d);
    return [...ids].map(id => ({ id, custom: this.dir(id).startsWith(this.custom), ...this.meta(id) })).sort((a, b) => (a.custom - b.custom) || (a.order || 99) - (b.order || 99));
  }
  meta(id) { const d = this.dir(id); try { return JSON.parse(fs.readFileSync(path.join(d, "theme.json"), "utf8")); } catch { return null; } }
  cssText(id) { const d = this.dir(id); try { return fs.readFileSync(path.join(d, "theme.css"), "utf8"); } catch { return ""; } }
  // new theme = copy of another (its colours + your current colour overrides, its CSS and images)
  create(name, from, vars = {}) {
    const base = this.meta(from) || this.meta("esports");
    let id = String(name || "my-theme").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "my-theme", n = 2;
    while (this.dir(id)) id = id.replace(/-\d+$/, "") + "-" + n++;
    const d = path.join(this.custom, id); fs.mkdirSync(d, { recursive: true });
    const src = this.dir(from);
    const assets = {};
    for (const [slot, f] of Object.entries(base.assets || {})) { try { fs.copyFileSync(path.join(src, f), path.join(d, f)); assets[slot] = f; } catch {} }
    fs.writeFileSync(path.join(d, "theme.json"), JSON.stringify({ ...base, name: name || id, description: `Based on ${base.name}`, author: "", order: 50,
      vars: { ...(base.vars || {}), ...vars }, assets }, null, 2));
    fs.writeFileSync(path.join(d, "theme.css"), `/* ${name} – your own rules. Based on ${base.name}. See docs/THEMES.md */\n` + this.cssText(from).replace(/^\/\*[^]*?\*\/\n?/, ""));
    for (const ext of ["png", "jpg", "jpeg", "webp"]) for (const slot of Object.keys(SLOTS)) {
      const f = path.join(this.up, from, `${slot}.${ext}`); if (fs.existsSync(f)) { fs.mkdirSync(path.join(this.up, id), { recursive: true }); fs.copyFileSync(f, path.join(this.up, id, `${slot}.${ext}`)); }
    }
    return id;
  }
  update(id, { name, description, vars, css }) {
    const d = this.dir(id); if (!d || !d.startsWith(this.custom)) return { error: "only your own themes can be edited – make a copy first" };
    const m = this.meta(id);
    if (name) m.name = name; if (description !== undefined) m.description = description; if (vars) m.vars = { ...(m.vars || {}), ...vars };
    fs.writeFileSync(path.join(d, "theme.json"), JSON.stringify(m, null, 2));
    if (css !== undefined) fs.writeFileSync(path.join(d, "theme.css"), css);
    return { ok: true };
  }
  remove(id) {
    const d = this.dir(id); if (!d || !d.startsWith(this.custom)) return { error: "built-in themes can't be deleted" };
    fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(path.join(this.up, id), { recursive: true, force: true }); return { ok: true };
  }
  // url of an image slot: upload > theme file > none
  asset(id, slot) {
    for (const ext of ["png", "jpg", "jpeg", "webp"]) if (fs.existsSync(path.join(this.up, id, `${slot}.${ext}`))) return `/uploads/${id}/${slot}.${ext}`;
    const m = this.meta(id) || {}; const f = m.assets && m.assets[slot];
    return f ? `${this.urlBase(id)}/${f}` : null;
  }
  css(id, overrides = {}) {
    const m = this.meta(id) || this.meta("esports") || {};
    const vars = { ...(m.vars || {}), ...overrides };
    const lines = [];
    for (const f of m.fonts || []) lines.push(`@import url("${f}");`);
    lines.push(":root{");
    for (const [k, v] of Object.entries(vars)) lines.push(`  --${k}: ${v};`);
    for (const slot of Object.keys(SLOTS)) { const u = this.asset(id, slot); lines.push(`  --img-${slot}: ${u ? `url("${u}")` : "none"};`); }
    lines.push("}");
    const extra = this.cssText(this.meta(id) ? id : "esports");
    if (extra) lines.push(extra);
    return lines.join("\n");
  }
  saveUpload(id, slot, buf) {
    const spec = slot.startsWith("team-") ? TEAM_LOGO : SLOTS[slot];
    if (!spec) return { error: "unknown slot" };
    const dim = imageSize(buf), err = checkSize(spec, dim);
    if (err) return { error: err };
    const dir = slot.startsWith("team-") ? path.join(this.up, "teams") : path.join(this.up, id);
    fs.mkdirSync(dir, { recursive: true });
    const name = slot.startsWith("team-") ? slot.slice(5) : slot;
    for (const f of fs.readdirSync(dir)) if (f.startsWith(name + ".")) fs.unlinkSync(path.join(dir, f));
    const file = `${name}.${dim.type}`;
    fs.writeFileSync(path.join(dir, file), buf);
    return { ok: true, url: slot.startsWith("team-") ? `/uploads/teams/${file}` : `/uploads/${id}/${file}` };
  }
  removeUpload(id, slot) {
    const dir = path.join(this.up, id);
    if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.startsWith(slot + ".")) fs.unlinkSync(path.join(dir, f));
  }
}

module.exports = { Themes, SLOTS, TEAM_LOGO, imageSize };
