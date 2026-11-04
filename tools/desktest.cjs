// Checks the Sculptor's editor tools: LUT import (3D and 1D) and playback in the film, undo and redo, notes and the shot filter,
// copy and paste of cameras and grades, resizable panels and saved stills.
// Usage: node tools/desktest.cjs [outDir]   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE like projtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path'), os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(os.tmpdir(), 'desktest');
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
// an inverting 3D LUT (17 points) and a 1D gamma-ish LUT (64 points)
const cube3 = (() => { const n = 17; let t = `TITLE "Invert"\nLUT_3D_SIZE ${n}\n`; for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) t += `${1 - r / (n - 1)} ${1 - g / (n - 1)} ${1 - b / (n - 1)}\n`; return t; })();
const cube1 = (() => { const n = 64; let t = `# curve\nLUT_1D_SIZE ${n}\n`; for (let i = 0; i < n; i++) { const v = Math.pow(i / (n - 1), 0.8); t += `${v} ${v} ${v}\n`; } return t; })();
fs.writeFileSync(path.join(out, 'invert.cube'), cube3); fs.writeFileSync(path.join(out, 'curve.cube'), cube1); fs.writeFileSync(path.join(out, 'bad.cube'), 'LUT_3D_SIZE 4\n0 0 0\n');
const meanLuma = `(() => { const f = window.__film, c = f.renderer.domElement; f.post.render(f.st.T, f.st.elapsed, { letter: 0, dt: 0, cut: f.director.cut, cinematic: true, threshold: 0.72 }); const i = new Image(); i.src = c.toDataURL(); return i.decode().then(() => { const k = document.createElement('canvas'); k.width = 64; k.height = 36; const x = k.getContext('2d'); x.drawImage(i, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let j = 0; j < d.length; j += 4) s += d[j] + d[j + 1] + d[j + 2]; return s / (d.length / 4) / 3; }); })()`;
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, acceptDownloads: true });
  const errs = [];
  const desk = await ctx.newPage(); desk.on('pageerror', (e) => errs.push(e.message));
  desk.setDefaultTimeout(240000); await desk.goto(base + '/Clockwork_Firefly_godview.html'); await desk.waitForFunction(() => window.__godview, null, { timeout: 420000 }); await desk.waitForTimeout(2000);
  await desk.evaluate(() => { window.__film.st.lockScale = true; document.getElementById('gvMonOn').click(); window.__godview.selectShot(30); });
  const clk = (sel) => desk.click(sel, { force: true }), fil = (sel, v) => desk.fill(sel, v, { force: true }); // software GL frames take seconds; do not wait for 'stable'
  await clk('[data-itab=grade]'); await desk.waitForTimeout(400);
  const setRange = (k, v) => desk.evaluate(([k, v]) => { const el = document.querySelector(`#gvIGrade [data-gv=${k}]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  const g = () => desk.evaluate(() => { const v = window.__godview.grade.vals; return { gamma: v.gamma ?? 1, lut: v.lut ? { name: v.lut.name, n: v.lut.n, len: v.lut.data.length } : null }; });

  // LUT import
  await desk.setInputFiles('#gvLutIn', path.join(out, 'bad.cube')); await desk.waitForFunction(() => /Could not read/.test(document.getElementById('gvToast').textContent));
  ok('a broken LUT is refused with a message', (await g()).lut === null && /Could not read/.test(await desk.$eval('#gvToast', (e) => e.textContent)));
  await desk.setInputFiles('#gvLutIn', path.join(out, 'curve.cube')); await desk.waitForFunction(() => window.__godview.grade.vals.lut && window.__godview.grade.vals.lut.name === 'curve');
  let st = await g(); ok('a 1D LUT becomes a 33-point 3D LUT', st.lut && st.lut.n === 33 && st.lut.name === 'curve', JSON.stringify(st.lut));
  await desk.setInputFiles('#gvLutIn', path.join(out, 'invert.cube')); await desk.waitForFunction(() => window.__godview.grade.vals.lut && window.__godview.grade.vals.lut.name === 'Invert');
  st = await g(); ok('a 3D LUT imports', st.lut && st.lut.n === 17 && st.lut.name === 'Invert', JSON.stringify(st.lut));
  ok('the LUT shows in the grade tab with a strength slider', !!(await desk.$('#gvIGrade [data-gv=lutAmount]')) && !!(await desk.$('#gLutRm')));

  // undo and redo
  const gamma0 = (await g()).gamma;
  await setRange('gamma', 1.4); await desk.waitForTimeout(700);
  ok('gamma changed', (await g()).gamma === 1.4);
  await desk.keyboard.press('Control+z'); await desk.waitForTimeout(700);
  ok('Ctrl+Z undoes the grade change', (await g()).gamma === gamma0);
  await desk.keyboard.press('Control+Shift+z'); await desk.waitForTimeout(700);
  ok('Ctrl+Shift+Z redoes it', (await g()).gamma === 1.4);
  await clk('#gvUndo'); await desk.waitForTimeout(700);
  ok('the Undo button works too', (await g()).gamma === gamma0);

  // play a saved project with the LUT in the film
  await clk('[data-itab=shot]'); await clk('#iEdit'); await desk.waitForTimeout(700);
  await fil('#gvIShot [data-f=py]', '3.4'); await desk.waitForTimeout(500);
  await clk('#gvSaveBtn'); await desk.waitForSelector('#gvDlg:not(.hidden)'); await fil('#gvDlgInput', 'LUT test'); await clk('#gvDlgYes'); await desk.waitForTimeout(700);
  const id = await desk.evaluate(() => window.__godview.projects.from());
  const film = await ctx.newPage(); film.on('pageerror', (e) => errs.push(e.message));
  await film.goto(base + '/Clockwork_Firefly_fullfilm.html?project=' + id, { timeout: 240000 });
  await film.waitForFunction(() => window.__film && window.__film.st.ready && !document.getElementById('start').classList.contains('hidden'), null, { timeout: 480000 });
  await film.evaluate(() => { document.getElementById('start').click(); const f = window.__film; f.setPlaying(false); f.st.lockScale = true; f.post.setAOQuality = () => {}; f.post.aoAllowed = false; f.seekTo(100); f.idle.heartbeat = 0; });
  await film.waitForTimeout(1500);
  const withLut = await film.evaluate(meanLuma);
  await film.evaluate(() => { window.__film.gradePresets.project.lutAmount = 0; });
  const without = await film.evaluate(meanLuma);
  await film.evaluate(() => { window.__film.gradePresets.project.lutAmount = 0.5; });
  const half = await film.evaluate(meanLuma);
  ok('the saved LUT inverts the film image', Math.abs(withLut - (255 - without)) < 25 && Math.abs(withLut - without) > 20, JSON.stringify({ withLut, without, half }));
  ok('LUT strength blends', Math.abs(half - (withLut + without) / 2) < 12, JSON.stringify({ half }));
  await film.close();

  // notes and the filter
  await desk.evaluate(() => window.__godview.selectShot(12)); await desk.waitForTimeout(400);
  await fil('#iNote', 'Hold longer on her eyes'); await desk.waitForTimeout(500); await clk('#gvITabs [data-itab=export]'); await clk('#gvITabs [data-itab=shot]');
  ok('a note is stored and shows in the shot list', await desk.evaluate(() => { const g = window.__godview; return Object.values(g.notes).length === 1 && !!document.querySelector('.srow[data-shot="12"] .ed[title="Has a note"]'); }));
  await clk('#gvShotChips [data-f=note]'); await desk.waitForTimeout(200);
  ok('the Notes filter shows only noted shots', await desk.$$eval('#gvLShots .srow:not(.nomatch)', (e) => e.length) === 1);
  await clk('#gvShotChips [data-f=all]'); await fil('#gvShotQ', 'lantern'); await desk.waitForTimeout(200);
  const nl = await desk.$$eval('#gvLShots .srow:not(.nomatch)', (e) => e.length); ok('search narrows the shot list', nl >= 1 && nl < 10, 'rows ' + nl);
  await fil('#gvShotQ', ''); await desk.waitForTimeout(100);

  // copy and paste a camera
  await desk.evaluate(() => window.__godview.selectShot(40)); await desk.waitForTimeout(300); await clk('#iEdit'); await desk.waitForTimeout(600);
  await fil('#gvIShot [data-f=py]', '5.5'); await desk.waitForTimeout(400);
  await clk('#iCopyCam'); await desk.evaluate(() => window.__godview.selectShot(41)); await desk.waitForTimeout(300);
  await clk('#iPasteCam'); await desk.waitForTimeout(500);
  const same = await desk.evaluate(() => { const g = window.__godview; const a = Object.entries(g.ov).filter(([t, o]) => o.keys.some((k) => k.pos[1] === 5.5)); return a.length; });
  ok('a camera can be copied from one shot to another', same >= 2, 'shots with that key ' + same);

  // panels
  const rw0 = await desk.$eval('#gvRight', (e) => e.getBoundingClientRect().width);
  const gb = await desk.$eval('#gvRGrip', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + 120]; });
  await desk.mouse.move(gb[0], gb[1]); await desk.mouse.down(); await desk.mouse.move(gb[0] - 90, gb[1], { steps: 5 }); await desk.mouse.up(); await desk.waitForTimeout(300);
  const rw1 = await desk.$eval('#gvRight', (e) => e.getBoundingClientRect().width);
  ok('the inspector can be widened by dragging its edge', rw1 > rw0 + 60, `${rw0} -> ${rw1}`);
  ok('and the layout is remembered', await desk.evaluate(() => !!JSON.parse(localStorage.getItem('clockwork.sculptor.layout.v1')).rw));
  await clk('#gvMonFold'); await desk.waitForTimeout(200);
  ok('the monitor can be folded away', await desk.$eval('#gvMonCard .monwrap', (e) => getComputedStyle(e).display) === 'none');
  await clk('#gvMonFold');

  // stills
  const [dl] = await Promise.all([desk.waitForEvent('download', { timeout: 20000 }), clk('#gvStill')]);
  ok('a still can be saved', /^clockwork-S\d+-.*\.png$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await desk.screenshot({ path: path.join(out, 'desk.png') });
  console.log('errors', errs.slice(0, 5));
  await b.close(); server.close();
})();
