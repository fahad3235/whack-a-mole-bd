# Whack-a-Mole BD

A free, fully offline bilingual (Bangla/English) Whack-a-Mole arcade game for Bangladesh. Moles pop out of nine holes — whack them for points, grab the rare golden mole for a bonus, and never touch a bomb.

> **হোয়াক-এ-মোল বিডি** — সম্পূর্ণ অফলাইন, বাংলা/ইংরেজি দ্বিভাষিক মোল ধরার খেলা। গর্ত থেকে মোল বের হবে — ধরতে ট্যাপ করুন, সোনালি মোল ধরলে বোনাস, আর বোমায় কখনো হাত দেবেন না।

## Features

- **3 game modes** — Blitz (30 seconds), Classic (60 seconds), Endless (3 lives; an escaped mole or a bomb costs a life)
- **3 difficulty levels** — Easy, Normal, Hard (spawn speed, mole up-time, and bomb frequency all scale)
- **3 mole types** — Normal mole (+10 points), Golden mole (+50 points, rare and quick), Bomb (−25 points, breaks your combo)
- **Combo multiplier** — consecutive hits build a multiplier up to ×5 (every 3 hits raises it a step)
- **Best scores** — best score saved separately per mode + difficulty
- **Recent games** — last 5 results with mode, difficulty, score, and accuracy; clearable
- **Pause / resume** — game clock and mole timers freeze exactly while paused
- **WebAudio sound effects** — pop, golden chime, bomb thud, and miss click, with a mute toggle (no audio files)
- **Bilingual UI** — full English / বাংলা toggle, persisted, with Bengali digits (০–৯)
- **Mobile-friendly** — 3×3 board fits a 390px phone, large tap targets, no horizontal overflow
- **Zero network requests** — works fully offline; scores live only in your browser's localStorage

## How to play

1. Pick a mode and a difficulty, then press **Start game**.
2. After the 3-2-1 countdown, moles start popping out of the holes.
3. Tap (or click) a mole to whack it. Tapping an empty hole counts as a miss and breaks your combo.
4. Golden moles are worth +50 but disappear fast. Bombs cost −25 points — let them sink back down.
5. In Endless mode you have 3 lives: a mole that escapes unwhacked or a bomb you hit each costs one life.

## Scoring

| Event | Points |
|---|---|
| Normal mole | +10 × combo multiplier |
| Golden mole | +50 × combo multiplier |
| Bomb | −25 (score never goes below 0) |
| Empty-hole tap | 0, combo resets |
| Mole escapes | 0, combo resets (and −1 life in Endless) |

Combo multiplier: ×1 for streaks 0–2, ×2 for 3–5, ×3 for 6–8, ×4 for 9–11, ×5 for 12+.

## Tech stack

- Plain HTML + CSS + JavaScript — no frameworks, no build step, no dependencies
- Game rules in `js/logic.js` (pure, DOM-free, unit-tested with Node's built-in test runner)
- UI strings in `js/i18n.js` (English + Bengali stored as `\uXXXX` escapes, so app sources stay pure ASCII)
- Sounds generated with the WebAudio API — no audio assets

## Project structure

```
whack-a-mole-bd/
├── index.html          # Setup screen, game board, overlays, history
├── style.css           # Green-field theme, CSS-drawn moles, responsive layout
├── js/
│   ├── logic.js        # Pure game rules (spawn, whack, combo, clock, lives)
│   ├── i18n.js         # EN + BN strings, Bengali digit formatting
│   └── app.js          # DOM wiring, game loop, sounds, localStorage
└── tests/
    ├── unit.test.js    # 18 Node unit tests for js/logic.js
    └── smoke.mjs       # 57 headless-Chrome checks (raw CDP, local QA only)
```

## Run locally

```bash
# Any static server works, or just open the file:
open index.html
# or
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Testing

```bash
node --test tests/unit.test.js   # 18/18 unit tests
node tests/smoke.mjs             # 57/57 headless-Chrome smoke checks
```

The smoke suite drives the real page in headless Chrome (raw CDP): rendering, language toggle with Bengali digits, a scripted Blitz game (normal +10, golden +50, combo ×2, bomb −25, pause/resume clock freeze, game-over stats, best-score and history persistence across reload), an Endless lives check, and a 390px mobile layout check — with 0 console/page errors and 0 failed requests.

## Limitations

- Scores and history live only in the current browser's localStorage — clearing browser data erases them.
- Sound needs a user gesture first (browser autoplay policy); the first tap enables it.
- This is a toy arcade game, not a reaction-time measurement tool — mole timing is randomised by design.

## Status

Factory run #262 (2026-11-07, 13:00 slot). Complete and verified: 18/18 unit tests + 57/57 smoke checks green, published and live on GitHub Pages.

## License

MIT — free to use, copy, and modify.
