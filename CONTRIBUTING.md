# Contributing

Issues and pull requests welcome – especially themes, Streamlabs reports and fixes from real broadcasts.

## Ground rules
- **No npm dependencies** in the app. It must run with a plain Node 18+ install, unzipped, by someone who has never opened a terminal.
- Overlays are plain HTML/CSS/JS, 1920 × 1080, one file each. Layout in the overlay, looks in `public/shared/base.css` variables and themes.
- Overlays **poll** `/api/state`; don't add long-lived connections to overlays (browsers cap open connections per host and OBS shares them across sources). The panel uses one SSE stream.
- Only ship images you made or may share. Dota images load from Valve's CDN at runtime.

## Layout
```
app/server.js        HTTP server, settings, actions, automation
app/lib/game.js      GSI parsing, match recording, highlight detection, leaders
app/lib/adplus.js    Ability Draft Plus connector (AD mode)
app/lib/replays.js   replay folder watcher, clip streaming, highlight archive
app/lib/connectors.js OBS (obs-websocket v5) / Streamlabs (JSON-RPC)
app/lib/themes.js    themes, uploads with size checks, generated /theme.css
public/panel/        control panel
public/overlays/     browser sources
public/shared/       kit.js (state + helpers), base.css (variables + base layout)
themes/              built-in themes
tools/fake-gsi.js    fake spectated match for testing
```

## Testing
```
node app/server.js                 # panel at http://127.0.0.1:58900/
node tools/fake-gsi.js --fast      # second terminal: draft → game with highlights → post-game
DCK_DATA=/tmp/dck node app/server.js   # throwaway data folder
```
See [CLAUDE.md](CLAUDE.md) for lessons from live broadcasts – read it before changing GSI or AD handling.
