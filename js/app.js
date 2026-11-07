// Whack-a-Mole BD - DOM wiring, game loop, sounds, persistence.
// Pure-ASCII source (Bengali lives in js/i18n.js as \uXXXX escapes).
'use strict';

(function () {
  var LS_LANG = 'wam-lang';
  var LS_SOUND = 'wam-sound';
  var LS_BEST = 'wam-best';
  var LS_HISTORY = 'wam-history';
  var HISTORY_MAX = 5;

  var lang = 'en';
  try { lang = localStorage.getItem(LS_LANG) || 'en'; } catch (e) { lang = 'en'; }
  if (lang !== 'bn') lang = 'en';

  var soundOn = true;
  try { soundOn = localStorage.getItem(LS_SOUND) !== 'off'; } catch (e) { soundOn = true; }

  var selectedMode = 'classic';
  var selectedDiff = 'normal';

  var game = null;          // logic.js state
  var tickTimer = null;
  var lastTick = 0;
  var nextSpawnAt = 0;
  var pausedAt = 0;
  var audioCtx = null;

  // ------------------------------------------------------------ helpers
  function $(id) { return document.getElementById(id); }

  function t(key, vars) {
    var s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split('{' + k + '}').join(String(vars[k]));
      });
    }
    return s;
  }

  function n(num) { return fmtNum(num, lang); }

  function loadJSON(key, fallback) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full/blocked */ }
  }

  function bestKey(mode, diff) { return mode + ':' + diff; }
  function getBest(mode, diff) {
    var best = loadJSON(LS_BEST, {});
    return best[bestKey(mode, diff)] || 0;
  }
  function setBest(mode, diff, score) {
    var best = loadJSON(LS_BEST, {});
    best[bestKey(mode, diff)] = score;
    saveJSON(LS_BEST, best);
  }

  // ------------------------------------------------------------ sounds
  function ensureAudio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function tone(freq, durMs, type, vol) {
    if (!soundOn) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol || 0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + durMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durMs / 1000);
    } catch (e) { /* audio unavailable */ }
  }
  function soundHit() { tone(520, 90, 'square', 0.10); tone(780, 70, 'sine', 0.08); }
  function soundGolden() { tone(880, 80, 'sine', 0.10); setTimeout(function () { tone(1174, 90, 'sine', 0.10); }, 70); }
  function soundBomb() { tone(110, 220, 'sawtooth', 0.14); }
  function soundMiss() { tone(180, 60, 'sine', 0.05); }
  function soundGo() { tone(660, 120, 'sine', 0.10); }

  // ------------------------------------------------------------ board
  var holes = []; // index -> { btn, moleEl }

  function buildBoard() {
    var board = $('board');
    board.innerHTML = '';
    holes = [];
    for (var i = 0; i < HOLE_COUNT; i++) {
      (function (hole) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hole';
        btn.dataset.hole = String(hole);
        btn.setAttribute('aria-label', 'Hole ' + (hole + 1));
        btn.addEventListener('click', function () { onHoleClick(hole); });
        board.appendChild(btn);
        holes.push({ btn: btn, moleEl: null });
      })(i);
    }
  }

  function moleElement(type) {
    var m = document.createElement('div');
    m.className = 'mole ' + type;
    if (type === 'golden') {
      m.innerHTML = '<span class="ear left"></span><span class="ear right"></span>' +
        '<span class="star"></span>' +
        '<span class="eye left"></span><span class="eye right"></span>' +
        '<span class="snout"></span><span class="nose"></span>';
    } else if (type === 'bomb') {
      m.innerHTML = '<span class="fuse"></span><span class="spark"></span>' +
        '<span class="eye left"></span><span class="eye right"></span>';
    } else {
      m.innerHTML = '<span class="ear left"></span><span class="ear right"></span>' +
        '<span class="eye left"></span><span class="eye right"></span>' +
        '<span class="snout"></span><span class="nose"></span>';
    }
    return m;
  }

  function showMole(hole, type) {
    var slot = holes[hole];
    if (!slot || slot.moleEl) return;
    var m = moleElement(type);
    slot.btn.appendChild(m);
    slot.moleEl = m;
    // Force reflow so the pop-up transition runs.
    void m.offsetWidth;
    m.classList.add('up');
  }

  function hideMole(hole, animate) {
    var slot = holes[hole];
    if (!slot || !slot.moleEl) return;
    var m = slot.moleEl;
    slot.moleEl = null;
    if (animate) {
      m.classList.remove('up');
      m.classList.add('hit');
      setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 120);
    } else {
      if (m.parentNode) m.parentNode.removeChild(m);
    }
  }

  function clearMoles() {
    for (var i = 0; i < holes.length; i++) hideMole(i, false);
  }

  // ------------------------------------------------------------ i18n
  var TEXT_IDS = [
    'appTitle', 'appSubtitle', 'setupTitle', 'modeLabel', 'modeBlitz', 'modeClassic',
    'modeEndless', 'diffLabel', 'diffEasy', 'diffNormal', 'diffHard', 'startBtn',
    'howTitle', 'how1', 'how2', 'how3', 'how4', 'how5',
    'scoreLabel', 'timeLabel', 'livesLabel', 'comboLabel', 'bestLabel',
    'pauseBtn', 'quitBtn', 'pausedTitle', 'pausedText', 'resumeBtn',
    'gameOverTitle', 'newBest', 'hitsLabel', 'missesLabel', 'escapedLabel',
    'bombsLabel', 'maxComboLabel', 'accuracyLabel', 'playAgainBtn', 'changeSetupBtn',
    'historyTitle', 'historyEmpty', 'historyClear', 'modeBest', 'footerNote',
    'scoreLabel2'
  ];

  function applyLang() {
    document.documentElement.lang = lang === 'bn' ? 'bn' : 'en';
    TEXT_IDS.forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = t(id);
    });
    $('soundBtn').textContent = soundOn ? t('soundOn') : t('soundOff');
    $('langBtn').textContent = t('langBtn');
    updateModeBest();
    renderHistory();
    updateHUD();
  }

  // ------------------------------------------------------------ HUD
  function updateHUD() {
    if (!game) {
      $('scoreValue').textContent = n(0);
      $('timeValue').textContent = selectedMode === 'endless' ? '--' : n(MODES[selectedMode].durationSec) + t('secSuffix');
      $('livesValue').textContent = selectedMode === 'endless' ? n(MAX_LIVES) : '--';
      $('comboValue').textContent = 'x1';
      $('bestValue').textContent = n(getBest(selectedMode, selectedDiff));
      return;
    }
    $('scoreValue').textContent = n(game.score);
    if (game.timeLeftMs === null) {
      $('timeValue').textContent = '--';
    } else {
      $('timeValue').textContent = n(Math.ceil(game.timeLeftMs / 1000)) + t('secSuffix');
    }
    $('livesValue').textContent = game.lives === null ? '--' : n(game.lives);
    var mult = multiplier(game.streak);
    var comboEl = $('comboValue');
    comboEl.textContent = 'x' + n(mult);
    comboEl.classList.toggle('hot', mult >= 3);
    $('bestValue').textContent = n(Math.max(getBest(game.mode, game.difficulty), game.score));
  }

  function updateModeBest() {
    $('modeBestValue').textContent = n(getBest(selectedMode, selectedDiff));
  }

  var toastTimer = null;
  function showToast(text, kind) {
    var el = $('toast');
    el.textContent = text;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.textContent = ''; el.className = 'toast'; }, 1200);
  }

  // ------------------------------------------------------------ history
  function modeLabel(mode) {
    return mode === 'blitz' ? t('modeBlitz') : mode === 'classic' ? t('modeClassic') : t('modeEndless');
  }
  function diffLabel(diff) {
    return diff === 'easy' ? t('diffEasy') : diff === 'normal' ? t('diffNormal') : t('diffHard');
  }

  function renderHistory() {
    var list = $('historyList');
    var hist = loadJSON(LS_HISTORY, []);
    list.innerHTML = '';
    $('historyEmpty').classList.toggle('hidden', hist.length > 0);
    hist.forEach(function (h) {
      var li = document.createElement('li');
      var when = new Date(h.date);
      var dateStr = when.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
      var meta = document.createElement('span');
      meta.className = 'h-meta';
      meta.textContent = dateStr + ' - ' + modeLabel(h.mode) + ' - ' + diffLabel(h.difficulty) +
        ' - ' + t('accuracyLabel') + ' ' + n(h.accuracy) + '%';
      var score = document.createElement('span');
      score.className = 'h-score';
      score.textContent = n(h.score) + ' ' + t('pointsSuffix');
      li.appendChild(meta);
      li.appendChild(score);
      list.appendChild(li);
    });
  }

  // ------------------------------------------------------------ game flow
  function showScreen(which) {
    $('setupScreen').classList.toggle('hidden', which !== 'setup');
    $('gameScreen').classList.toggle('hidden', which !== 'game');
    $('gameOverOverlay').classList.add('hidden');
    $('pauseOverlay').classList.add('hidden');
    $('countdownOverlay').classList.add('hidden');
  }

  function startGame() {
    ensureAudio();
    game = createGame(selectedMode, selectedDiff);
    game.status = 'countdown';
    clearMoles();
    showScreen('game');
    updateHUD();
    $('toast').textContent = '';
    $('pauseBtn').textContent = t('pauseBtn');
    runCountdown();
  }

  function runCountdown() {
    var overlay = $('countdownOverlay');
    var numEl = $('countdownNum');
    overlay.classList.remove('hidden');
    var steps = ['3', '2', '1'];
    var i = 0;
    numEl.textContent = n(3);
    var iv = setInterval(function () {
      i++;
      if (i < steps.length) {
        numEl.textContent = n(Number(steps[i]));
      } else {
        clearInterval(iv);
        overlay.classList.add('hidden');
        numEl.textContent = t('countdownGo');
        overlay.classList.remove('hidden');
        soundGo();
        setTimeout(function () {
          overlay.classList.add('hidden');
          beginPlay();
        }, 450);
      }
    }, 550);
  }

  function beginPlay() {
    if (!game) return;
    game.status = 'playing';
    lastTick = Date.now();
    nextSpawnAt = lastTick + 350; // first mole comes quickly
    tickTimer = setInterval(tick, 50);
    updateHUD();
  }

  function tick() {
    if (!game || game.status !== 'playing') return;
    var now = Date.now();
    var dt = now - lastTick;
    lastTick = now;
    if (tickTime(game, dt) === 'over') { endGame(); return; }
    var expired = expire(game, now);
    expired.forEach(function (hole) { hideMole(hole, false); });
    if (game.status === 'over') { endGame(); return; } // endless lives ran out
    if (now >= nextSpawnAt) {
      var spawned = spawn(game, now, Math.random);
      if (spawned) showMole(spawned.hole, spawned.type);
      nextSpawnAt = now + nextSpawnDelayMs(game.difficulty, Math.random);
    }
    updateHUD();
  }

  function stopLoop() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function onHoleClick(hole) {
    if (!game || game.status !== 'playing') return;
    var r = whack(game, hole);
    if (r.outcome === 'hit') {
      hideMole(hole, true);
      if (r.type === 'golden') {
        soundGolden();
        showToast(t('goldenToast', { pts: n(r.points) }), 'gold');
      } else {
        soundHit();
        if (r.multiplier >= 2) showToast(t('comboToast', { mult: n(r.multiplier) }), '');
      }
    } else if (r.outcome === 'bomb') {
      hideMole(hole, true);
      soundBomb();
      showToast(t('bombToast', { pts: n(r.penalty) }), 'bad');
      if (game.status === 'over') { endGame(); return; }
    } else if (r.outcome === 'miss') {
      soundMiss();
    }
    updateHUD();
  }

  function endGame() {
    stopLoop();
    if (!game) return;
    game.status = 'over';
    clearMoles();
    var s = summary(game);
    var prevBest = getBest(game.mode, game.difficulty);
    var isNewBest = s.score > prevBest && s.score > 0;
    if (isNewBest) setBest(game.mode, game.difficulty, s.score);
    var hist = loadJSON(LS_HISTORY, []);
    hist.unshift({
      date: new Date().toISOString(),
      mode: game.mode,
      difficulty: game.difficulty,
      score: s.score,
      accuracy: s.accuracy
    });
    saveJSON(LS_HISTORY, hist.slice(0, HISTORY_MAX));

    $('gameOverTitle').textContent = game.mode === 'endless' ? t('gameOverEndless') : t('gameOverTitle');
    $('newBestBadge').classList.toggle('hidden', !isNewBest);
    $('finalScore').textContent = n(s.score);
    $('finalHits').textContent = n(s.hits);
    $('finalMisses').textContent = n(s.misses);
    $('finalEscaped').textContent = n(s.escapes);
    $('finalBombs').textContent = n(s.bombsHit);
    $('finalCombo').textContent = n(s.maxStreak);
    $('finalAccuracy').textContent = n(s.accuracy) + '%';
    $('gameOverOverlay').classList.remove('hidden');
    updateHUD();
    renderHistory();
    updateModeBest();
  }

  function pauseGame() {
    if (!game || game.status !== 'playing') return;
    game.status = 'paused';
    stopLoop();
    pausedAt = Date.now();
    $('pauseOverlay').classList.remove('hidden');
  }

  function resumeGame() {
    if (!game || game.status !== 'paused') return;
    var shift = Date.now() - pausedAt;
    nextSpawnAt += shift;
    Object.keys(game.active).forEach(function (k) { game.active[k].expiresAt += shift; });
    game.status = 'playing';
    lastTick = Date.now();
    $('pauseOverlay').classList.add('hidden');
    tickTimer = setInterval(tick, 50);
  }

  function quitToSetup() {
    stopLoop();
    game = null;
    clearMoles();
    showScreen('setup');
    updateHUD();
  }

  // ------------------------------------------------------------ wiring
  function segWire(segId, attr, setter) {
    var seg = $(segId);
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      seg.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      setter(btn.dataset[attr]);
      updateModeBest();
      updateHUD();
    });
  }

  function init() {
    buildBoard();
    segWire('modeSeg', 'mode', function (v) { selectedMode = v; });
    segWire('diffSeg', 'diff', function (v) { selectedDiff = v; });
    $('startBtn').addEventListener('click', startGame);
    $('pauseBtn').addEventListener('click', pauseGame);
    $('resumeBtn').addEventListener('click', resumeGame);
    $('quitBtn').addEventListener('click', quitToSetup);
    $('playAgainBtn').addEventListener('click', function () { startGame(); });
    $('changeSetupBtn').addEventListener('click', quitToSetup);
    $('historyClear').addEventListener('click', function () {
      if (window.confirm(t('confirmClear'))) {
        saveJSON(LS_HISTORY, []);
        renderHistory();
      }
    });
    $('soundBtn').addEventListener('click', function () {
      soundOn = !soundOn;
      try { localStorage.setItem(LS_SOUND, soundOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
      $('soundBtn').textContent = soundOn ? t('soundOn') : t('soundOff');
      if (soundOn) soundHit();
    });
    $('langBtn').addEventListener('click', function () {
      lang = lang === 'en' ? 'bn' : 'en';
      try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* ignore */ }
      applyLang();
    });
    showScreen('setup');
    applyLang();
    updateHUD();
  }

  // Test hook for the headless-Chrome smoke suite (not part of gameplay).
  window.__wam = {
    get state() { return game; },
    get lang() { return lang; },
    setLang: function (l) {
      lang = l;
      try { localStorage.setItem(LS_LANG, lang); } catch (e) { /* ignore */ }
      applyLang();
    },
    start: startGame,
    forceSpawn: function (hole, type) {
      if (!game || game.status !== 'playing') return null;
      game.active[hole] = { type: type, expiresAt: Date.now() + 60000 };
      showMole(hole, type);
      return { hole: hole, type: type };
    },
    setTimeLeft: function (ms) { if (game) game.timeLeftMs = ms; },
    clickHole: function (hole) { onHoleClick(hole); },
    pause: pauseGame,
    resume: resumeGame,
    quit: quitToSetup
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
