// Checks the studio tools in the Sculptor: J/K/L shuttle, loop and range, frame guides, preview quality,
// versions with A/B flip, and a frame-accurate clip and still-sequence export.
// Usage: node tools/studiotest.cjs [outDir]   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE like projtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path'), os = require('os'), cp = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(os.tmpdir(), 'studiotest');
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
  await p.evaluate(() => { window.__film.st.lockScale = true; document.getElementById('gvMonOn').click(); });
  await p.screenshot({ path: path.join(out, 'desk.png') });
  ok('the welcome card appears on a first visit', await p.evaluate(() => !document.getElementById('gvWelcome').classList.contains('hidden')));
  await p.click('#gvWelcomeX', { force: true });
  ok('and stays dismissed', await p.evaluate(() => document.getElementById('gvWelcome').classList.contains('hidden') && !!localStorage.getItem('clockwork.sculptor.welcome.v1')));

  // ----- range, loop, shuttle -----
  await p.evaluate(() => { window.__godview.selectShot(30, true); });
  await p.waitForTimeout(500);
  const sp = await p.evaluate(() => { const g = window.__godview, s = g.spanNow(); return { a: s.a, b: s.b, kind: s.kind }; });
  ok('with no range the selected shot is the span', sp.kind === 'shot' && sp.b > sp.a, JSON.stringify(sp));
  await p.evaluate(([a]) => { window.__film.seekTo(a + 1); }, [sp.a]); await p.keyboard.press('i');
  await p.evaluate(([a]) => { window.__film.seekTo(a + 3); }, [sp.a]); await p.keyboard.press('o');
  const r1 = await p.evaluate(() => { const g = window.__godview; return { a: g.range.a, b: g.range.b, kind: g.spanNow().kind }; });
  ok('I and O set an In-Out range', r1.kind === 'range' && Math.abs(r1.a - sp.a - 1) < 0.05 && Math.abs(r1.b - sp.a - 3) < 0.05, JSON.stringify(r1));
  ok('the timeline range readout shows it', /\d/.test(await p.textContent('#gvRangeInfo')) && (await p.textContent('#gvRangeInfo')).includes('s'));
  // loop: start near the end of the range, play, expect a wrap back inside it
  await p.keyboard.press('r');
  ok('R turns the loop on', await p.evaluate(() => window.__godview.range.loop === true));
  await p.evaluate(([a]) => { window.__film.seekTo(a + 2.95); window.__film.setPlaying(true); }, [sp.a]);
  const wrapped = await p.waitForFunction(([a]) => window.__film.st.T < a + 2.5, [sp.a], { timeout: 60000 }).then(() => true, () => false);
  ok('the loop wraps playback back to the In point', wrapped);
  await p.evaluate(() => window.__film.setPlaying(false));
  // shuttle
  await p.evaluate(([a]) => { window.__film.seekTo(a + 2); }, [sp.a]);
  await p.keyboard.press('l'); const l1 = await p.evaluate(() => ({ rate: window.__godview.shuttleState.rate, play: window.__film.st.playing }));
  await p.keyboard.press('l'); const l2 = await p.evaluate(() => window.__godview.shuttleState.rate);
  ok('L plays forward and a second press doubles it', l1.rate === 1 && l1.play && l2 === 2, JSON.stringify({ l1, l2 }));
  await p.keyboard.press('k'); const k1 = await p.evaluate(() => ({ rate: window.__godview.shuttleState.rate, play: window.__film.st.playing, speed: window.__film.st.speed }));
  ok('K pauses and resets the speed', k1.rate === 0 && !k1.play && k1.speed === 1, JSON.stringify(k1));
  await p.evaluate(([a]) => { window.__film.seekTo(a + 2.5); }, [sp.a]);
  const t0 = await p.evaluate(() => window.__film.st.T); await p.keyboard.press('j'); await p.waitForTimeout(1500);
  const t1 = await p.evaluate(() => window.__film.st.T);
  ok('J runs the film backwards', t1 < t0 - 0.05, `${t0.toFixed(2)} -> ${t1.toFixed(2)}`);
  await p.keyboard.press('k'); await p.keyboard.press('x'); await p.keyboard.press('r');
  ok('X clears the range, R turns the loop off', await p.evaluate(() => window.__godview.range.a == null && !window.__godview.range.loop));

  // ----- guides -----
  await p.click('#gvGuideBtn', { force: true });
  await p.selectOption('#gGAspect', '9:16'); await p.check('#gGThirds', { force: true }); await p.check('#gGSafe', { force: true });
  const gc = await p.evaluate(() => { const c = document.querySelector('#gvGuides .gcrop'), w = document.getElementById('gvMon').getBoundingClientRect(), r = c.getBoundingClientRect(); return { ratio: r.width / r.height, mask: c.classList.contains('mask'), onBtn: document.getElementById('gvGuideBtn').classList.contains('on'), boxes: document.querySelectorAll('#gvGuides .box').length, inside: r.left >= w.left - 1 && r.right <= w.right + 1 }; });
  ok('the 9:16 guide frames a vertical crop with thirds and safe areas', Math.abs(gc.ratio - 9 / 16) < 0.02 && gc.mask && gc.onBtn && gc.boxes === 2 && gc.inside, JSON.stringify(gc));
  await p.screenshot({ path: path.join(out, 'guides.png') });
  await p.keyboard.press('Escape');
  ok('Esc closes the guides menu', await p.evaluate(() => document.getElementById('gvPop').classList.contains('hidden')));

  // ----- preview quality -----
  const v0 = await p.evaluate(() => ({ w: document.querySelector('#gvStage canvas').width }));
  await p.selectOption('#gvQuality', 'light'); await p.waitForTimeout(1200);
  const v1 = await p.evaluate(() => ({ w: document.querySelector('#gvStage canvas').width, rate: window.__godview.pv.rate, auto: window.__godview.mon.auto, q: window.__godview.qscale }));
  ok('Light halves the viewport resolution and slows the monitor', v1.w < v0.w * 0.65 && v1.q === 0.5 && !v1.auto && v1.rate === 4, JSON.stringify({ v0, v1 }));
  await p.selectOption('#gvQuality', 'auto'); await p.waitForTimeout(800);
  ok('Auto brings it back', await p.evaluate(() => window.__godview.qscale === 1 && window.__godview.mon.auto));

  // ----- versions -----
  await p.evaluate(() => window.__godview.selectShot(30, true)); await p.waitForTimeout(300);
  await p.click('[data-itab=grade]', { force: true }); await p.waitForTimeout(300);
  const setRange = (k, v) => p.evaluate(([k, v]) => { const el = document.querySelector(`#gvIGrade [data-gv=${k}]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
  await setRange('sat', 0.5); await p.waitForTimeout(400);
  await p.click('[data-itab=versions]', { force: true }); await p.waitForTimeout(300);
  await p.click('#vSave', { force: true }); await p.waitForSelector('#gvDlg:not(.hidden)'); await p.fill('#gvDlgInput', 'Muted'); await p.click('#gvDlgYes', { force: true }); await p.waitForTimeout(500);
  await p.click('[data-itab=grade]', { force: true }); await setRange('sat', 1.8); await p.waitForTimeout(400);
  await p.click('[data-itab=versions]', { force: true });
  await p.click('#vSave', { force: true }); await p.waitForSelector('#gvDlg:not(.hidden)'); await p.fill('#gvDlgInput', 'Vivid'); await p.click('#gvDlgYes', { force: true }); await p.waitForTimeout(500);
  const vs = await p.evaluate(() => { const v = window.__godview.versions; return { n: v.list().length, a: v.store.a, b: v.store.b, names: v.list().map((x) => x.name) }; });
  ok('two versions are saved and fill A then B', vs.n === 2 && vs.a && vs.b && vs.a !== vs.b, JSON.stringify(vs));
  const satNow = () => p.evaluate(() => window.__godview.grade.vals.sat);
  ok('the open work is the second version', Math.abs((await satNow()) - 1.8) < 1e-6);
  await p.keyboard.press('\\'); await p.waitForTimeout(1500);
  const sa = await satNow(); const badge = await p.textContent('#gvViewing');
  ok('the backslash key flips to A (Muted)', Math.abs(sa - 0.5) < 1e-6 && badge.includes('Muted'), `${sa} ${badge}`);
  await p.keyboard.press('\\'); await p.waitForTimeout(1500);
  ok('and back to B (Vivid)', Math.abs((await satNow()) - 1.8) < 1e-6 && (await p.textContent('#gvViewing')).includes('Vivid'));
  ok('the diff names the changed value', (await p.textContent('#gvIVers')).includes('film-wide grade value'));
  // unsaved work is never lost by flipping
  await p.click('[data-itab=grade]', { force: true }); await setRange('sat', 1.1); await p.waitForTimeout(400);
  await p.keyboard.press('\\'); await p.waitForTimeout(1500);
  const kept = await p.evaluate(() => window.__godview.versions.list().filter((v) => v.auto).map((v) => v.work.grade && v.work.grade.vals.sat));
  ok('flipping with unsaved edits keeps them as a version', kept.includes(1.1), JSON.stringify(kept));
  await p.screenshot({ path: path.join(out, 'versions.png') });

  // ----- export -----
  await p.evaluate(() => window.__godview.selectShot(30, true)); await p.waitForTimeout(300);
  await p.click('#gvExportBtn', { force: true });
  await p.selectOption('#xpFmt', 'png'); await p.selectOption('#xpSize', 'draft'); await p.selectOption('#xpFps', '12'); await p.selectOption('#xpAspect', '9:16');
  const o = await p.evaluate(() => window.__godview.exporter.opts());
  ok('the export summary follows the choices', o.cw === 202 || o.cw === 204 ? o.ch === 360 : false, JSON.stringify({ cw: o.cw, ch: o.ch, frames: o.frames }));
  await p.screenshot({ path: path.join(out, 'export.png') });
  // shrink the range so the software renderer finishes quickly
  await p.evaluate(() => { const g = window.__godview; const s = g.spanNow(); g.range.a = s.a + 0.2; g.range.b = s.a + 0.7; g.exporter.opts(); });
  await p.selectOption('#xpRange', 'range');
  const T0 = await p.evaluate(() => window.__film.st.T);
  const dl = p.waitForEvent('download', { timeout: 420000 });
  await p.click('#xpGo', { force: true }); const d1 = await dl; const zp = path.join(out, 'frames.zip'); await d1.saveAs(zp);
  const zl = cp.execSync(`python3 -c "import zipfile,sys;z=zipfile.ZipFile('${zp}');print(z.testzip() or 'ok',len(z.namelist()),z.namelist()[0])"`).toString().trim();
  ok('the still sequence is a valid zip of PNG frames', /^ok 6 frame_0001\.png/.test(zl), zl);
  cp.execSync(`cd ${out} && rm -rf frames && mkdir frames && cd frames && python3 -c "import zipfile;zipfile.ZipFile('${zp}').extractall()"`);
  const dim = cp.execSync(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 ${out}/frames/frame_0001.png`).toString().trim();
  ok('frames are cropped to the 9:16 guide', /^20[24],360$/.test(dim), dim);
  const h1 = cp.execSync(`md5sum ${out}/frames/frame_0001.png ${out}/frames/frame_0006.png | cut -d' ' -f1`).toString().split('\n');
  ok('the frames differ as the film moves', h1[0] !== h1[1]);
  const after = await p.evaluate(() => ({ T: window.__film.st.T, fixed: window.__film.st.fixedDt || 0, on: window.__godview.pv.on, w: document.getElementById('gvMon').width, play: window.__film.st.playing, active: window.__godview.xp.active }));
  ok('the desk is restored after exporting', Math.abs(after.T - T0) < 0.05 && !after.fixed && !after.on && after.w === 800 && !after.play && !after.active, JSON.stringify(after));
  // clip
  await p.click('#gvExportBtn', { force: true });
  await p.selectOption('#xpFmt', 'webm'); await p.selectOption('#xpSize', 'draft'); await p.selectOption('#xpFps', '12'); await p.selectOption('#xpAspect', 'off'); await p.selectOption('#xpRange', 'range');
  const dl2 = p.waitForEvent('download', { timeout: 420000 });
  await p.click('#xpGo', { force: true }); const d2 = await dl2; const wp = path.join(out, 'clip.webm'); await d2.saveAs(wp);
  const pr = cp.execSync(`ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=codec_name,width,height,nb_read_frames -show_entries format=duration -of default=nw=1 ${wp}`).toString().replace(/\n/g, ' ');
  ok('the clip is a valid VP8 webm with every frame', /codec_name=vp8/.test(pr) && /width=640/.test(pr) && /height=360/.test(pr) && /nb_read_frames=6/.test(pr), pr);
  ok('and the right duration', /duration=0\.5/.test(pr), pr);
  console.log('errors', errs.slice(0, 5));
  await b.close(); server.close();
})();
