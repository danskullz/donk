# Content changelog

One entry per change to the data files. A map's `revision` goes up when its callouts change; its `gameBuild` is the Counter-Strike 2 build the radar, projection and screenshots were taken from.

## 2026-11-01

- `index.json`: the ten maps of SCOPE §3.1 for the Home map picker. Only Mirage is `available`; the rest show as "coming". Pools are as in SCOPE §3.1 (the extras are unverified against FACEIT; that check was dropped).
- `maps/de_mirage.json` (revision 1, `draft`): the projection (`posX -3230`, `posY 1713`, `scale 5`), the radar size and the game build `26144732` are the real values read from the game files in Phase 0 (`assets/valve/overviews/overviews.json`). **The five zones are a proposal** (T Spawn, Mid, A Site, B Site, CT Spawn), chosen as the tabs of the Map screen; Dan to confirm or change them when the callouts are painted.
- `callouts/de_mirage.json`: empty. Regions come from painting the nav mesh in the Editor (SCOPE §8.3) and names from the in-game review pass (SCOPE §3.3); nothing here is invented.
