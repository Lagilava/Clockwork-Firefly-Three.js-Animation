// Finds moments where the film compiles a new shader program while playing (each one is a visible hitch on real GPUs,
// because the driver stalls the frame). Steps through the film after boot and logs every time the program count grows.
// Usage: node tools/proghunt.cjs [file.html] [stepSeconds] [from] [to]   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE)
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const file = process.argv[2] || 'Clockwork_Firefly_fullfilm.html', step = +(process.argv[3] || 2.5), from = +(process.argv[4] || 0), to = +(process.argv[5] || 299);
const three = process.env.THREE_ROOT || path.join(root, 'node_modules', 'three');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/three/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(three, url.slice(7)))); return; }
  const f = url === '/' ? file : url.slice(1), full = path.join(root, f);
  if (!fs.existsSync(full)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(fs.readFileSync(full, 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\//g, '/three/build/').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\//g, '/three/examples/jsm/'));
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: +(process.env.HUNT_W || 640), height: +(process.env.HUNT_H || 360) } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://127.0.0.1:' + server.address().port + '/', { timeout: 240000 });
  await p.waitForFunction(() => window.__film && window.__film.st.ready && !document.getElementById('start').classList.contains('hidden'), null, { timeout: 480000 });
  await p.evaluate(() => { document.getElementById('start').click(); window.__film.setPlaying(false); window.__keys = new Set(window.__film.renderer.info.programs.map((x) => x.cacheKey)); });
  const base = await p.evaluate(() => window.__film.renderer.info.programs.length);
  console.log('programs after warm-up', base);
  const found = [];
  if (process.env.PLAY) { // play through at speed 2 and log every frame where a program appears, like a real viewing
    await p.evaluate(({ from, to }) => {
      const f = window.__film; f.seekTo(from); f.st.speed = 2; window.__log = []; window.__done = false;
      const poll = () => {
        const progs = f.renderer.info.programs, fresh = progs.filter((x) => !window.__keys.has(x.cacheKey));
        if (fresh.length) { fresh.forEach((x) => window.__keys.add(x.cacheKey)); window.__log.push({ T: +f.st.T.toFixed(2), set: f.S.set, n: fresh.length, keys: fresh.map((x) => (x.cacheKey || '').slice(0, 100)) }); }
        if (f.st.T >= to || f.st.ended) { window.__done = true; f.setPlaying(false); return; }
        requestAnimationFrame(poll);
      };
      f.setPlaying(true); requestAnimationFrame(poll);
    }, { from, to });
    for (;;) { await p.waitForTimeout(8000); const st = await p.evaluate(() => ({ T: window.__film.st.T, done: window.__done })); process.stdout.write('T=' + st.T.toFixed(1) + ' '); if (st.done) break; }
    const log = await p.evaluate(() => window.__log); console.log('\n' + log.map((r) => JSON.stringify({ T: r.T, set: r.set, newPrograms: r.n })).join('\n'));
    console.log('total new programs while playing:', log.reduce((a, r) => a + r.n, 0), 'errors', errs.slice(0, 3));
    fs.writeFileSync(process.env.PROG_OUT || '/tmp/proghunt.json', JSON.stringify(log, null, 1)); await b.close(); server.close(); return;
  }
  for (let T = from; T <= to; T += step) {
    const r = await p.evaluate(async (T) => {
      const f = window.__film; f.seekTo(T);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const progs = f.renderer.info.programs, fresh = progs.filter((x) => !window.__keys.has(x.cacheKey));
      fresh.forEach((x) => window.__keys.add(x.cacheKey));
      return { T, set: f.S.set, total: progs.length, fresh: fresh.map((x) => x.name + ' ' + (x.cacheKey || '').slice(0, 80)) };
    }, T);
    if (r.fresh.length) { found.push(r); console.log(JSON.stringify({ T: r.T, set: r.set, newPrograms: r.fresh.length, total: r.total, names: [...new Set(r.fresh.map((s) => s.split(' ')[0]))] })); }
  }
  console.log('total new programs after warm-up:', found.reduce((a, r) => a + r.fresh.length, 0), 'errors', errs.slice(0, 3));
  fs.writeFileSync(process.env.PROG_OUT || '/tmp/proghunt.json', JSON.stringify(found, null, 1));
  await b.close(); server.close();
})();
