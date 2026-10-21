# Notes for AI assistants and contributors

Dota Caster Kit: one Node app (`app/server.js`, no npm deps) + browser-source overlays + a control panel. Read CONTRIBUTING.md for the layout. These are lessons from live broadcasts (Rumble in the Jungle VI) – don't regress them.

## Dota GSI
1. Dota sends all 10 players only while **spectating / casting / watching a replay**. Playing sends only yourself.
2. GSI config changes need a **Dota restart** and the `-gamestateintegration` launch option.
3. Dota sends **2–3 game states back to back** (HERO_SELECTION→STRATEGY_TIME, WAIT_FOR_MAP→PRE_GAME→GAME_IN_PROGRESS). Act on phases (draft/game/post), not raw states.
4. **Ignore the first phase the app sees** – it may start mid-game; jumping scenes then is wrong.
5. The winner can arrive while the state is still GAME_IN_PROGRESS; POST_GAME follows. `finalize` is idempotent per match id.
6. Kill counters go **down** when a replay is rewound – reset highlight tracking, don't emit.

## Ability Draft
7. **GSI ability lists are shuffled between players while spectating** (slot N carries someone else's abilities). Never show them as a player's draft. The real picks come from Ability Draft Plus (AD+), matched **by hero**, then by name.
8. AD+ often has **no player names** while spectating → names come from GSI by hero, else by seat (lobby seat order = draft order).
9. AD+ marks picked hero models only when *playing*; while spectating, the picked hero comes from GSI.
10. Hero models add an **innate ability** (`<hero>_*`, non-ultimate). When filling gaps from GSI lists, drop those.
11. Ignore an AD+ snapshot where fewer than 3 players match – it belongs to another game.

## Replays
12. Browsers can't play **MKV**. The replay buffer must save MP4; the panel warns per clip.
13. A saved replay file keeps growing for a moment – wait until its size is stable before using it.
14. "Show last N s" = seek to `duration − N`; the replay overlay returns to the game scene on `ended`.
15. Auto-capture saves the buffer when a fight closes (8 s without kills); the next new file within 15 s gets the highlight label.
16. Archive on draft: move reel clips to `Highlights/<date> <teams>/` (fall back to copy+delete across drives).

## Overlays / OBS
17. Overlays **poll** `/api/state` (400 ms). Long-lived connections from several browser sources hit the per-host connection limit and pages stop loading.
18. A panel iframe whose `color-scheme` differs from the panel is painted opaque white – iframes in the panel get `color-scheme: normal`.
19. Don't take screenshots or request screen access on the streaming PC while live (it can hide the game window → black capture).
20. Uncapped Dota starves the encoder → cap Dota at 60 fps.
21. After copying files to another PC, compare checksums – one copy once delivered the previous version.

## Data
- `data/settings.json` – everything the panel edits. `data/matches/<matchId>.json` – one per finished game, with `teams` by side at the time it was played. `data/clips.json` – clip index. `data/uploads/` – user images (per theme; team logos in `teams/`).
- Player key in the API: `<r|d><slot>` (e.g. `r0`, `d4`).
