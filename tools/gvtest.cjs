// Boots the director's desk in headless Chromium and saves screenshots.
// Usage: node tools/gvtest.cjs <outDir>   (env THREE_ROOT=path to node_modules/three for offline runs, GV_STEPS=json)
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(root, '.validation', 'godview');
fs.mkdirSync(out, { recursive: true });
const three = process.env.THREE_ROOT || path.join(root, 'node_modules', 'three');
const file = process.env.GV_FILE || 'Clockwork_Firefly_godview.html';
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/three/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(three, req.url.slice(7)))); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(fs.readFileSync(path.join(root, file), 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\//g, '/three/build/').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\//g, '/three/examples/jsm/'));
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const vp = JSON.parse(process.env.GV_VIEWPORT || '{"width":1600,"height":900}');
  const p = await b.newPage({ viewport: vp });
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('console.error ' + m.text()); });
  await p.goto('http://127.0.0.1:' + server.address().port);
  await p.waitForFunction(() => window.__godview, null, { timeout: 420000 });
  await p.waitForTimeout(2500);
  const shot = async (n) => { await p.waitForTimeout(900); await p.screenshot({ path: path.join(out, n + '.png') }); };
  const steps = JSON.parse(process.env.GV_STEPS || '[]');
  await shot('desk-0');
  for (const s of steps) {
    if (s.eval) { const r = await p.evaluate(s.eval); if (r !== undefined) console.log(s.name || 'eval', JSON.stringify(r)); }
    if (s.click) await p.evaluate((sel) => document.querySelector(sel).click(), s.click);
    if (s.mclick) await p.click(s.mclick);
    if (s.drag) { const [x1, y1, x2, y2] = s.drag; await p.mouse.move(x1, y1); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(x1 + (x2 - x1) * i / 8, y1 + (y2 - y1) * i / 8); await p.mouse.up(); }
    if (s.fill) await p.fill(s.fill[0], s.fill[1]);
    if (s.key) await p.keyboard.press(s.key);
    if (s.wait) await p.waitForTimeout(s.wait);
    if (s.shot) await shot(s.shot);
  }
  console.log('errors', errs.slice(0, 12));
  await b.close(); server.close();
})();
