// Checks the map-element runtime in the film itself: the element list, moving, recolouring, adding,
// the copy-and-paste snippet, saving and loading a list of changes, and that no change means no change.
// Usage: node tests/env-browser.cjs [outDir]   (env THREE_ROOT for offline runs, BROWSER_EXECUTABLE for a custom Chromium)
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(root, '.validation', 'env');
fs.mkdirSync(out, { recursive: true });
const three = process.env.THREE_ROOT || path.join(root, 'node_modules', 'three');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/three/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(three, url.slice(7)))); return; }
  const f = url === '/' ? 'Clockwork_Firefly_fullfilm.html' : url.slice(1), full = path.join(root, f);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', /\.html$/.test(f) ? 'text/html' : 'text/plain');
  res.end(fs.readFileSync(full, 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\//g, '/three/build/').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\//g, '/three/examples/jsm/'));
});
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) { errs.push('console.error ' + m.text()); if (process.env.ENV_DEBUG) console.log('console.error', m.text()); } });
  await p.goto('http://127.0.0.1:' + server.address().port);
  try { await p.waitForFunction(() => window.__film && window.__film.env, null, { timeout: 420000 }); } catch (e) { console.log('the film did not start. page errors:', errs.slice(0, 8)); throw e; }
  const r = await p.evaluate(() => {
    const env = window.__film.env, o = {};
    o.counts = Object.fromEntries(env.kinds('roof').concat(env.kinds('forest')).map((k) => [k, env.els.filter((e) => e.kind === k).length]));
    o.untouched = env.serialize();
    const house = env.get('roof/house/3'), before = JSON.stringify(house.st);
    const mesh = house.parts[0].m, M4 = mesh.matrixWorld.constructor, m = new M4(); mesh.getMatrixAt(3, m); const p0x = m.elements[12];
    env.set(house, { p: [house.st.p[0] + 5, house.st.p[1], house.st.p[2]], r: 30, s: [1.5, 2, 1.5], c: '#ff0000', c2: '#00ff00' });
    mesh.getMatrixAt(3, m);
    o.moved = +(m.elements[12] - p0x).toFixed(3); o.edited = env.count(); o.colored = !!mesh.instanceColor;
    const snap = env.snippet(house); o.snippet = snap;
    const ser = env.serialize(); o.ser = ser;
    // a copy and a round trip
    const tree = env.get('forest/tree/5'); const copy = env.duplicate(tree); o.copyId = copy && copy.id; o.copyParts = copy && copy.parts.length;
    const ser2 = env.serialize(); env.load(null); o.afterReset = env.serialize(); o.houseBack = JSON.stringify(env.get('roof/house/3').st) === before;
    env.load(ser2); o.reload = JSON.stringify(env.serialize()) === JSON.stringify(ser2);
    env.load(null);
    // snippet checks
    const e1 = env.get('roof/house/7'); const bad = env.check(e1, { position: [1, 2], size: 'big', color: 'red' }); o.badErrors = bad.errors;
    const wrong = env.check(e1, { what: 'Tree', id: 'forest/tree/1', position: [1, 2, 3] }); o.wrongKind = wrong.errors.length > 0;
    const good = env.check(e1, { position: [10, -20, 10], turn: 45, size: [6, 10, 6], wallColor: '#112233' }); o.goodErrors = good.errors; o.goodPatch = good.patch;
    o.parse = [env.parse('').ok, env.parse('{ nope').ok, env.parse('{"position":[1,2,3],}').ok];
    // a pick through the raycaster
    return o;
  });
  console.log(JSON.stringify(r, null, 1).slice(0, 2500));
  ok(r.counts.house > 100 && r.counts.tree > 100 && r.counts.pine > 20 && r.counts.lamp > 10 && r.counts.landmark >= 4, 'elements found: ' + JSON.stringify(r.counts));
  ok(r.untouched === null, 'no changes means nothing to save');
  ok(Math.abs(r.moved - 5) < 0.01, 'moving a house moves its instance by the same amount');
  ok(r.edited === 1 && r.colored, 'editing counts one element and recolours through instance colours');
  ok(r.ser && r.ser.edits['roof/house/3'] && r.ser.edits['roof/house/3'].c === '#ff0000', 'the change is saved with its colour');
  ok(r.copyId && /\+1$/.test(r.copyId) && r.copyParts >= 3, 'a copied tree gets its own id and parts');
  ok(r.afterReset === null && r.houseBack, 'loading nothing puts everything back as authored');
  ok(r.reload, 'a saved list reloads to the same list');
  ok(r.badErrors.length === 3 && r.wrongKind && r.goodErrors.length === 0, 'snippets: errors are plain and complete, a valid one passes');
  ok(r.parse[0] === false && r.parse[1] === false && r.parse[2] === true, 'snippet text: empty and broken fail, a trailing comma is forgiven');
  ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs.slice(0, 4)));
  await b.close(); server.close();
  if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
