// Whack-a-Mole BD - unit tests for js/logic.js (pure logic, no DOM).
// Run: node --test tests/unit.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/logic.js');

// Deterministic rng helpers.
const rngOf = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const rngZero = () => 0; // always picks hole 0 / type golden (r < goldenChance)
const rngHigh = () => 0.999; // always picks last free hole / type normal

function playingGame(mode = 'classic', difficulty = 'normal') {
  const g = L.createGame(mode, difficulty);
  g.status = 'playing';
  return g;
}

// ------------------------------------------------------------------ config
test('createGame validates mode and difficulty', () => {
  assert.throws(() => L.createGame('nope', 'normal'), /unknown mode/);
  assert.throws(() => L.createGame('classic', 'nope'), /unknown difficulty/);
  const g = L.createGame('blitz', 'easy');
  assert.equal(g.status, 'idle');
  assert.equal(g.timeLeftMs, 30000);
  assert.equal(g.lives, null);
  const e = L.createGame('endless', 'hard');
  assert.equal(e.timeLeftMs, null);
  assert.equal(e.lives, 3);
  assert.equal(L.createGame('classic', 'normal').timeLeftMs, 60000);
});

test('multiplier steps every 3 hits and caps at x5', () => {
  assert.equal(L.multiplier(0), 1);
  assert.equal(L.multiplier(2), 1);
  assert.equal(L.multiplier(3), 2);
  assert.equal(L.multiplier(5), 2);
  assert.equal(L.multiplier(6), 3);
  assert.equal(L.multiplier(9), 4);
  assert.equal(L.multiplier(12), 5);
  assert.equal(L.multiplier(99), 5);
});

// ------------------------------------------------------------------ spawn
test('pickMoleType honours golden then bomb chances', () => {
  // normal: golden 0.08, bomb 0.10 -> golden < 0.08, bomb < 0.18, else normal.
  assert.equal(L.pickMoleType('normal', () => 0.0), 'golden');
  assert.equal(L.pickMoleType('normal', () => 0.079), 'golden');
  assert.equal(L.pickMoleType('normal', () => 0.08), 'bomb');
  assert.equal(L.pickMoleType('normal', () => 0.179), 'bomb');
  assert.equal(L.pickMoleType('normal', () => 0.18), 'normal');
  assert.equal(L.pickMoleType('normal', () => 0.99), 'normal');
});

test('spawn picks a free hole, returns null when idle or full', () => {
  const g = L.createGame('classic', 'normal');
  assert.equal(L.spawn(g, 1000, rngZero), null); // idle
  g.status = 'playing';
  const s = L.spawn(g, 1000, rngZero);
  assert.equal(s.hole, 0);
  assert.equal(s.type, 'golden');
  assert.equal(g.active[0].expiresAt, 1000 + L.DIFFICULTIES.normal.upTimeMs);
  assert.equal(L.activeCount(g), 1);
  assert.equal(L.freeHoles(g).length, 8);
  // Fill all 9 holes.
  for (let i = 0; i < 8; i++) L.spawn(g, 1000, rngHigh);
  assert.equal(L.activeCount(g), 9);
  assert.equal(L.spawn(g, 1000, rngZero), null);
});

test('nextSpawnDelayMs stays inside the difficulty range', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const d = L.DIFFICULTIES[diff];
    assert.ok(L.nextSpawnDelayMs(diff, () => 0) >= d.spawnMinMs);
    assert.ok(L.nextSpawnDelayMs(diff, () => 0.999) <= d.spawnMaxMs);
    assert.equal(L.nextSpawnDelayMs(diff, () => 0), d.spawnMinMs);
  }
});

// ------------------------------------------------------------------ whack
test('whacking an empty hole is a miss and resets the streak', () => {
  const g = playingGame();
  g.streak = 4;
  g.maxStreak = 4;
  const r = L.whack(g, 3);
  assert.equal(r.outcome, 'miss');
  assert.equal(g.misses, 1);
  assert.equal(g.streak, 0);
  assert.equal(g.maxStreak, 4);
  assert.equal(g.score, 0);
});

test('whacking a normal mole scores 10 x current multiplier', () => {
  const g = playingGame();
  g.active[2] = { type: 'normal', expiresAt: 99999 };
  const r = L.whack(g, 2);
  assert.deepEqual(r, { outcome: 'hit', type: 'normal', points: 10, multiplier: 1, streak: 1 });
  assert.equal(g.score, 10);
  assert.equal(g.hits, 1);
  assert.equal(g.streak, 1);
  assert.equal(g.maxStreak, 1);
  assert.equal(L.activeCount(g), 0);
});

test('combo multiplier grows with the streak', () => {
  const g = playingGame();
  // 3 hits at x1, 4th hit at x2 (streak 3 -> multiplier 2).
  let last;
  for (let i = 0; i < 4; i++) {
    g.active[i] = { type: 'normal', expiresAt: 99999 };
    last = L.whack(g, i);
  }
  assert.equal(last.multiplier, 2);
  assert.equal(last.points, 20);
  assert.equal(g.score, 10 + 10 + 10 + 20);
  assert.equal(g.maxStreak, 4);
});

test('golden mole scores 50 x multiplier', () => {
  const g = playingGame();
  g.active[5] = { type: 'golden', expiresAt: 99999 };
  const r = L.whack(g, 5);
  assert.equal(r.outcome, 'hit');
  assert.equal(r.type, 'golden');
  assert.equal(r.points, 50);
  assert.equal(g.score, 50);
});

test('bomb costs 25, breaks the combo, never goes below zero', () => {
  const g = playingGame();
  g.score = 30;
  g.streak = 7;
  g.active[1] = { type: 'bomb', expiresAt: 99999 };
  const r = L.whack(g, 1);
  assert.equal(r.outcome, 'bomb');
  assert.equal(r.penalty, 25);
  assert.equal(g.score, 5);
  assert.equal(g.streak, 0);
  assert.equal(g.bombsHit, 1);
  assert.equal(g.hits, 0);
  // Score floors at 0.
  g.active[4] = { type: 'bomb', expiresAt: 99999 };
  L.whack(g, 4);
  assert.equal(g.score, 0);
  assert.equal(g.bombsHit, 2);
});

test('whack while not playing is ignored', () => {
  const g = L.createGame('classic', 'normal'); // idle
  g.active[0] = { type: 'normal', expiresAt: 99999 };
  assert.equal(L.whack(g, 0).outcome, 'ignored');
  assert.equal(g.hits, 0);
  assert.equal(L.activeCount(g), 1);
});

// ------------------------------------------------------------------ expire
test('expire removes timed-out moles, escapes reset streak', () => {
  const g = playingGame();
  g.streak = 5;
  g.active[0] = { type: 'normal', expiresAt: 1000 };
  g.active[1] = { type: 'bomb', expiresAt: 1000 };
  g.active[2] = { type: 'golden', expiresAt: 5000 };
  const expired = L.expire(g, 1000);
  assert.deepEqual(expired.sort(), [0, 1]);
  assert.equal(g.escapes, 1); // bomb escape is free
  assert.equal(g.streak, 0);
  assert.equal(L.activeCount(g), 1); // golden still up
  assert.deepEqual(L.expire(g, 1001), []);
});

test('endless: escaped mole and bomb each cost a life; 0 lives ends game', () => {
  const g = playingGame('endless', 'easy');
  g.active[0] = { type: 'normal', expiresAt: 1000 };
  L.expire(g, 1000);
  assert.equal(g.lives, 2);
  assert.equal(g.status, 'playing');
  g.active[3] = { type: 'bomb', expiresAt: 99999 };
  const r = L.whack(g, 3);
  assert.equal(r.outcome, 'bomb');
  assert.equal(g.lives, 1);
  g.active[4] = { type: 'normal', expiresAt: 2000 };
  L.expire(g, 2000);
  assert.equal(g.lives, 0);
  assert.equal(g.status, 'over');
});

test('timed modes: escape costs no life (lives stay null)', () => {
  const g = playingGame('classic', 'easy');
  g.active[0] = { type: 'normal', expiresAt: 1000 };
  L.expire(g, 1000);
  assert.equal(g.lives, null);
  assert.equal(g.status, 'playing');
});

// ------------------------------------------------------------------ clock
test('tickTime counts down and ends the game at zero', () => {
  const g = playingGame('blitz', 'normal');
  assert.equal(L.tickTime(g, 10000), 'playing');
  assert.equal(g.timeLeftMs, 20000);
  assert.equal(L.tickTime(g, 20000), 'over');
  assert.equal(g.timeLeftMs, 0);
  assert.equal(g.status, 'over');
  assert.deepEqual(g.active, {});
});

test('tickTime does nothing in endless or when not playing', () => {
  const g = playingGame('endless', 'normal');
  assert.equal(L.tickTime(g, 60000), 'playing');
  const idle = L.createGame('classic', 'normal');
  assert.equal(L.tickTime(idle, 5000), 'idle');
  assert.equal(idle.timeLeftMs, 60000);
});

// ------------------------------------------------------------------ summary
test('accuracy and summary', () => {
  const g = playingGame();
  assert.equal(L.accuracy(g), 0);
  g.hits = 3;
  g.misses = 1;
  assert.equal(L.accuracy(g), 75);
  g.score = 120;
  g.maxStreak = 6;
  const s = L.summary(g);
  assert.equal(s.score, 120);
  assert.equal(s.accuracy, 75);
  assert.equal(s.maxStreak, 6);
  assert.equal(s.mode, 'classic');
  assert.equal(s.difficulty, 'normal');
});

test('full 30s blitz simulation stays consistent', () => {
  // Scripted game: spawn+whack a normal mole every second for 10s.
  const g = playingGame('blitz', 'easy');
  let now = 0;
  let spawned = 0;
  for (let t = 0; t < 10; t++) {
    const s = L.spawn(g, now, rngOf(0.5, 0.5)); // hole 4, normal
    assert.ok(s, 'spawn ' + t);
    spawned++;
    const r = L.whack(g, s.hole);
    assert.equal(r.outcome, 'hit');
    L.tickTime(g, 1000);
    now += 1000;
  }
  assert.equal(spawned, 10);
  assert.equal(g.hits, 10);
  assert.equal(g.misses, 0);
  assert.equal(g.escapes, 0);
  // 10 hits: streaks 0-2 at x1 (30), 3-5 at x2 (60), 6-8 at x3 (90), 9 at x4 (40).
  assert.equal(g.score, 30 + 60 + 90 + 40);
  assert.equal(g.timeLeftMs, 20000);
  assert.equal(g.status, 'playing');
});
