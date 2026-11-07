// Whack-a-Mole BD - pure game logic (no DOM). Node-testable.
// Timed arcade game: moles pop out of 9 holes, whack them for points.
// Normal mole +10, golden mole +50 (rare, faster), bomb -25 and breaks the
// combo (never whack a bomb). Consecutive hits build a combo multiplier
// (x1 up to x5). Modes: Blitz 30s, Classic 60s, Endless (3 lives; an
// escaped mole or a bomb costs a life).
'use strict';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HOLE_COUNT = 9;

const MODES = {
  blitz: { durationSec: 30, label: 'Blitz 30s' },
  classic: { durationSec: 60, label: 'Classic 60s' },
  endless: { durationSec: null, label: 'Endless' },
};

const DIFFICULTIES = {
  easy: { spawnMinMs: 750, spawnMaxMs: 1300, upTimeMs: 1500, goldenChance: 0.08, bombChance: 0.06 },
  normal: { spawnMinMs: 520, spawnMaxMs: 950, upTimeMs: 1150, goldenChance: 0.08, bombChance: 0.10 },
  hard: { spawnMinMs: 360, spawnMaxMs: 680, upTimeMs: 900, goldenChance: 0.10, bombChance: 0.14 },
};

const POINTS = { normal: 10, golden: 50 };
const BOMB_PENALTY = 25;
const MAX_LIVES = 3;
const MAX_MULTIPLIER = 5;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function createGame(mode, difficulty) {
  if (!MODES[mode]) throw new Error('unknown mode: ' + mode);
  if (!DIFFICULTIES[difficulty]) throw new Error('unknown difficulty: ' + difficulty);
  return {
    mode,
    difficulty,
    status: 'idle', // idle | countdown | playing | paused | over
    score: 0,
    hits: 0,
    misses: 0,
    escapes: 0,
    bombsHit: 0,
    streak: 0,
    maxStreak: 0,
    lives: mode === 'endless' ? MAX_LIVES : null,
    timeLeftMs: MODES[mode].durationSec === null ? null : MODES[mode].durationSec * 1000,
    // active moles: hole index -> { type: 'normal'|'golden'|'bomb', expiresAt: ms }
    active: {},
  };
}

// Combo multiplier: +1 step every 3 consecutive hits, capped at x5.
// multiplier(0..2)=1, (3..5)=2, (6..8)=3, (9..11)=4, (12+)=5.
function multiplier(streak) {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / 3));
}

function activeCount(state) {
  return Object.keys(state.active).length;
}

function freeHoles(state) {
  const free = [];
  for (let h = 0; h < HOLE_COUNT; h++) {
    if (!state.active[h]) free.push(h);
  }
  return free;
}

// Pick a mole type from the difficulty's chances.
// rng: () => [0, 1). golden first, then bomb, else normal.
function pickMoleType(difficulty, rng) {
  const d = DIFFICULTIES[difficulty];
  const r = rng();
  if (r < d.goldenChance) return 'golden';
  if (r < d.goldenChance + d.bombChance) return 'bomb';
  return 'normal';
}

// Spawn one mole in a random free hole. Returns { hole, type } or null when
// the game is not playing or every hole is occupied.
// now: current timestamp in ms (caller clock).
function spawn(state, now, rng) {
  if (state.status !== 'playing') return null;
  const free = freeHoles(state);
  if (free.length === 0) return null;
  const hole = free[Math.floor(rng() * free.length)];
  const type = pickMoleType(state.difficulty, rng);
  const upTime = DIFFICULTIES[state.difficulty].upTimeMs;
  state.active[hole] = { type, expiresAt: now + upTime };
  return { hole, type };
}

// Next spawn delay in ms for the difficulty (random in range).
function nextSpawnDelayMs(difficulty, rng) {
  const d = DIFFICULTIES[difficulty];
  return d.spawnMinMs + rng() * (d.spawnMaxMs - d.spawnMinMs);
}

// Whack a hole. Returns a result object describing what happened.
// - empty hole: a miss (streak resets, misses++).
// - normal/golden mole: a hit, points = base * multiplier(streak before hit).
// - bomb: penalty, streak resets, bombsHit++, lives-- in Endless.
function whack(state, hole) {
  if (state.status !== 'playing') return { outcome: 'ignored' };
  const mole = state.active[hole];
  if (!mole) {
    state.misses += 1;
    state.streak = 0;
    return { outcome: 'miss' };
  }
  delete state.active[hole];
  if (mole.type === 'bomb') {
    state.bombsHit += 1;
    state.streak = 0;
    state.score = Math.max(0, state.score - BOMB_PENALTY);
    if (state.mode === 'endless') {
      state.lives -= 1;
      if (state.lives <= 0) state.status = 'over';
    }
    return { outcome: 'bomb', penalty: BOMB_PENALTY, lives: state.lives };
  }
  const mult = multiplier(state.streak);
  const points = POINTS[mole.type] * mult;
  state.score += points;
  state.hits += 1;
  state.streak += 1;
  if (state.streak > state.maxStreak) state.maxStreak = state.streak;
  return { outcome: 'hit', type: mole.type, points, multiplier: mult, streak: state.streak };
}

// Expire moles whose up-time has passed. Escaped moles reset the streak and
// cost a life in Endless. Returns the list of expired holes.
function expire(state, now) {
  const expired = [];
  for (const key of Object.keys(state.active)) {
    const mole = state.active[key];
    if (now >= mole.expiresAt) {
      const hole = Number(key);
      expired.push(hole);
      delete state.active[key];
      if (mole.type !== 'bomb') {
        // Letting a bomb sink back down is fine - no penalty.
        state.escapes += 1;
        state.streak = 0;
        if (state.mode === 'endless') {
          state.lives -= 1;
          if (state.lives <= 0) state.status = 'over';
        }
      }
    }
  }
  return expired;
}

// Advance the game clock for timed modes. Returns 'over' when time runs out.
function tickTime(state, dtMs) {
  if (state.status !== 'playing') return state.status;
  if (state.timeLeftMs === null) return 'playing';
  state.timeLeftMs -= dtMs;
  if (state.timeLeftMs <= 0) {
    state.timeLeftMs = 0;
    state.status = 'over';
    state.active = {};
    return 'over';
  }
  return 'playing';
}

function accuracy(state) {
  const total = state.hits + state.misses;
  if (total === 0) return 0;
  return Math.round((state.hits / total) * 100);
}

function summary(state) {
  return {
    mode: state.mode,
    difficulty: state.difficulty,
    score: state.score,
    hits: state.hits,
    misses: state.misses,
    escapes: state.escapes,
    bombsHit: state.bombsHit,
    maxStreak: state.maxStreak,
    accuracy: accuracy(state),
    timeLeftMs: state.timeLeftMs,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HOLE_COUNT,
    MODES,
    DIFFICULTIES,
    POINTS,
    BOMB_PENALTY,
    MAX_LIVES,
    MAX_MULTIPLIER,
    createGame,
    multiplier,
    activeCount,
    freeHoles,
    pickMoleType,
    spawn,
    nextSpawnDelayMs,
    whack,
    expire,
    tickTime,
    accuracy,
    summary,
  };
}
