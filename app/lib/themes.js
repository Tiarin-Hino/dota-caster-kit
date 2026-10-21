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

class Themes {
  constructor({ root, dataDir }) { this.root = root; this.up = path.join(dataDir, "uploads"); fs.mkdirSync(this.up, { recursive: true }); }
  list() {
    return fs.readdirSync(this.root).filter(d => fs.existsSync(path.join(this.root, d, "theme.json")))
      .map(id => ({ id, ...this.meta(id) })).sort((a, b) => (a.order || 99) - (b.order || 99));
  }
  meta(id) { try { return JSON.parse(fs.readFileSync(path.join(this.root, id, "theme.json"), "utf8")); } catch { return null; } }
  // url of an image slot: upload > theme file > none
  asset(id, slot) {
    for (const ext of ["png", "jpg", "jpeg", "webp"]) if (fs.existsSync(path.join(this.up, id, `${slot}.${ext}`))) return `/uploads/${id}/${slot}.${ext}`;
    const m = this.meta(id) || {}; const f = m.assets && m.assets[slot];
    return f ? `/themes/${id}/${f}` : null;
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
    const extra = path.join(this.root, id, "theme.css");
    if (fs.existsSync(extra)) lines.push(fs.readFileSync(extra, "utf8"));
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
