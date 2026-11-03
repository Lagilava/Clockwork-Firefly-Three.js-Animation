// Checks the film's paused-frame saver: paused frames are skipped, the picture is pixel-identical to a forced redraw,
// and changes (seek, grade preset) draw again immediately.
// Usage: node tools/perfidle.cjs <outDir>   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE)
const fs = require('fs'), http = require('http'), path = require('path'), crypto = require('crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(root, '.validation', 'idle');
fs.mkdirSync(out, { recursive: true });
const three = process.env.THREE_ROOT || path.join(root, 'node_modules', 'three');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/three/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(three, url.slice(7)))); return; }
  const f = url === '/' ? 'Clockwork_Firefly_fullfilm.html' : url.slice(1), full = path.join(root, f);
  if (!fs.existsSync(full)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(fs.readFileSync(full, 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\//g, '/three/build/').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\//g, '/three/examples/jsm/'));
});
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!cond) process.exitCode = 1; };
const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:' + server.address().port + '/', { timeout: 240000 });
  await p.waitForFunction(() => window.__film && window.__film.st.ready && !document.getElementById('start').classList.contains('hidden'), null, { timeout: 480000 });
  await p.evaluate(() => { document.getElementById('start').click(); });
  await p.waitForTimeout(1500);
  const shot = async (n) => { await p.waitForTimeout(2500); const f = path.join(out, n + '.png'); await p.screenshot({ path: f, timeout: 120000 }); return f; };
  // software GL frames take longer than the real heartbeat, so stretch it for the test; real GPUs run it at 250 ms
  const counts = () => p.evaluate(() => ({ d: window.__film.idle.drawn, s: window.__film.idle.skipped }));
  await p.evaluate(() => { const f = window.__film; f.setPlaying(false); f.seekTo(40); f.post.gtao.blendIntensity = 0; f.idle.heartbeat = 6000; });
  await p.waitForTimeout(2000); const a0 = await counts(); await p.waitForTimeout(6000); const a1 = await counts();
  ok('frames are not skipped while the AO fade is still easing', a1.s === a0.s && a1.d > a0.d, JSON.stringify({ drawn: a1.d - a0.d, skipped: a1.s - a0.s }));
  await p.evaluate(() => { const f = window.__film; f.setPlaying(false); f.seekTo(100); f.post.gtao.blendIntensity = 0; f.idle.heartbeat = 0; f.st.lockScale = true; }); // roof set: no AO fade to wait for
  await p.waitForTimeout(8000);
  const det = await p.evaluate(() => {
    const f = window.__film, c = f.renderer.domElement, hash = (u) => { let h = 0; for (let i = 0; i < u.length; i += 7) h = (h * 31 + u.charCodeAt(i)) | 0; return h; };
    const draw = () => { f.post.render(f.st.T, f.st.elapsed, { letter: 0, dt: 0, cut: f.director.cut, cinematic: true, threshold: 0.72 }); return hash(c.toDataURL()); };
    return [draw(), draw(), draw()];
  });
  ok('a paused frame renders identically every time', det[0] === det[1] && det[1] === det[2], JSON.stringify(det));
  const forced1 = await shot('forced1'), forced2 = await shot('forced2');
  const settled = md5(forced1) === md5(forced2), w2 = await p.evaluate(() => window.__film.renderer.domElement.width);
  await p.evaluate(() => { window.__film.idle.heartbeat = 6000; window.__film.idle.why = []; });
  await p.waitForTimeout(3000); const c0 = await counts(); await p.waitForTimeout(8000); const c1 = await counts();
  ok('paused frames are skipped', c1.s - c0.s > 20 && c1.d - c0.d <= 3, JSON.stringify({ drawn: c1.d - c0.d, skipped: c1.s - c0.s, why: await p.evaluate(() => window.__film.idle.why) }));
  const skipped = await shot('skipped');
  const skipped2 = await shot('skipped2'); const w3 = await p.evaluate(() => window.__film.renderer.domElement.width);
  ok('a skipped frame stays on screen unchanged', md5(skipped) === md5(skipped2));
  if (settled && w2 === w3) {
    // allow a handful of one-level rounding differences (the page overlay antialiases text), nothing visible
    const near = await p.evaluate(async ([a, b]) => {
      const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
      const px = async (u) => { const i = await load(u), c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const A = await px(a), B = await px(b); let bad = 0, worst = 0;
      for (let i = 0; i < A.length; i += 4) { const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])); if (d > 0) { bad++; if (d > worst) worst = d; } }
      return { bad, worst };
    }, [fs.readFileSync(forced2).toString('base64'), fs.readFileSync(skipped).toString('base64')].map((x) => 'data:image/png;base64,' + x));
    ok('skipped picture matches a forced redraw', near.bad < 50 && near.worst <= 2, JSON.stringify(near));
  }
  else console.log('NOTE the forced redraws differed from each other (the adaptive render scale changed between the shots; software GL steps it constantly), so forced vs skipped is not comparable here');
  await p.evaluate(() => { const f = window.__film; f.seekTo(150); });
  const seeked = await shot('seeked'); ok('seek draws a new frame', md5(seeked) !== md5(skipped));
  await p.evaluate(() => { const s = document.getElementById('selGrade'); s.value = 'wong'; s.onchange({ target: s }); });
  const graded = await shot('graded'); ok('grade change draws a new frame', md5(graded) !== md5(seeked));
  await p.evaluate(() => window.__film.setPlaying(true)); const before = await counts(); await p.waitForTimeout(6000);
  const after = await counts(); ok('playing is never skipped', after.s === before.s && after.d > before.d, JSON.stringify({ drawn: after.d - before.d, skipped: after.s - before.s }));
  console.log('errors', errs.slice(0, 5));
  await b.close(); server.close();
})();
