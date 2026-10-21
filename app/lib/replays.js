// Replay clips = files your streaming app's replay buffer saves (OBS / Streamlabs "Save Replay").
// We watch that folder; every new video becomes a clip. The replay and between-games overlays play clips in the browser,
// so they must be browser-playable: set the replay format to MP4 (OBS: Settings → Output → Recording format / Replay
// buffer uses the recording format). MKV usually does NOT play in browser sources.
const fs = require("fs");
const path = require("path");
const { readJson, writeJson } = require("./game");

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i;
const MIME = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska" };

class Replays {
  constructor({ dataDir, log, onClip }) {
    this.file = path.join(dataDir, "clips.json");
    this.clips = readJson(this.file) || [];
    this.log = log; this.onClip = onClip;
    this.folder = null; this.known = new Set(); this.timer = null;
  }
  save() { writeJson(this.file, this.clips); }
  setFolder(folder) {
    clearInterval(this.timer); this.folder = folder || null; this.known = new Set();
    if (!this.folder) return;
    try { for (const f of fs.readdirSync(this.folder)) this.known.add(f); }     // existing files are not new clips
    catch (e) { this.log(`replay folder not readable: ${this.folder} (${e.code || e.message})`); }
    this.timer = setInterval(() => this.scan(), 1000);
    this.log("watching replay folder " + this.folder);
  }
  scan() {
    let files; try { files = fs.readdirSync(this.folder); } catch { return; }
    for (const f of files) {
      if (this.known.has(f) || !VIDEO.test(f)) continue;
      const full = path.join(this.folder, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      // wait until the file stops growing (the app is still writing it)
      if (!this.sizes) this.sizes = {};
      if (this.sizes[f] !== st.size || Date.now() - st.mtimeMs < 800) { this.sizes[f] = st.size; continue; }
      this.known.add(f); delete this.sizes[f];
      const clip = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, file: f, path: full, at: Date.now(),
                     label: null, auto: false, inReel: false, fromEnd: null, browserPlayable: !/\.mkv$/i.test(f) };
      this.clips.push(clip); this.save();
      this.log(`new replay clip ${f}${clip.browserPlayable ? "" : " – MKV: switch your replay format to MP4 for browser playback"}`);
      this.onClip && this.onClip(clip);
    }
  }
  get(id) { return this.clips.find(c => c.id === id); }
  latest() { return this.clips[this.clips.length - 1] || null; }
  update(id, patch) { const c = this.get(id); if (c) { Object.assign(c, patch); this.save(); } return c; }
  remove(id) { this.clips = this.clips.filter(c => c.id !== id); this.save(); }
  reel() { return this.clips.filter(c => c.inReel); }

  // stream a clip with HTTP Range support (needed for seeking in <video>)
  serve(req, res, id) {
    const c = this.get(id); if (!c) { res.writeHead(404); return res.end(); }
    let st; try { st = fs.statSync(c.path); } catch { res.writeHead(404); return res.end(); }
    const type = MIME[path.extname(c.path).toLowerCase()] || "application/octet-stream";
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    if (range) {
      const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      fs.createReadStream(c.path, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes" });
      fs.createReadStream(c.path).pipe(res);
    }
  }

  // move the reel's clips into <replay folder>/Highlights/<date> <name>/ with highlights.json (labels + trims)
  archive(name) {
    const clips = this.reel(); if (!clips.length || !this.folder) return { moved: 0 };
    const safe = s => String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
    const day = new Date().toISOString().slice(0, 10);
    const root = path.join(this.folder, "Highlights");
    let dir = path.join(root, safe(`${day} ${name || "game"}`)), n = 2;
    while (fs.existsSync(dir)) dir = path.join(root, safe(`${day} ${name || "game"}`) + ` (${n++})`);
    fs.mkdirSync(dir, { recursive: true });
    const index = [];
    clips.forEach((c, i) => {
      const file = `${String(i + 1).padStart(2, "0")} ${safe(c.label || "replay")}${path.extname(c.path)}`;
      try {
        try { fs.renameSync(c.path, path.join(dir, file)); } catch { fs.copyFileSync(c.path, path.join(dir, file)); try { fs.unlinkSync(c.path); } catch {} }
        index.push({ file, label: c.label, auto: c.auto, lastSeconds: c.fromEnd == null ? null : Math.round(c.fromEnd / 1000) });
      } catch (e) { this.log(`archive ${c.file}: ${e.code || e.message}`); }
    });
    writeJson(path.join(dir, "highlights.json"), { game: name, savedAt: new Date().toISOString(), clips: index });
    const ids = new Set(clips.map(c => c.id)); this.clips = this.clips.filter(c => !ids.has(c.id)); this.save();
    this.log(`highlights archived: ${index.length} → ${dir}`);
    return { moved: index.length, dir };
  }
}

module.exports = { Replays };
