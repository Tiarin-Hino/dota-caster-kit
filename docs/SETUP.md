# Setup

The **Setup** tab in the control panel walks through the same steps. This page has the details and the fixes.

## 1. Run the app

Install Node.js LTS ([nodejs.org](https://nodejs.org)), unzip the kit, double-click `start.bat`. Keep the black window open while you stream – closing it stops the app. Settings, matches and uploads are kept in the `data/` folder next to the app (back it up, or copy it to another PC).

Change the port: `set DCK_PORT=58901` before `node app\server.js` (then update the GSI file and the browser source URLs).

## 2. Connect Dota 2 (Game State Integration)

Dota sends live data to the app through a config file:

1. Setup tab → **Install automatically** (finds your Steam library), or **Download file** and copy it to
   `…\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\` (create the folder if needed).
2. Steam → Dota 2 → Properties → Launch options: add `-gamestateintegration`.
3. Restart Dota. Spectate a lobby or watch a replay – the Dota light in the panel turns green.

Dota only reports all 10 players while **spectating / casting / watching a replay**. While you play yourself, it reports only you.

## 3. Connect your streaming app (optional, recommended)

The connection is used for two things: switching scenes and saving the replay buffer. Without it, use your app's own hotkeys – the overlays still update on their own.

### OBS Studio 28+
Tools → **WebSocket Server Settings** → Enable → Show connect info → copy the password. In the panel pick *OBS Studio*, paste it, **Connect**.

### Streamlabs Desktop *(experimental)*
Settings → **Remote Control** → click the QR-code area → *Show details* → copy the **API token**. In the panel pick *Streamlabs Desktop*, paste the token, **Connect**. Port is 59650 unless you changed it. If it doesn't connect on your version, choose *None* – everything except automatic scenes and the Capture button still works. Please open an issue with your Streamlabs version.

### Scene names
After connecting, map the kit's five scenes to yours (Setup step 3): Draft, Game, Post-game, Replay, Between games. *Post-game delay* = seconds after the ancient falls before the post-game scene comes up.

## 4. Replay buffer

The replay overlay plays the files your replay buffer saves, so it works with any app.

- **OBS**: Settings → Output → Replay Buffer → enable, set max time (60–90 s is good). Settings → Output → Recording → **Recording format: MP4** (or *Fragmented MP4*). Start the replay buffer before going live (OBS can also start it automatically when you start streaming).
- **Streamlabs**: Settings → Output → Replay Buffer → enable, format **MP4**. Start it from the replay-buffer button.

Browsers cannot play **MKV** – the panel warns when a clip is MKV.

Then tell the kit where the files land (Setup step 4, *Ask OBS* fills it in for OBS).

**Highlights archive**: when the next draft starts, every clip in the reel is moved to `<replay folder>/Highlights/<date> <Radiant team> vs <Dire team>/`, numbered and named after its label, with a `highlights.json` (labels and trims). The reel starts empty for the new game.

## 5. Add the overlays

One **Browser Source** per scene, **1920 × 1080**:

| Scene | Source URL |
|---|---|
| Post-game | `http://127.0.0.1:58900/overlays/postgame.html` |
| Replay | `http://127.0.0.1:58900/overlays/replay.html` |
| Between games | `http://127.0.0.1:58900/overlays/between.html` |
| Draft *(AD only)* | `http://127.0.0.1:58900/overlays/draft.html` |

For clip sound add `?sound=1` and tick *Control audio via OBS*. Leave *Shutdown source when not visible* **off** so screens are ready the moment you switch.

## Game day checklist

1. `start.bat`, panel open, Dota light green, app light green.
2. Replay buffer running.
3. Match tab: pick the two teams, Bo, round. Check *Team A plays* (Radiant/Dire) before each game.
4. Auto scenes on. Cast.
5. After the game: post-game scoreboard comes up by itself → click MVP / Net worth / Leaders as you talk → *Between games* scene for the break.

## Troubleshooting

| Problem | Fix |
|---|---|
| Dota light stays red | `-gamestateintegration` missing, file in the wrong folder, or Dota not restarted. Spectate a game – the main menu sends little. |
| Wrong team names on the post-game screen | *Team A plays* (Radiant/Dire) was wrong for that game. Fix it – the screen updates. |
| Series score counted a game twice / wrong | Undo in the Match tab. Turn off *Count finished games automatically* when you watch old replays. |
| Replay shows a black screen | Clip is MKV, or the replay folder is wrong. Check the Replays tab. |
| Capture says "replay buffer running?" | Start the replay buffer in OBS/Streamlabs. |
| Hero/item images missing | The streaming PC needs internet (images come from Valve's CDN). |
| AD draft board empty | AD+ not running or on another address (Setup step 1). |
| Stream drops frames during games | Cap Dota at 60 fps (`fps_max 60` in console), use NVENC/AMF/QuickSync encoding in OBS. |
