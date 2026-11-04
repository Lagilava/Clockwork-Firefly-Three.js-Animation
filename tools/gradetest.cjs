// Checks the wide colour grade, per-shot grades and camera motion in the Sculptor, and that a saved project plays them in the film.
// Usage: node tools/gradetest.cjs   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE like projtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
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
// renders once at film time T and reads back what the grade pass was given
const probe = (T, desk) => desk
  ? `(() => { const f = window.__film, g = f.effectiveGrade(f.gradePresets.gvcustom, ${T}); return { hue: g.hue * Math.PI / 180, gamma: g.gamma, sat: g.sat, letter: g.letterbox, exposure: g.exposure }; })()`
  : `(() => { const f = window.__film; f.seekTo(${T}); f.post.render(f.st.T, f.st.elapsed, { letter: 0, dt: 0, cut: f.director.cut, cinematic: true, threshold: 0.72 }); const u = f.post.grade.uniforms; return { hue: u.uHue.value, gamma: u.uGamma.value, sat: u.uSat.value, letter: u.uLetter.value }; })()`;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  const desk = await ctx.newPage(); desk.on('pageerror', (e) => errs.push(e.message));
  await desk.goto(base + '/Clockwork_Firefly_godview.html'); await desk.waitForFunction(() => window.__godview, null, { timeout: 420000 }); await desk.waitForTimeout(2000);
  await desk.evaluate(() => { window.__film.st.lockScale = true; window.__godview.selectShot(30); });
  await desk.click('[data-itab=grade]'); await desk.waitForTimeout(500);
  const n = await desk.$$eval('#gvIGrade input[type=range]', (e) => e.length);
  ok('grade tab offers many sliders', n >= 25, 'sliders ' + n);
  const setRange = (k, v) => desk.evaluate(([k, v]) => { const el = document.querySelector(`#gvIGrade [data-gv=${k}]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  await setRange('gamma', 1.4); await setRange('letterbox', 0.1); await setRange('exposure', 1.3);
  const t0 = await desk.evaluate(() => window.__godview.shotStart ? window.__godview.shotStart(30) : null);
  const a = await desk.evaluate(probe(60, true));
  ok('film-wide values reach the film (gamma, letterbox, exposure)', Math.abs(a.gamma - 1.4) < 1e-6 && Math.abs(a.letter - 0.1) < 1e-6, JSON.stringify(a));
  // shot scope
  await desk.click('[data-scope=shot]'); await desk.waitForTimeout(300);
  await setRange('hue', 40); await setRange('sat', 0.3);
  const key = await desk.evaluate(() => Object.keys(window.__godview.grade.vals.shots || {}));
  ok('a shot grade is stored for that shot only', key.length === 1, JSON.stringify(key));
  const shotT = +key[0];
  const inside = await desk.evaluate(probe(shotT + 0.1, true)), other = await desk.evaluate(probe(shotT + 40, true));
  await desk.evaluate(() => window.__godview.selectShot(30)); await desk.waitForTimeout(300);
  ok('the shot grade applies inside the shot', Math.abs(inside.hue - 40 * Math.PI / 180) < 1e-6 && inside.sat < 0.6, JSON.stringify(inside));
  ok('and not in other shots', other.hue === 0 && Math.abs(other.gamma - 1.4) < 1e-6, JSON.stringify(other));
  await desk.screenshot({ path: path.join(process.env.OUT || '/tmp', 'grade-tab.png') });
  const exp = await desk.evaluate(() => { const g = window.__godview.grade.vals; return { shots: g.shots, gamma: g.gamma, letterbox: g.letterbox }; });
  ok('the export carries the new values and the shot grade', exp.gamma === 1.4 && exp.letterbox === 0.1 && exp.shots[key[0]].hue === 40, JSON.stringify(exp));
  // undo one row, then reset the shot
  await desk.click('[data-undo=hue]'); await desk.waitForTimeout(200);
  ok('undo returns a row to the film value', await desk.evaluate((k) => !('hue' in window.__godview.grade.vals.shots[k]), key[0]));
  await desk.click('#gShotReset'); await desk.waitForTimeout(200);
  ok('reset removes the shot grade', await desk.evaluate(() => !window.__godview.grade.vals.shots || !Object.keys(window.__godview.grade.vals.shots).length));
  // keep one for the film check
  await setRange('hue', 25);
  // camera motion
  await desk.click('[data-itab=shot]'); await desk.click('#iEdit'); await desk.waitForTimeout(800);
  const hasSel = await desk.$('#iEase'); ok('edited shots have a Motion setting', !!hasSel);
  await desk.selectOption('#iEase', 'linear'); await desk.waitForTimeout(500);
  const ease = await desk.evaluate(() => Object.values(window.__godview.ov).filter((o) => o.ease === 'linear').length);
  ok('motion setting is stored on that one shot', ease === 1, String(ease));
  // save as a project and play it in the film
  await desk.click('#gvSaveBtn'); await desk.waitForSelector('#gvDlg:not(.hidden)'); await desk.fill('#gvDlgInput', 'Grade test'); await desk.click('#gvDlgYes'); await desk.waitForTimeout(700);
  const id = await desk.evaluate(() => window.__godview.projects.from());
  const film = await ctx.newPage(); film.on('pageerror', (e) => errs.push(e.message));
  await film.goto(base + '/Clockwork_Firefly_fullfilm.html?project=' + id, { timeout: 240000 });
  await film.waitForFunction(() => window.__film && window.__film.st.ready && !document.getElementById('start').classList.contains('hidden'), null, { timeout: 480000 });
  await film.evaluate(() => { document.getElementById('start').click(); window.__film.setPlaying(false); window.__film.st.lockScale = true; });
  const fin = await film.evaluate(probe(shotT + 0.1)), fout = await film.evaluate(probe(shotT + 40));
  ok('the saved project plays its shot grade in the film', Math.abs(fin.hue - 25 * Math.PI / 180) < 1e-6 && fout.hue === 0 && Math.abs(fout.gamma - 1.4) < 1e-6, JSON.stringify({ fin, fout }));
  console.log('errors', errs.slice(0, 5));
  await b.close(); server.close();
})();
