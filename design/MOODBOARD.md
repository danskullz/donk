# Design spike: references, directions, decision

*2026-10-28. Process follows SCOPE.md §6.6: references first, three directions, a decision with written reasons, tokens, then static comps with real content.*

## What I looked at

Opened live in the built-in browser, with measurements taken from the pages themselves:

| Reference | Measured | Principle taken | What to avoid |
|---|---|---|---|
| **Lichess puzzles** | page `hsl(37° 10% 8%)` (a *warm* near-black), text `#bababa` (not white), Noto Sans 13.6 px, `border-radius: 0`, header 60 px, blue `#3692e7` + burnt orange `#d64f00` | Warm dark, never pure black. Text never pure white. Square corners. Small, dense type. The board is the hero and the chrome stays quiet | The page scrolls (971 px tall in a 768 px window). Ours cannot |
| **Monkeytype** | whole theme is six colours: `bg #323437`, `sub-alt #2c2e31`, `sub #646669`, `text #d1d0c5`, `main #e2b714`, `error #ca4754`; one monospace face; page height equals viewport (768 in 768) | A tiny token set. One accent, used sparingly. Mono for everything. A true one-viewport app | A cookie banner over the first screen. Its `sub` grey is far below readable contrast (about 2.7:1) |
| **Seterra** (GeoGuessr) | blue gradient backdrop, glossy green "Start quiz" pill, rounded everything | An explicit mode switcher (Pin / Type / More) with icons | Gradient, gloss and pills: nearly the whole §6.1 banned list in one screen |
| **CS2's own HUD** (from our capture, `assets/valve/capture/run1/shot_01…`) | radar disc, location label under it reading "Connector", large condensed numerals, white text with a soft shadow | The **location-label idiom**: a place name set under a position | Copying the HUD itself: the learner stares at it all day, and it is not a place to study |

Read but not opened (named in SCOPE.md §6.7): swisstopo topographic maps (label halos), the US National Park Service *Unigrid* system, Harry Beck's Underground diagram, the Game UI Database and Interface In Game.

## Three directions, same content

The same "Name it" reveal in three styles: `directions.html` (render: `directions.png`, kept local because it contains Valve imagery).

- **A. Survey sheet.** Hairline rules, framed plates with corner marks and mono captions, condensed caps, a chartreuse "highlighter". Built out as full comps first; archived in `archive-a/`.
- **B. Broadcast overlay.** CS2-HUD language: heavy italic numerals, team colour bars, cut corners, a round radar, the answer laid over the screenshot.
- **C. Terminal.** Monkeytype-like: one monospace face, six tokens, almost no chrome, lowercase, keyboard hints inline.

## Decision: C (Dan's choice, confirmed 2026-10-28)

My own comparison favoured A. I expected C to leave the two things that carry the learning, the screenshot and the map, small and anonymous, with every element at the same visual weight, and I was less sure of mono for the one-line blurbs. Dan preferred C after seeing A built out, so C is the direction. Those two risks were designed against instead of ignored:

- **Media get the room.** In the comps the screenshot is about 750 px wide at 1280×720 (it was about 350 px in the comparison sheet), and the map fills its column.
- **Hierarchy comes from size, weight and the one accent.** The answer is large and set in the accent colour; everything around it is small and muted.
- **Blurbs are short** (120 characters, enforced by the validator in SCOPE.md §5.3), so mono prose is not a reading-speed problem. Revisit if longer text appears.

**B was dropped** because its name plate covers the bottom-left of the screenshot (the part being tested), its round radar crops the map, and it duplicates the game's own interface.

## Principles written down

1. Warm near-black, never pure black; text never pure white (Lichess).
2. One monospace face for everything. Square corners (2 px at most).
3. Six core colours (`bg`, `surface`, `sub`, `text`, `main`, `error`). One accent, chartreuse, carries primary action, "correct" and mastery. The error colour marks a wrong answer and is always paired with an icon or strike-through. CT blue and T amber exist for sides only.
4. Structure comes from spacing and flat surfaces, not frames. Hairlines only where a divider is needed.
5. Labels are lowercase and literal. Key hints are bracketed and inline (`[space] continue`), the selected row carries a `>` marker, the wordmark is `callouts_`. Decorative punctuation has empty alt text so screen readers skip it.
6. Map labels carry a dark halo so they stay legible over any fill.
7. Every screen is a CSS grid with `fr` rows and `overflow: hidden` on the shell, so it cannot scroll (SCOPE.md §5.3).
8. Real content in every comp: real screenshots, real nav-mesh map art, Valve's own thumbnails.

## Contrast (checked)

| Token | on `bg` | on `surface` | Note |
|---|---|---|---|
| `text` `#d1d0c5` | 10.9 | 9.8 | |
| `sub` `#9a9da1` | 6.2 | 5.6 | raised twice: the comparison sheet's `#6c6e72` was 3.3, and `#93969a` was 4.49 on the hover surface (4.9 now) |
| `main` `#c8e04a` | 11.4 | 10.3 | text on `main` uses `#1c1d1f`, 11.4 |
| `error` `#e0705f` | 5.3 | 4.8 | |
| `rule-strong` `#6f7378` (outlines) | 3.5 | 3.2 | meets the 3:1 non-text rule |

Map labels over the brightest mastery fills rely on their dark halo, not on text-to-fill contrast.

## Follow-ups (2026-11-01)

The first three comps (Home, Session, Map) were not enough to call the look settled, so the screens that stress it hardest were added in the same direction: the question (multiple choice and typed), Pin it, the Hard-mode map and a states sheet, each with a long-content twin. What they settled:

- **States.** Hover and pressed change colour only, in 90 ms, with no movement; focus is a 2 px lime ring; correct and wrong rows use a mark, a left bar and a strike-through as well as colour. One accent is still the only filled control.
- **Multiple choice is a list of rows, not a 2 × 2 grid.** Rows hold a 28-character name on one line, and the numbered rows read like a terminal menu.
- **The screenshot gets the room on the question screen** (about 840 px wide at 1280 × 720). The answer panel stays narrow.
- **The selected outline is a lime line with a dark band on both sides**, because lime on a Known (olive) region measured 2.0:1.
- **Phones are chosen by aspect ratio**, not by width alone, so a phone on its side gets the compressed desktop layout.
- Accessibility measurements and fixes are in `A11Y.md`.

