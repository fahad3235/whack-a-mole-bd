// Whack-a-Mole BD smoke tests - headless-Chrome QA harness.
// Raw CDP over the stock Playwright headless_shell binary.
// Run: node tests/smoke.mjs (requires the headless_shell binary path below)
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1187/chrome-linux/headless_shell';
const PORT = 9341;
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PAGE = 'file://' + path.resolve(DIR, '..', 'index.html');

const proc = spawn(BIN, [
  '--headless', '--no-sandbox', '--disable-gpu',
  '--remote-debugging-port=' + PORT, '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

async function waitForVersion(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
      if (r.ok) return await r.json();
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('CDP did not come up');
}

let seq = 0;
const pending = new Map();
let ws;
const pageErrors = [];
const consoleErrors = [];
const failedRequests = [];

function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 15000);
  });
}
async function ev(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) throw new Error('page eval threw: ' + JSON.stringify(res.exceptionDetails));
  return res.result.value;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0;
function check(name, cond, extra = '') {
  if (!cond) throw new Error('FAIL: ' + name + ' ' + extra);
  passed++;
  console.log('ok - ' + name);
}

try {
  await waitForVersion();
  const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(PAGE), { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await once(ws, 'open');
  ws.addEventListener('message', (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      pageErrors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push(JSON.stringify(m.params.args).slice(0, 300));
    } else if (m.method === 'Network.loadingFailed') {
      failedRequests.push(JSON.stringify(m.params).slice(0, 200));
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await sleep(1200);

  // ---------------------------------------------------------- render
  check('title', (await ev(`document.title`)) === 'Whack-a-Mole BD');
  check('9 holes render', (await ev(`document.querySelectorAll('.hole').length`)) === 9);
  check('setup visible, game hidden', (await ev(`!document.getElementById('setupScreen').classList.contains('hidden') && document.getElementById('gameScreen').classList.contains('hidden')`)) === true);
  check('mode buttons 3', (await ev(`document.querySelectorAll('#modeSeg .seg-btn').length`)) === 3);
  check('difficulty buttons 3', (await ev(`document.querySelectorAll('#diffSeg .seg-btn').length`)) === 3);
  check('how-to present', (await ev(`document.getElementById('howTitle').textContent`)).includes('How to play'));
  check('history empty state', (await ev(`!document.getElementById('historyEmpty').classList.contains('hidden')`)) === true);
  check('footer disclaimer', (await ev(`document.getElementById('footerNote').textContent`)).includes('Offline toy game'));

  // ---------------------------------------------------------- language
  await ev(`window.__wam.setLang('bn')`);
  await sleep(200);
  check('BN title renders', (await ev(`document.getElementById('appTitle').textContent`)).includes('হোয়াক'));
  check('BN start button', (await ev(`document.getElementById('startBtn').textContent`)).includes('খেলা শুরু'));
  check('BN digits in HUD', (await ev(`document.getElementById('scoreValue').textContent`)) === '০');
  await ev(`window.__wam.setLang('en')`);
  await sleep(200);
  check('back to EN', (await ev(`document.getElementById('appTitle').textContent`)) === 'Whack-a-Mole BD');
  check('lang persists in localStorage', (await ev(`localStorage.getItem('wam-lang')`)) === 'en');

  // ---------------------------------------------------------- gameplay
  await ev(`document.querySelector('[data-mode="blitz"]').click()`);
  await ev(`window.__wam.start()`);
  await sleep(2600); // countdown 3-2-1-GO (~2.1s) + margin
  check('game screen visible', (await ev(`!document.getElementById('gameScreen').classList.contains('hidden')`)) === true);
  check('status playing', (await ev(`window.__wam.state.status`)) === 'playing');
  check('HUD time counts 30s blitz', (await ev(`window.__wam.state.timeLeftMs`)) <= 30000 && (await ev(`window.__wam.state.timeLeftMs`)) > 20000);

  // Normal mole whack -> +10.
  await ev(`window.__wam.forceSpawn(4, 'normal')`);
  await sleep(150);
  check('mole visible in hole 4', (await ev(`document.querySelectorAll('.hole')[4].querySelector('.mole.up') !== null`)) === true);
  await ev(`window.__wam.clickHole(4)`);
  check('normal whack scores 10', (await ev(`window.__wam.state.score`)) === 10);
  check('HUD score shows 10', (await ev(`document.getElementById('scoreValue').textContent`)) === '10');
  check('hits 1', (await ev(`window.__wam.state.hits`)) === 1);

  // Empty hole -> miss, streak resets.
  await ev(`window.__wam.clickHole(0)`);
  check('empty whack is a miss', (await ev(`window.__wam.state.misses`)) === 1);
  check('streak reset', (await ev(`window.__wam.state.streak`)) === 0);

  // Golden mole -> +50.
  await ev(`window.__wam.forceSpawn(2, 'golden')`);
  await ev(`window.__wam.clickHole(2)`);
  check('golden whack scores 50', (await ev(`window.__wam.state.score`)) === 60);
  check('golden toast shown', (await ev(`document.getElementById('toast').textContent`)).includes('Golden'));

  // Combo: 3 more normal hits -> 4th hit at x2 (streak 3).
  await ev(`window.__wam.forceSpawn(1, 'normal'); window.__wam.clickHole(1)`);
  await ev(`window.__wam.forceSpawn(3, 'normal'); window.__wam.clickHole(3)`);
  await ev(`window.__wam.forceSpawn(5, 'normal'); window.__wam.clickHole(5)`);
  check('combo multiplier x2 in HUD', (await ev(`document.getElementById('comboValue').textContent`)) === 'x2');
  check('combo score total 10+50+10+10+20=100', (await ev(`window.__wam.state.score`)) === 100);

  // Bomb -> -25, combo breaks.
  await ev(`window.__wam.forceSpawn(6, 'bomb')`);
  await ev(`window.__wam.clickHole(6)`);
  check('bomb penalty applied', (await ev(`window.__wam.state.score`)) === 75);
  check('bomb counted', (await ev(`window.__wam.state.bombsHit`)) === 1);
  check('bomb toast shown', (await ev(`document.getElementById('toast').textContent`)).includes('Bomb'));

  // Pause / resume shifts timers, game still playing after.
  await ev(`window.__wam.pause()`);
  check('paused status', (await ev(`window.__wam.state.status`)) === 'paused');
  check('pause overlay visible', (await ev(`!document.getElementById('pauseOverlay').classList.contains('hidden')`)) === true);
  const tLeftPaused = await ev(`window.__wam.state.timeLeftMs`);
  await sleep(600);
  check('clock frozen while paused', (await ev(`window.__wam.state.timeLeftMs`)) === tLeftPaused);
  await ev(`window.__wam.resume()`);
  check('resumed status', (await ev(`window.__wam.state.status`)) === 'playing');
  await sleep(300);
  check('clock runs after resume', (await ev(`window.__wam.state.timeLeftMs`)) < tLeftPaused);

  // Fast-forward to game over.
  await ev(`window.__wam.setTimeLeft(300)`);
  await sleep(900);
  check('game over status', (await ev(`window.__wam.state.status`)) === 'over');
  check('game-over overlay visible', (await ev(`!document.getElementById('gameOverOverlay').classList.contains('hidden')`)) === true);
  check('final score 75', (await ev(`document.getElementById('finalScore').textContent`)) === '75');
  check('final hits 5', (await ev(`document.getElementById('finalHits').textContent`)) === '5');
  check('final accuracy 5/6=83%', (await ev(`document.getElementById('finalAccuracy').textContent`)) === '83%');
  check('new best badge shown', (await ev(`!document.getElementById('newBestBadge').classList.contains('hidden')`)) === true);
  check('best saved', (await ev(`JSON.parse(localStorage.getItem('wam-best'))['blitz:normal']`)) === 75);
  check('history has 1 entry', (await ev(`document.querySelectorAll('#historyList li').length`)) === 1);
  check('history shows score', (await ev(`document.querySelector('#historyList li .h-score').textContent`)).includes('75'));

  // Reload: best + history persist.
  await send('Page.reload', { ignoreCache: true });
  await sleep(1200);
  check('best persists after reload', (await ev(`JSON.parse(localStorage.getItem('wam-best'))['blitz:normal']`)) === 75);
  check('history persists after reload', (await ev(`document.querySelectorAll('#historyList li').length`)) === 1);

  // Play again -> fresh game, score 0.
  await ev(`window.__wam.start()`);
  await sleep(2600);
  check('play-again starts fresh', (await ev(`window.__wam.state.status`)) === 'playing');
  check('fresh score 0', (await ev(`window.__wam.state.score`)) === 0);
  await ev(`window.__wam.quit()`);
  check('quit returns to setup', (await ev(`!document.getElementById('setupScreen').classList.contains('hidden')`)) === true);

  // ---------------------------------------------------------- endless
  await ev(`document.querySelector('[data-mode="endless"]').click()`);
  await ev(`window.__wam.start()`);
  await sleep(2600);
  check('endless shows 3 lives', (await ev(`window.__wam.state.lives`)) === 3);
  check('endless lives in HUD', (await ev(`document.getElementById('livesValue').textContent`)) === '3');
  check('endless time shows --', (await ev(`document.getElementById('timeValue').textContent`)) === '--');
  await ev(`window.__wam.forceSpawn(0, 'bomb'); window.__wam.clickHole(0)`);
  check('endless bomb costs a life', (await ev(`window.__wam.state.lives`)) === 2);
  await ev(`window.__wam.quit()`);

  // ---------------------------------------------------------- mobile
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(400);
  check('390px no horizontal overflow', (await ev(`document.documentElement.scrollWidth <= 390`)) === true);
  check('390px board fits', (await ev(`document.getElementById('board').getBoundingClientRect().width <= 390`)) === true);

  // ---------------------------------------------------------- errors
  check('0 page errors', pageErrors.length === 0, JSON.stringify(pageErrors));
  check('0 console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors));
  check('0 failed requests', failedRequests.length === 0, JSON.stringify(failedRequests));

  console.log('\nSMOKE: ' + passed + '/' + passed + ' PASS');
} catch (err) {
  console.error('\nSMOKE FAILED: ' + err.message);
  console.error('pageErrors:', JSON.stringify(pageErrors));
  console.error('consoleErrors:', JSON.stringify(consoleErrors));
  process.exitCode = 1;
} finally {
  try { proc.kill(); } catch (e) { /* already dead */ }
}
