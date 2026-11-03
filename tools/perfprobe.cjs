// Measures where the film spends its time: renderer load (draw calls, triangles, textures, programs) and
// CPU time per stage at sample moments through the film.
// Usage: node tools/perfprobe.cjs [file.html] [outJson]   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE, PERF_TIMES="12,60,...", PERF_W/H)
// The headless GPU is software (SwiftShader), so only CPU-side stage costs and scene load are comparable between runs, not absolute fps.
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const file = process.argv[2] || 'Clockwork_Firefly_fullfilm.html', outJson = process.argv[3];
const three = process.env.THREE_ROOT || path.join(root, 'node_modules', 'three');
const times = (process.env.PERF_TIMES || '12,32.6,60,100,150,200,250,290').split(',').map(Number);
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
  const p = await b.newPage({ viewport: { width: +(process.env.PERF_W || 1280), height: +(process.env.PERF_H || 720) } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  await p.goto('http://127.0.0.1:' + server.address().port + '/', { timeout: 240000 });
  await p.waitForFunction(() => window.__film && window.__film.st.ready && !document.getElementById('start').classList.contains('hidden'), null, { timeout: 480000 });
  const bootMs = Date.now() - t0;
  const out = { file, bootMs, samples: [] };
  await p.evaluate(() => {
    const f = window.__film, acc = (window.__acc = {});
    const wrap = (o, k, name) => { const fn = o[k].bind(o); o[k] = (...a) => { const s = performance.now(); const r = fn(...a); acc[name] = (acc[name] || 0) + performance.now() - s; return r; }; };
    wrap(f.anim, 'step', 'anim.step'); wrap(f.ember, 'update', 'ember.update'); wrap(f.world, 'update', 'world.update');
    wrap(f.director, 'update', 'director.update'); wrap(f.fx, 'update', 'fx.update'); wrap(f.post, 'render', 'post.render');
    document.getElementById('start').click();
  });
  for (const T of times) {
    const r = await p.evaluate(async (T) => {
      const f = window.__film; f.seekTo(T); f.setPlaying(true);
      for (const k in window.__acc) window.__acc[k] = 0;
      let frames = 0; const t = performance.now();
      await new Promise((res) => { const tick = () => { frames++; if (frames >= 40) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      const wall = performance.now() - t, info = f.renderer.info, stage = {};
      for (const k in window.__acc) stage[k] = +(window.__acc[k] / frames).toFixed(2);
      f.setPlaying(false);
      return { T, set: f.S.set, frames, wallPerFrameMs: +(wall / frames).toFixed(1), stageMsPerFrame: stage, calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs ? info.programs.length : null, pixelRatio: f.renderer.getPixelRatio() };
    }, T);
    out.samples.push(r); console.log(JSON.stringify(r));
  }
  console.log('bootMs', bootMs, 'errors', errs.slice(0, 5));
  if (outJson) fs.writeFileSync(outJson, JSON.stringify(out, null, 1));
  await b.close(); server.close();
})();
