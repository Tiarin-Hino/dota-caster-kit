# Stream Deck, Companion and hotkeys

Every panel button is an HTTP GET. The *Hotkeys & Stream Deck* tab lists them with copy buttons.

| Action | URL (`http://127.0.0.1:58900` + …) |
|---|---|
| Save replay buffer | `/api/action/capture` |
| Replay last 10 / 20 / 30 s | `/api/action/show?last=10` (any number) |
| Replay whole clip | `/api/action/show?last=full` |
| Slower / normal / faster | `/api/action/slower`, `/normal`, `/faster` (0.25× – 2×) |
| Back to live | `/api/action/live` |
| Post-game screen | `/api/action/postgame?screen=board` (`mvp`, `player`, `compare`, `graph`, `leaders`, `off`) |
| Switch scene | `/api/action/scene?name=between` (`draft`, `game`, `postgame`, `replay`, `between`, or any scene name) |
| Toggle auto scenes | `/api/action/auto` |
| Archive highlight reel now | `/api/action/archive` |

Answers are JSON: `{"ok":true,"message":"…"}` or `{"ok":false,"error":"…"}`.

## Elgato Stream Deck
Action *System → Website*, paste the URL, tick **GET request in background**.

## Bitfocus Companion
*Generic HTTP* module → action *GET*, URL as above.

## AutoHotkey v2
```ahk
F13:: Download("http://127.0.0.1:58900/api/action/capture", A_Temp "\dck.txt")
F14:: Download("http://127.0.0.1:58900/api/action/show?last=20", A_Temp "\dck.txt")
F15:: Download("http://127.0.0.1:58900/api/action/live", A_Temp "\dck.txt")
```

## Keypads with their own software (Razer, Logitech G, …)
Bind a macro to a key combination your streaming app doesn't use, then map that combination in AutoHotkey as above.

## Typical replay flow
1. Something happens → **Capture** (or it is auto-captured: multi-kills, fights with 4+ kills).
2. **Last 20 s** → replay scene, plays, returns to the game scene by itself.
3. **Slower** for the key moment, **Back to live** to cut early.
