// Checks the interactive map: focusing a set, zoom and pan, picking a shot, and dragging a camera key.
// Usage: node tools/maptest.cjs [outDir]   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE like projtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path'), os = require('os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(os.tmpdir(), 'maptest');
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
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.setDefaultTimeout(240000); await p.goto('http://127.0.0.1:' + server.address().port + '/Clockwork_Firefly_godview.html'); await p.waitForFunction(() => window.__godview, null, { timeout: 420000 }); await p.waitForTimeout(2000);
  await p.evaluate(() => { window.__film.st.lockScale = true; document.getElementById('gvMonOn').click(); });
  await p.click('#gvMapBtn'); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(out, 'map-all.png') });
  ok('the overview shows three sets', await p.evaluate(() => window.__godview.map.panels.length) === 6);
  // double-click a set to open it
  const pan0 = await p.evaluate(() => { const q = window.__godview.map.panels[2]; const r = document.getElementById('gvMapCanvas').getBoundingClientRect(); return [r.left + q.x0 + q.w / 2, r.top + q.y0 + q.h / 2]; });
  await p.mouse.dblclick(pan0[0], pan0[1]); await p.waitForTimeout(600);
  ok('double-click opens that set up close', await p.evaluate(() => window.__godview.map.set) === 'roof' && await p.evaluate(() => window.__godview.map.panels.length) === 2);
  // zoom with the wheel
  const q0 = await p.evaluate(() => { const q = window.__godview.map.panels[0], r = document.getElementById('gvMapCanvas').getBoundingClientRect(); return { s: q.V.s, x: r.left + q.x0 + q.w / 2, y: r.top + q.y0 + q.h / 2 }; });
  await p.mouse.move(q0.x, q0.y); await p.mouse.wheel(0, -600); await p.waitForTimeout(400);
  const s1 = await p.evaluate(() => window.__godview.map.panels[0].V.s); ok('the wheel zooms in', s1 > q0.s * 1.5, `${q0.s.toFixed(2)} -> ${s1.toFixed(2)}`);
  // pan
  const c0 = await p.evaluate(() => window.__godview.map.panels[0].V.cx);
  await p.mouse.move(q0.x + 150, q0.y + 150); await p.mouse.down(); await p.mouse.move(q0.x + 250, q0.y + 150, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
  const c1 = await p.evaluate(() => window.__godview.map.panels[0].V.cx); ok('dragging the background pans', c1 < c0 - 0.5, `${c0.toFixed(2)} -> ${c1.toFixed(2)}`);
  // camera dragging: edit a rooftop shot, switch to the cameras tool
  await p.evaluate(() => { const g = window.__godview; const i = [...Array(60).keys()].find((n) => g.shotOfSet(n) === 'roof'); g.selectShot(i, true); });
  if (await p.$eval('#gvMapEdit', (e) => !e.disabled)) await p.click('#gvMapEdit'); await p.waitForTimeout(800); await p.click('#gvMapTool [data-mt=cams]'); await p.click('#gvMapReset'); await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(out, 'map-cams.png') });
  const h = await p.evaluate(() => { const g = window.__godview, m = g.map, r = document.getElementById('gvMapCanvas').getBoundingClientRect(); const hd = m.hit.find((x) => x.kind === 'handle' && x.part === 'pos' && x.i === g.sel && x.panel === 0); const ov = g.ov[g.shotStart ? 0 : Object.keys(g.ov).find((t) => true)]; return hd ? { x: r.left + hd.x, y: r.top + hd.y, i: hd.i, n: hd.n } : null; });
  ok('the edited shot shows draggable camera keys', !!h, JSON.stringify(h));
  if (h) {
    const before = await p.evaluate(([i, n]) => { const g = window.__godview; const t0 = Object.keys(g.ov).find((t) => g.shotOfSet && true) && null; return null; }, [h.i, h.n]);
    const key = () => p.evaluate(([i, n]) => { const g = window.__godview; const s = g.sm; const sh = (window.__film.director, null); return JSON.stringify(Object.values(g.ov).filter((o) => o.keys.length > n).map((o) => o.keys[n].pos)); }, [h.i, h.n]);
    const k0 = await key();
    await p.mouse.move(h.x, h.y); await p.mouse.down(); await p.mouse.move(h.x + 60, h.y + 40, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(600);
    const k1 = await key(); ok('dragging a camera key moves it', k0 !== k1);
    ok('the move is a recorded edit you can undo', await p.evaluate(() => window.__godview.history.state().n) >= 1);
  }
  console.log('errors', errs.slice(0, 5));
  await b.close(); server.close();
})();
