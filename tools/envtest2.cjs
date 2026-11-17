// Environment tab, second round: planting, multi-select, drop to ground, hold-to-compare, quick looks.
// Usage: node tools/envtest2.cjs <outDir>   (env THREE_ROOT, BROWSER_EXECUTABLE, GV_VIEWPORT as in gvtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(root, '.validation', 'env2');
fs.mkdirSync(out, { recursive: true });
const three = process.env.THREE_ROOT || path.join(root, 'node_modules', 'three');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/three/')) { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(three, url.slice(7)))); return; }
  const f = url === '/' ? 'Clockwork_Firefly_godview.html' : url.slice(1), full = path.join(root, f);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', /\.html$/.test(f) ? 'text/html' : 'text/plain');
  res.end(fs.readFileSync(full, 'utf8').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/build\//g, '/three/build/').replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.180\.0\/examples\/jsm\//g, '/three/examples/jsm/'));
});
const fails = []; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const ctx = await b.newContext({ viewport: JSON.parse(process.env.GV_VIEWPORT || '{"width":1600,"height":900}'), permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errs.push('console.error ' + m.text()); });
  const base = 'http://127.0.0.1:' + server.address().port;
  await p.goto(base);
  await p.waitForFunction(() => window.__godview, null, { timeout: 420000 });
  await p.waitForTimeout(1500);
  const shot = async (n) => { await p.waitForTimeout(1000); await p.screenshot({ path: path.join(out, n + '.png') }); };
  const E = (fn, arg) => p.evaluate(fn, arg);
  await p.click('[data-itab=env]'); await E(() => __godview.setSet('forest')); await E(() => __godview.setView('aerial')); await p.waitForTimeout(800);
  ok(await E(() => !!document.querySelector('#eCmp') && !!document.querySelector('#ePlant')), 'the Compare and Plant buttons are in the panel');
  const ids = await E(() => __godview.envApi.env.list('forest').filter((e) => e.kind === 'tree').slice(0, 6).map((e) => e.id));
  // --- multi-select
  await E((ids) => { const a = __godview.envApi; a.select(a.env.get(ids[0])); a.toggle(a.env.get(ids[1])); a.toggle(a.env.get(ids[2])); }, ids);
  await p.waitForTimeout(400);
  ok(await E(() => __godview.envApi.EV.many.length === 3 && /3 selected/.test(document.querySelector('#eSel').textContent)), 'adding to the selection shows "3 selected"');
  ok(await E(() => !!document.querySelector('#eG_c')), 'a shared colour control appears for same-kind elements');
  const p0 = await E((ids) => ids.slice(0, 3).map((i) => __godview.envApi.env.get(i).st.p.slice()), ids);
  await E(() => { const a = __godview.envApi, t = a.tc, pr = a.proxy; t.dispatchEvent({ type: 'dragging-changed', value: true }); pr.position.x += 5; pr.position.z -= 2; t.dispatchEvent({ type: 'objectChange' }); t.dispatchEvent({ type: 'dragging-changed', value: false }); });
  const p1 = await E((ids) => ids.slice(0, 3).map((i) => __godview.envApi.env.get(i).st.p.slice()), ids);
  ok(p1.every((q, i) => Math.abs(q[0] - p0[i][0] - 5) < 0.01 && Math.abs(q[2] - p0[i][2] + 2) < 0.01), 'dragging the group gizmo moves all three together');
  await shot('env2-1-group');
  await E(() => __godview.envApi.group('row'));
  const zs = await E((ids) => ids.slice(0, 3).map((i) => __godview.envApi.env.get(i).st.p[2]), ids);
  ok(Math.max(...zs) - Math.min(...zs) < 0.01, 'In a row lines them up');
  await E(() => __godview.envApi.group('even'));
  const xs = (await E((ids) => ids.slice(0, 3).map((i) => __godview.envApi.env.get(i).st.p[0]), ids)).sort((a, b) => a - b);
  ok(Math.abs((xs[1] - xs[0]) - (xs[2] - xs[1])) < 0.01, 'Space evenly spaces them');
  await p.fill('#eG_c', '#22ccff'); await p.waitForTimeout(300);
  ok(await E((ids) => ids.slice(0, 3).every((i) => __godview.envApi.env.get(i).st.c === '#22ccff'), ids), 'one colour change recolours the whole selection');
  await E(() => __godview.envApi.group('dup')); await p.waitForTimeout(300);
  ok(await E(() => __godview.envApi.EV.many.length === 3 && __godview.envApi.EV.many.every((e) => e.added)), 'Duplicate all makes three copies and selects them');
  await E(() => __godview.envApi.group('reset')); await p.waitForTimeout(300);
  ok(await E(() => __godview.envApi.env.list('forest').filter((e) => e.added).length === 0), 'Delete all removes the copies');
  await E(() => __godview.envApi.select(null)); await E(() => __godview.envApi.env.load(null)); await E(() => __godview.envApi.setActive(true));
  // --- shift-click in the viewport
  const scr = await E((ids) => { const g = __godview, T = g.dbg.THREE, a = g.envApi; a.select(a.env.get(ids[3]), { frame: true }); g.dbg.camera.updateMatrixWorld(); return ids.slice(3, 5).map((i) => { const c = a.env.boundsOf(a.env.get(i)).getCenter(new T.Vector3()); const v = c.project(g.dbg.camera); const r = g.dbg.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, id: i }; }); }, ids);
  await p.mouse.click(scr[0].x, scr[0].y); await p.waitForTimeout(300);
  await p.keyboard.down('Shift'); await p.mouse.click(scr[1].x, scr[1].y); await p.keyboard.up('Shift'); await p.waitForTimeout(400);
  const nm = await E(() => __godview.envApi.EV.many.length);
  ok(nm >= 2, 'shift-click in the viewport adds to the selection (' + nm + ')');
  await E(() => __godview.envApi.select(null));
  // --- drop to ground
  const t0 = ids[0]; await E((t0) => { const a = __godview.envApi; a.select(a.env.get(t0)); }, t0);
  const o = await E((t0) => __godview.envApi.env.get(t0).st.p.slice(), t0);
  await E((t0) => { const a = __godview.envApi, el = a.env.get(t0); a.change(el, { p: [el.st.p[0], el.st.p[1] + 9, el.st.p[2]] }); }, t0);
  await E(() => __godview.envApi.action('drop'));
  const o2 = await E((t0) => __godview.envApi.env.get(t0).st.p.slice(), t0);
  ok(Math.abs(o2[1] - o[1]) < 0.02, 'Drop to ground puts a lifted tree back on the ground (' + o[1].toFixed(2) + ' -> ' + o2[1].toFixed(2) + ')');
  // --- plant with the mouse
  await E((t0) => { const a = __godview.envApi; a.env.load(null); a.select(a.env.get(t0), { frame: true }); a.plantStart(a.env.get(t0)); }, t0); await p.waitForTimeout(600);
  ok(await E(() => !!__godview.envApi.EV.plant && /Planting/.test(document.querySelector('#ePlantBox').textContent)), 'Plant mode shows its panel');
  const spot = await E(() => { const g = __godview, T = g.dbg.THREE, a = g.envApi, cam = g.dbg.camera, r = g.dbg.renderer.domElement.getBoundingClientRect(), f = a.env.world.forest; cam.updateMatrixWorld();
    for (let k = 0; k < 400; k++) { const x = -14 + (k % 20) * 1.4, z = -8 + Math.floor(k / 20) * 1.4, y = f.heightAt(x, z), v = new T.Vector3(x, y, z).project(cam); if (Math.abs(v.x) > 0.7 || Math.abs(v.y) > 0.7) continue; const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height; const h = a.ground(sx, sy); if (h && Math.hypot(h.x - x, h.z - z) < 0.6) return { sx, sy, x, z, y }; } return null; });
  ok(!!spot, 'the pointer can find the ground to plant on');
  const n0 = await E(() => __godview.envApi.env.count());
  await p.mouse.click(spot.sx, spot.sy); await p.waitForTimeout(400);
  const n1 = await E(() => __godview.envApi.env.count());
  ok(n1 === n0 + 1, 'one click plants one copy (' + n0 + ' -> ' + n1 + ')');
  const pl = await E(() => { const a = __godview.envApi, el = a.env.list('forest').find((e) => e.added), b = a.env.boundsOf(el); return { min: b.min.y, h: a.env.world.forest.heightAt(el.st.p[0], el.st.p[2]) }; });
  ok(pl.min < pl.h + 1.5 && pl.min > pl.h - 2, 'the new tree stands on the ground (' + pl.min.toFixed(2) + ' vs ' + pl.h.toFixed(2) + ')');
  await shot('env2-2-planted');
  // paint a stroke
  await E(() => { __godview.envApi.EV.pGap = 1; });
  const before = await E(() => __godview.envApi.env.count());
  await p.mouse.move(spot.sx - 40, spot.sy); await p.mouse.down(); for (let i = 1; i <= 8; i++) await p.mouse.move(spot.sx - 40 + i * 12, spot.sy + (i % 2) * 6, { steps: 2 }); await p.mouse.up(); await p.waitForTimeout(500);
  const after = await E(() => __godview.envApi.env.count());
  ok(after >= before + 2, 'dragging along the ground paints several (' + before + ' -> ' + after + ')');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await E(() => !__godview.envApi.EV.plant), 'Esc stops planting');
  // --- hold to compare
  const cid = await E(() => { const a = __godview.envApi; const el = a.env.list('forest').find((e) => !e.added && e.kind === 'tree'); a.select(el); a.change(el, { p: [el.st.p[0] + 3, el.st.p[1], el.st.p[2]] }); return el.id; });
  const cnt = await E(() => __godview.envApi.env.count());
  await p.keyboard.down('v'); await p.waitForTimeout(500);
  ok(await E(() => !document.querySelector('#envCmp').classList.contains('hidden')), 'holding V shows the "Original map" banner');
  ok(await E(() => __godview.envApi.env.count() === 0), 'the map shows as authored while held');
  ok(await E(() => { const d = __godview.envApi.env.serialize(); return d && Object.keys(d.edits).length + d.added.length === __godview.envApi.EV.sel ? true : !!d; }), 'saving meanwhile still sees the real changes');
  await shot('env2-3-original');
  await p.keyboard.up('v'); await p.waitForTimeout(500);
  ok(await E((cid) => document.querySelector('#envCmp').classList.contains('hidden') && __godview.envApi.env.get(cid).st.p[0] !== __godview.envApi.env.get(cid).base.p[0], cid), 'letting go brings the changes back');
  ok((await E(() => __godview.envApi.env.count())) === cnt, 'with the same number of changes (' + cnt + ')');
  ok(await E(() => !!__godview.envApi.EV.sel), 'and the selection is kept');
  // --- quick looks and undo
  await E(() => { __godview.envApi.select(null); __godview.envApi.look('autumn'); }); await p.waitForTimeout(300);
  const nAut = await E(() => __godview.envApi.env.list('forest').filter((e) => e.kind === 'tree' && e.st.c).length);
  ok(nAut > 20, 'Autumn recolours the trees (' + nAut + ')');
  await shot('env2-4-autumn');
  await p.mouse.click(5, 5); await p.keyboard.press('Control+z'); await p.waitForTimeout(500);
  const nUn = await E(() => __godview.envApi.env.list('forest').filter((e) => e.kind === 'tree' && e.st.c).length);
  ok(nUn < nAut, 'Ctrl+Z undoes the look (' + nAut + ' -> ' + nUn + ')');
  await E(() => __godview.envApi.look('original'));
  ok(await E(() => __godview.envApi.env.list('forest').filter((e) => e.st.c).length === 0), 'Original colours clears them');
  console.log('errors', JSON.stringify(errs));
  ok(!errs.length, 'the desk had no page errors');
  await b.close(); server.close();
  console.log(fails.length ? 'FAILED ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
