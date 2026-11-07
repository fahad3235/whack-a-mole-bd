# Whack-a-Mole BD - test results (factory run #262, 2026-11-07 13:00 slot)

## Unit tests - 18/18 PASS
`node --test tests/unit.test.js`
- Config: createGame validates mode/difficulty; Blitz 30,000 ms, Classic 60,000 ms, Endless null time + 3 lives.
- Multiplier: 0-2 -> x1, 3-5 -> x2, 6-8 -> x3, 9-11 -> x4, 12+ -> x5 (capped).
- pickMoleType honours golden-then-bomb chances (normal: golden < 0.08, bomb < 0.18).
- Spawn: picks a free hole, returns null when idle or all 9 holes full; up-time set from difficulty.
- nextSpawnDelayMs stays inside each difficulty's range (easy 750-1300, normal 520-950, hard 360-680).
- Whack: empty hole = miss + streak reset; normal mole +10 x multiplier; golden +50 x multiplier; combo grows (4th hit at x2, score 10+10+10+20); bomb -25, combo reset, score floors at 0; whack while idle ignored.
- Expire: timed-out moles removed, escapes reset streak, bomb escapes are free; endless escape/bomb each cost a life, 0 lives ends the game; timed modes lose no life.
- Clock: tickTime counts down and ends the game at 0 (active moles cleared); endless/idle unaffected.
- Accuracy: 3 hits / 1 miss = 75%; empty game = 0%.
- Full simulation: 10 scripted spawns+whacks in Blitz = 10 hits, score 220 (30+60+90+40), 20,000 ms left.

## Headless-Chrome smoke - 57/57 PASS
`node tests/smoke.mjs` (raw CDP, headless_shell-1187, file://)
- Renders: title "Whack-a-Mole BD", 9 holes, setup visible / game hidden, 3 mode + 3 difficulty buttons, how-to, empty history state, offline-toy-game footer.
- Language: BN toggle renders Bengali title + start button + Bengali digit 0 in HUD; back to EN; lang persists in localStorage.
- Gameplay (Blitz 30s): countdown -> playing; timeLeft counts down from 30,000; normal mole in hole 4 visible then whacked -> score 10, HUD 10, hits 1; empty hole -> miss, streak 0; golden mole -> score 60 + Golden toast; 3 more normal hits -> combo x2 in HUD, score 100 (10+50+10+10+20); bomb -> score 75, bombsHit 1, Bomb toast.
- Pause/resume: paused status + overlay; clock frozen for 600 ms; resumed, clock runs again.
- Game over: setTimeLeft(300) -> over + overlay; final score 75, hits 5, accuracy 83% (5/6); new-best badge; best 75 saved under blitz:normal; history 1 entry showing 75.
- Persistence: reload keeps best 75 + history 1 entry.
- Play again -> fresh playing game, score 0; quit returns to setup.
- Endless: 3 lives, HUD 3, time "--"; bomb costs a life (2 left).
- Mobile 390px: no horizontal overflow, board fits.
- 0 page errors, 0 console errors, 0 failed requests.

## Repairs
- 1 test-side fix only: the `window.__wam.setLang` test hook did not persist to localStorage (the real language button does) - hook updated to save, smoke re-run green. 0 app-logic bugs found by tests.
