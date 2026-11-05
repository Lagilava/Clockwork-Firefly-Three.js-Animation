// Checks the Sculptor's fuller controls: per-key motion and hold, aim modes, lens presets, key tools (duplicate, shift, reverse, level),
// the animated shot grade, typed values and label reset, multi-select, scopes and markers.
// Usage: node tools/controltest.cjs [outDir]   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE like projtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path'), os = require('os'), cp = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(os.tmpdir(), 'controltest');
fs.mkdirSync(out, { recursive: true });
const three = process.env.THREE_ROOT || path.join(root, 'node_modules', 'three');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/three/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(three, url.slice(7)))); return; }
  const f = url === '/' ? 'index.html' : url.slice(1), full = path.join(root, f);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', /\.html$/.test(f) ? 'text/html' : 'application/octet-stream');
  res.end(fs.readFileSync(full, 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\//g, '/three/build/').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\//g, '/three/examples/jsm/'));
});
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!cond) process.exitCode = 1; };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.setDefaultTimeout(240000);
  await p.goto('http://127.0.0.1:' + server.address().port + '/Clockwork_Firefly_godview.html'); await p.waitForFunction(() => window.__godview, null, { timeout: 420000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { window.__film.st.lockScale = true; localStorage.setItem('clockwork.sculptor.welcome.v1', '1'); document.getElementById('gvWelcome').classList.add('hidden'); document.getElementById('gvMonOn').click(); });
  const SHOT = 30;
  const probe = (arg) => p.evaluate(([i, u]) => { const g = window.__godview, t = g.shotT(i, u), k = g.sampleAt(t), s = g.sm, f = (a, n) => [a[n * 3], a[n * 3 + 1], a[n * 3 + 2]]; return { cam: f(s.cam, k), tgt: f(s.tgt, k), root: f(s.root, k), lure: f(s.lure, k), fov: s.fov[k], roll: s.roll[k] }; }, arg);
  const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const ovOf = () => p.evaluate((i) => { const g = window.__godview; return JSON.parse(JSON.stringify(g.ov[window.__film.director ? 0 : 0] || null)); }, SHOT);
  const getOv = () => p.evaluate((i) => { const g = window.__godview; const t0 = Object.keys(g.ov).map(Number); const s = g.shotT(i, 0); const k = t0.find((x) => Math.abs(x - s) < 1e-3); return k === undefined ? null : JSON.parse(JSON.stringify(g.ov[k])); }, SHOT);

  // ----- camera -----
  await p.evaluate((i) => window.__godview.selectShot(i, true), SHOT); await p.waitForTimeout(400);
  await p.click('#iEdit', { force: true }); await p.waitForTimeout(800);
  let ov = await getOv(); ok('Edit camera bakes the shot into keyframes', !!ov && ov.keys.length >= 2, ov && String(ov.keys.length));
  const n0 = ov.keys.length;
  await p.click('#iDupKey', { force: true }); await p.waitForTimeout(500);
  ov = await getOv(); ok('Duplicate key adds a key', ov.keys.length === n0 + 1, String(ov.keys.length));
  // the duplicate sits on the first key and the move continues to the last, so test hold on key 2 -> 3
  await p.click('[data-key="1"]', { force: true });
  await p.selectOption('#kEase', 'hold'); await p.waitForTimeout(800);
  ov = await getOv(); ok('a key can hold until the next', ov.keys[1].ease === 'hold', ov.keys[1].ease);
  const uMid = (ov.keys[1].u + ov.keys[2].u) / 2;
  const mid = await probe([SHOT, uMid]), startP = await probe([SHOT, ov.keys[1].u + 0.002]);
  ok('while holding the camera does not move', d3(mid.cam, startP.cam) < 0.03 && d3(mid.tgt, startP.tgt) < 0.03, d3(mid.cam, startP.cam).toFixed(3));
  await p.selectOption('#kEase', 'linear'); await p.waitForTimeout(600);
  const mid2 = await probe([SHOT, uMid]);
  ok('a different motion into the next key moves it', d3(mid2.cam, startP.cam) > 0.02 || d3(mid2.tgt, startP.tgt) > 0.02, d3(mid2.cam, startP.cam).toFixed(3));
  await p.click('[data-key="0"]', { force: true });
  // lens presets
  await p.click('[data-mm="85"]', { force: true }); await p.waitForTimeout(500);
  ov = await getOv(); const fov85 = 2 * Math.atan(12 / 85) * 180 / Math.PI;
  ok('lens chips set the field of view', Math.abs(ov.keys[0].fov - fov85) < 0.3, ov.keys[0].fov + ' vs ' + fov85.toFixed(2));
  // shift the whole move
  const k0 = ov.keys[0].pos.slice(); await p.fill('#isx', '2'); await p.click('#iShift', { force: true }); await p.waitForTimeout(500);
  ov = await getOv(); ok('Shift moves every key and its aim', Math.abs(ov.keys[0].pos[0] - k0[0] - 2) < 0.01, ov.keys[0].pos[0] - k0[0]);
  // reverse
  const first = ov.keys[0].pos.slice(), last = ov.keys[ov.keys.length - 1].pos.slice();
  await p.click('#iReverse', { force: true }); await p.waitForTimeout(500);
  ov = await getOv(); ok('Reverse plays the move backwards', d3(ov.keys[0].pos, last) < 0.01 && d3(ov.keys[ov.keys.length - 1].pos, first) < 0.01 && ov.keys[0].u < ov.keys[1].u);
  // level the horizon
  await p.evaluate(() => { const r = document.getElementById('kRoll'); r.value = 8; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(300);
  ov = await getOv(); const rolled = ov.keys.some((k) => Math.abs(k.roll || 0) > 0.05);
  await p.click('#iLevel', { force: true }); await p.waitForTimeout(500);
  ov = await getOv(); ok('Level horizon clears the dutch angle', rolled && ov.keys.every((k) => Math.abs(k.roll || 0) < 1e-6));
  // aim at the robot: the target follows it
  const preT = await probe([SHOT, 0.5]);
  await p.selectOption('#iAim', 'robot'); await p.waitForTimeout(900);
  ov = await getOv(); const postT = await probe([SHOT, 0.5]);
  ok('"Looks at the robot" is stored', ov.aim === 'robot', ov.aim);
  ok('switching the aim does not jump the picture', d3(preT.tgt, postT.tgt) < 0.15, d3(preT.tgt, postT.tgt).toFixed(3));
  const kk = ov.keys[0], pk = await probe([SHOT, kk.u]);
  ok('the aim is now an offset from the robot', d3(pk.tgt, [pk.root[0] + kk.target[0], pk.root[1] + kk.target[1], pk.root[2] + kk.target[2]]) < 0.05);
  await p.selectOption('#iAim', 'ember'); await p.waitForTimeout(900);
  ov = await getOv(); const pe = await probe([SHOT, ov.keys[0].u]), ke = ov.keys[0];
  ok('and the same for Ember', ov.aim === 'ember' && d3(pe.tgt, [pe.lure[0] + ke.target[0], pe.lure[1] + ke.target[1], pe.lure[2] + ke.target[2]]) < 0.05, ov.aim);
  // undo walks back
  await p.keyboard.press('Control+z'); await p.waitForTimeout(500);
  ov = await getOv(); ok('undo steps back through camera edits', ov.aim === 'robot', ov.aim);

  // ----- grade: shot scope, animated end, typed values, reset -----
  await p.click('[data-itab=grade]', { force: true }); await p.waitForTimeout(300);
  const setRange = (k, v) => p.evaluate(([k, v]) => { const el = document.querySelector(`#gvIGrade [data-gv=${k}]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
  const gradeAt = (T, key) => p.evaluate(([T, key]) => { const f = window.__film; return f.effectiveGrade(f.gradePresets.gvcustom, T)[key]; }, [T, key]);
  const nextBase = await p.evaluate((i) => { const f = window.__film, g = window.__godview; return f.effectiveGrade(f.gradePresets.gvcustom, g.shotT(i, 1) + 0.5).sat; }, SHOT);
  await p.click('[data-scope=shot]', { force: true }); await p.waitForTimeout(300);
  await setRange('sat', 0.5); await p.waitForTimeout(300);
  await p.click('[data-scope=end]', { force: true }); await p.waitForTimeout(300);
  await setRange('sat', 1.5); await p.waitForTimeout(500);
  const sh = await p.evaluate((i) => { const g = window.__godview; return { t0: g.shotT(i, 0), t1: g.shotT(i, 1) }; }, SHOT);
  const gs = await gradeAt(sh.t0 + 0.05, 'sat'), gm = await gradeAt((sh.t0 + sh.t1) / 2, 'sat'), ge = await gradeAt(sh.t1 - 0.02, 'sat');
  ok('the shot grade eases from its start look to its end look', gs < 0.6 && ge > 1.35 && gm > gs + 0.2 && gm < ge - 0.2, [gs, gm, ge].map((x) => x.toFixed(2)).join(' → '));
  const after = await gradeAt(sh.t1 + 0.5, 'sat');
  ok('and the next shot is not affected', Math.abs(after - nextBase) < 0.05, after.toFixed(2) + ' vs ' + nextBase.toFixed(2));
  // typed value beyond the slider range
  await p.click('[data-scope=film]', { force: true }); await p.waitForTimeout(300);
  await p.evaluate(() => { document.querySelector('#gvIGrade [data-gv=exposure]').closest('.rg').querySelector('output').click(); });
  await p.waitForSelector('#gvIGrade .outedit'); await p.fill('#gvIGrade .outedit', '3.5'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const ex = await p.evaluate(() => window.__film.effectiveGrade(window.__film.gradePresets.gvcustom, 2).exposure);
  ok('a typed value can go past the slider range', Math.abs(ex - 3.5) < 0.01, String(ex));
  await p.evaluate(() => { const l = document.querySelector('#gvIGrade [data-gv=exposure]').closest('.rg').querySelector('label'); l.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); await p.waitForTimeout(300);
  const ex2 = await p.evaluate(() => window.__film.effectiveGrade(window.__film.gradePresets.gvcustom, 2).exposure);
  ok('double-clicking the name resets it', Math.abs(ex2 - 3.5) > 0.2, String(ex2));

  // ----- multi-select -----
  await p.click('[data-ltab=shots]', { force: true });
  await p.evaluate(() => window.__godview.selectShot(10, true)); await p.waitForTimeout(200);
  await p.click('.srow[data-shot="12"]', { modifiers: ['Control'], force: true }); await p.click('.srow[data-shot="14"]', { modifiers: ['Control'], force: true }); await p.waitForTimeout(300);
  const multi = await p.evaluate(() => ({ n: window.__godview.multi.size, bar: !document.getElementById('gvBatch').classList.contains('hidden'), txt: document.getElementById('gvBatch').textContent }));
  ok('Ctrl-click selects several shots and shows the batch bar', multi.n >= 3 && multi.bar && /3 shots selected/.test(multi.txt), JSON.stringify(multi).slice(0, 120));
  await p.click('[data-itab=grade]', { force: true }); await p.click('[data-scope=shot]', { force: true }); await p.waitForTimeout(200);
  await setRange('sat', 0.2); await p.waitForTimeout(400);
  const gsat = await p.evaluate(() => { const g = window.__godview; return [10, 12, 14, 11].map((i) => { const k = String(g.shotT(i, 0)); const sh = g.grade.vals.shots && Object.keys(g.grade.vals.shots).find((x) => Math.abs(+x - +k) < 1e-3); return sh ? g.grade.vals.shots[sh].sat : null; }); });
  ok('grading with several selected changes them all', gsat[0] === 0.2 && gsat[1] === 0.2 && gsat[2] === 0.2 && gsat[3] == null, JSON.stringify(gsat));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Esc clears the selection', await p.evaluate(() => window.__godview.multi.size === 0));

  // ----- scopes -----
  await p.evaluate(() => { document.getElementById('gvMonOn').click(); }); await p.waitForTimeout(800);
  await p.click('#gvScopeBtn', { force: true }); await p.waitForTimeout(600);
  const draw = (mode) => p.evaluate((m) => { document.querySelector(`#gvScopeMode [data-sc=${m}]`).click(); window.__godview.scopes.draw(); const cv = document.getElementById('gvScope'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; return lit; }, mode);
  for (const m of ['hist', 'wave', 'parade', 'vec']) { const lit = await draw(m); ok(`the ${m} scope draws the picture`, lit > 150, String(lit)); }
  await p.click('#gvScopeBtn', { force: true });

  // ----- markers -----
  await p.evaluate(() => window.__film.seekTo(42.5)); await p.keyboard.press('b'); await p.waitForTimeout(300);
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__film.seekTo(80); }); await p.keyboard.press('b'); await p.waitForTimeout(300);
  const mk = await p.evaluate(() => window.__godview.markers.map((m) => m.t));
  ok('B drops a marker at the playhead', mk.length === 2 && Math.abs(mk[0] - 42.5) < 0.05 && Math.abs(mk[1] - 80) < 0.05, JSON.stringify(mk));
  await p.keyboard.press('Escape'); await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await p.evaluate(() => window.__film.seekTo(10)); await p.keyboard.press(']'); await p.waitForTimeout(300);
  const j1 = await p.evaluate(() => window.__film.st.T); ok(']  jumps to the next marker', Math.abs(j1 - 42.5) < 0.1, String(j1));
  await p.keyboard.press(']'); await p.waitForTimeout(300); await p.keyboard.press('['); await p.waitForTimeout(300);
  const j2 = await p.evaluate(() => window.__film.st.T); ok('[ jumps back', Math.abs(j2 - 42.5) < 0.1, String(j2));
  await p.click('[data-ltab=markers]', { force: true }); await p.fill('#gvLMarkers [data-mtx="0"]', 'Reveal the door'); await p.waitForTimeout(300);
  ok('a marker takes a note and shows in the list', (await p.textContent('#gvLMarkers')).includes('Reveal') || (await p.inputValue('#gvLMarkers [data-mtx="0"]')) === 'Reveal the door');
  await p.waitForTimeout(1500);
  const saved = await p.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n'));
  ok('markers are part of the saved project', /Reveal the door/.test(saved), saved.length + ' chars');
  await p.screenshot({ path: path.join(out, 'controls.png') });
  console.log('errors', errs.slice(0, 5)); if (errs.length) process.exitCode = 1;
  await b.close(); server.close();
})();
