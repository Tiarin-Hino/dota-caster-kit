# Themes

A theme is a folder in `themes/`. The four built-in ones are complete examples – copy the one closest to what you want and change it.

```
themes/
  my-league/
    theme.json      required – name, fonts, colours, default images
    theme.css       optional – extra CSS rules
    background.jpg  optional – default images (users can still replace them in the panel)
```

Hand-made themes go into `data/themes/` (kept across updates) or `themes/` (built-in). The app finds new folders on start – restart it after adding one.

## Your own theme in the panel

Design tab → select the theme closest to what you want → type a name → **Make my own theme from the selected one**. The copy is saved in `data/themes/<name>/` (updates never touch it) and becomes active. Then edit its name, description and extra CSS right in the panel, upload images, and **Save current colours into the theme** to keep your colour picks inside it. Share it by zipping that folder.

## Quick rebrand without code

Design tab in the panel:

1. Pick the theme closest to your look.
2. Upload your images – they are checked for size and kept per theme:

| Slot | Size | Notes |
|---|---|---|
| Background | **exactly 1920 × 1080** | JPG or PNG. Darkened a bit by `--bg-overlay` so text stays readable. |
| Tournament logo | **at most 600 × 240** | Transparent PNG. Shown in the header of every screen. |
| Panel texture | **exactly 512 × 512** | Seamless tile, blended softly into all panels. Optional. |
| Team logo | **exactly 256 × 256** | Square transparent PNG, per team (Match tab). |

3. Set your colours (accent, Radiant/Dire, text…). *Reset* goes back to the theme's colours.

Uploads live in `data/uploads/`, not in the theme, so updating the kit never overwrites them.

## theme.json

```json
{
  "name": "My League",
  "description": "One line shown in the panel.",
  "author": "you",
  "order": 10,
  "fonts": ["/fonts/inter.css"],
  "vars": {
    "bg": "linear-gradient(160deg, #10151f, #1d2433)",
    "panel": "rgba(20,26,38,.92)",
    "accent": "#ff7a00",
    "font-head": "'Inter', sans-serif",
    "radius": "12px"
  },
  "assets": { "background": "background.jpg" }
}
```

- **fonts** – CSS files to load. Bundled (work offline): `/fonts/inter.css`, `/fonts/rajdhani.css`, `/fonts/press-start-2p.css`, `/fonts/vt323.css`, `/fonts/cinzel.css`, `/fonts/lora.css`. A Google Fonts URL also works when the PC is online. To bundle another font, put the `.woff2` files and a CSS file in `public/fonts/` (check the licence allows it).
- **vars** – any variable from the list below; leave out what you don't change.
- **assets** – default images shipped with the theme, by slot (`background`, `logo`, `texture`), paths relative to the theme folder. Use the sizes above.

## Variables

| Variable | What it changes | Default |
|---|---|---|
| `bg` | page background when no image is uploaded (any CSS background) | `#0b0f17` |
| `bg-overlay` | layer over an uploaded background | `rgba(0,0,0,.35)` |
| `panel` | panel fill (colour or gradient) | dark blue |
| `panel-2` | inner tiles, stat boxes | faint white |
| `line` | separators | `rgba(255,255,255,.12)` |
| `border` | panel border (full CSS border) | `1px solid var(--line)` |
| `text` / `muted` | main / secondary text | |
| `accent` / `accent-2` / `accent-text` | highlights, pills / second accent (replay speed) / text on accent | |
| `radiant` / `dire` | side colours (bars, graph) | green / red |
| `win` | winner tag, MVP star, best values | yellow |
| `font-head` / `font-body` / `font-num` | headings / text / numbers | system font |
| `head-case` / `head-spacing` / `head-weight` | heading `text-transform`, `letter-spacing`, `font-weight` | uppercase / .06em / 700 |
| `radius` | corner radius | `10px` |
| `shadow` | panel shadow | soft dark |

Image slots arrive as `--img-background`, `--img-logo`, `--img-texture` (`url(...)` or `none`).

## theme.css

For anything variables can't do. Useful classes:

| Class | Element |
|---|---|
| `.backdrop` | full-screen background (`::before` = image, `::after` = overlay) |
| `.panel` | every box |
| `.head` | headings (team names, titles, big numbers) |
| `.pill`, `.winner-tag` | small labels |
| `.topbar` | header bar on post-game screens |
| `.tlogo`, `.tlogo-text` | team logo / badge when no logo is uploaded |
| `.side-bar` + `.rad` / `.dir` | coloured side edge (`--side` = team side colour) |
| `.row`, `.tile`, `.card`, `.lead` | scoreboard row, stat tile, AD draft card, leaders box |
| `html[data-theme="my-league"]` | set on every overlay – scope rules to your theme |

Keep layout alone (positions, grid sizes) so every screen still fits 1920 × 1080; change looks. The built-in themes show the range: **Neon Arena** cuts panel corners with `clip-path`, **Pixel Quest** retunes font sizes for arcade fonts and uses hard shadows, **Ancient Relic** adds ornaments with `::before`, **Clean Light** is almost only variables.

## Testing a theme

- Open `http://127.0.0.1:58900/overlays/postgame.html?theme=my-league&screen=board` in a browser (also `mvp`, `compare`, `graph`, `leaders`), `between.html?theme=my-league`, `draft.html?theme=my-league`.
- No game played yet? Run `node tools/fake-gsi.js --fast` – it plays a short fake match.
- Check: long team names (“The Extremely Long Team Name”), names with accents/Cyrillic, a light and a dark background upload.

## Sharing

Send a pull request with your theme folder (only images you made or may share), or publish it as a zip – users drop it into `themes/`.
