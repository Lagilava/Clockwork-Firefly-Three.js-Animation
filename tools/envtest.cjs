// Boots the Sculptor and drives the Environment tab: picking, numbers, the gizmo, live code, copy and paste,
// duplicate, hide, undo, saving into a project and playing it in the film. Saves screenshots.
// Usage: node tools/envtest.cjs <outDir>   (env THREE_ROOT, BROWSER_EXECUTABLE, GV_VIEWPORT as in gvtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(root, '.validation', 'env');
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
  const shot = async (n) => { await p.waitForTimeout(1100); await p.screenshot({ path: path.join(out, n + '.png') }); };
  const E = (fn, arg) => p.evaluate(fn, arg);
  // --- the tab
  await p.click('[data-itab=env]'); await E(() => __godview.setSet('roof')); await E(() => __godview.setView('aerial')); await p.waitForTimeout(600);
  ok(await E(() => __godview.envMode && !document.querySelector('#gvIEnv').classList.contains('hidden')), 'Environment tab opens and turns on map editing');
  ok(await E(() => document.querySelector('#gv').dataset.page === 'map'), 'it switches to the roomy Map page');
  ok((await E(() => document.querySelectorAll('#eList .envgrp').length)) >= 3, 'outliner groups: houses, pines, lamps, landmarks');
  await shot('env-1-tab');
  // --- select a house from the list, frame it
  const id = 'roof/house/40';
  await E((id) => { const a = __godview.envApi; a.select(a.env.get(id), { frame: true }); }, id);
  await p.waitForTimeout(500);
  ok(await E(() => !!document.querySelector('#eCode') && document.querySelector('#eCode').value.includes('"House"')), 'selecting shows the element code');
  await shot('env-2-selected');
  // --- click it in the viewport
  const pt = await E((id) => { const a = __godview.envApi, g = __godview, T = g.dbg.THREE, el = a.env.get(id), bb = a.env.boundsOf(el), c = bb.getCenter(new T.Vector3()); a.select(null); const v = c.clone().project(g.dbg.camera), r = g.dbg.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; }, id);
  await p.mouse.click(pt.x, pt.y); await p.waitForTimeout(500);
  const picked = await E(() => __godview.envApi.EV.sel && __godview.envApi.EV.sel.id);
  ok(picked === id || /^roof\//.test(picked || ''), 'clicking in the viewport selects an element (' + picked + ')');
  await E((id) => { const a = __godview.envApi; a.select(a.env.get(id)); }, id);
  // --- numbers
  const before = await E((id) => __godview.envApi.env.get(id).st.p.slice(), id);
  await p.fill('#ePx', String(before[0] + 6)); await p.waitForTimeout(300);
  const after = await E((id) => __godview.envApi.env.get(id).st.p.slice(), id);
  ok(Math.abs(after[0] - before[0] - 6) < 0.01, 'typing a position moves the house by exactly that');
  await p.fill('#eSh', '20'); await p.waitForTimeout(300);
  const dims = await E((id) => __godview.envApi.env.get(id).st.s.slice(), id);
  ok(dims[1] > 1 && Math.abs(dims[0] - dims[1]) < 1e-6, 'size keeps the proportions when asked to');
  // --- gizmo, simulated at the handler
  await E(() => { const a = __godview.envApi, t = a.tc, pr = a.proxy; t.dispatchEvent({ type: 'dragging-changed', value: true }); pr.position.x += 4; t.dispatchEvent({ type: 'objectChange' }); t.dispatchEvent({ type: 'dragging-changed', value: false }); });
  const moved = await E((id) => __godview.envApi.env.get(id).st.p[0], id);
  ok(Math.abs(moved - (before[0] + 10)) < 0.01, 'dragging the gizmo moves the element (' + moved.toFixed(2) + ')');
  // --- live code
  const code = JSON.parse(await E(() => document.querySelector('#eCode').value)); code.turn = 45; code.wallColor = '#d04030'; code.roofColor = '#203040';
  await p.fill('#eCode', JSON.stringify(code, null, 2)); await p.waitForFunction((id) => __godview.envApi.env.get(id).st.r === 45, id, { timeout: 15000 }).catch(() => {});
  const st = await E((id) => { const e = __godview.envApi.env.get(id); return { r: e.st.r, c: e.st.c, c2: e.st.c2 }; }, id);
  ok(st.r === 45 && st.c === '#d04030' && st.c2 === '#203040', 'editing the code changes the map live ' + JSON.stringify(st));
  ok((await E(() => document.querySelector('#eMsg').textContent)).includes('Applied'), 'the code box says it applied');
  await shot('env-3-edited');
  // broken code
  const msgHas = (re) => p.waitForFunction((s) => new RegExp(s).test(document.querySelector('#eMsg').innerText), re, { timeout: 8000 }).then(() => true, () => false);
  await p.fill('#eCode', '{ "position": [1, 2] '); const m1ok = await msgHas('not valid');
  ok(m1ok, 'broken code gets a plain message: ' + await E(() => document.querySelector('#eMsg').innerText));
  await p.fill('#eCode', JSON.stringify({ ...code, size: 'big', position: [1, 2] })); const m2ok = await msgHas('"size" needs');
  const m2 = await E(() => document.querySelector('#eMsg').innerText); ok(m2ok && /position/.test(m2), 'wrong values list every problem: ' + m2.replace(/\n/g, ' | '));
  // --- copy, then paste onto another house (look only), then add as new
  await E(() => __godview.envApi.select(__godview.envApi.env.get('roof/house/40')));
  await p.click('[data-ea=copy]'); await p.waitForTimeout(300);
  const clip = await E(() => navigator.clipboard.readText()); ok(clip.includes('"wallColor": "#d04030"'), 'Copy code puts the snippet on the clipboard');
  await E(() => __godview.envApi.select(__godview.envApi.env.get('roof/house/41')));
  const p41 = await E(() => __godview.envApi.env.get('roof/house/41').st.p.slice());
  await p.click('[data-ea=paste]'); await p.waitForTimeout(500);
  const e41 = await E(() => { const e = __godview.envApi.env.get('roof/house/41'); return { p: e.st.p.slice(), c: e.st.c }; });
  ok(e41.c === '#d04030' && JSON.stringify(e41.p) === JSON.stringify(p41), 'paste onto another house copies its look but keeps its place');
  const n0 = await E(() => __godview.envApi.env.count());
  await E((t) => __godview.envApi.addFromCode(t), clip); await p.waitForTimeout(300);
  const added = await E(() => __godview.envApi.env.els.filter((e) => e.added).map((e) => e.id));
  ok(added.length === 1 && /house\/\+1$/.test(added[0]), 'Add as new makes a house of its own: ' + added);
  // --- duplicate / hide / undo
  await p.keyboard.press('d'); await p.waitForTimeout(300);
  ok((await E(() => __godview.envApi.env.els.filter((e) => e.added).length)) === 2, 'D duplicates the selected element');
  await p.keyboard.press('h'); await p.waitForTimeout(300);
  ok(await E(() => __godview.envApi.EV.sel.st.hide), 'H hides it');
  await shot('env-4-added');
  const ser = await E(() => JSON.stringify(__godview.envApi.env.serialize()));
  await E(() => __godview.history.go(-1)); await p.waitForTimeout(500);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(500);
  const ser2 = await E(() => JSON.stringify(__godview.envApi.env.serialize()));
  ok(ser !== ser2, 'undo steps the map back');
  await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(500);
  // --- landmarks and trees
  await E(() => __godview.setSet('forest')); await p.waitForTimeout(600);
  await E(() => { const a = __godview.envApi; a.select(a.env.get('forest/tree/12'), { frame: true }); a.change(a.EV.sel, { s: [2, 2, 2], c: '#e07020' }); });
  await shot('env-5-tree');
  await E(() => __godview.setSet('roof')); await p.waitForTimeout(400);
  await E(() => { const a = __godview.envApi; a.select(a.env.get('roof/landmark/clock-tower'), { frame: true }); a.change(a.EV.sel, { p: [a.EV.sel.st.p[0] + 12, a.EV.sel.st.p[1], a.EV.sel.st.p[2]], r: 25 }); });
  await shot('env-6-tower');
  // --- saving: project, export, play in the film
  await E(() => __godview.projects.persist());
  const exp = await E(() => { const r = JSON.parse(document.querySelector('#xText') ? '{}' : '{}'); return __godview.projects.store().draft.env; });
  ok(exp && exp.edits && Object.keys(exp.edits).length >= 3, 'the draft carries the map changes: ' + Object.keys(exp.edits).length + ' edits, ' + (exp.added || []).length + ' added');
  await E(() => document.querySelector('[data-itab=export]').click()); await p.waitForTimeout(300);
  ok((await E(() => document.querySelector('#gvIExport').textContent)).includes('moved, resized, recoloured or added'), 'the Project tab lists the map changes');
  // reload: the draft comes back
  await p.reload(); await p.waitForFunction(() => window.__godview, null, { timeout: 420000 }); await p.waitForTimeout(1500);
  const back = await E(() => ({ n: __godview.envApi.env.count(), h40: __godview.envApi.env.get('roof/house/40').st.c }));
  ok(back.n >= 3 && back.h40 === '#d04030', 'a reload brings the changes back from the autosaved draft ' + JSON.stringify(back));
  await E(() => { document.querySelector('[data-itab=env]').click(); __godview.setSet('roof'); }); await p.waitForTimeout(500);
  await shot('env-7-reloaded');
  // the film plays the draft
  const p2 = await ctx.newPage(); const errs2 = []; p2.on('pageerror', (e) => errs2.push('PAGEERR ' + e.message));
  await p2.goto(base + '/Clockwork_Firefly_fullfilm.html?project=draft');
  await p2.waitForFunction(() => window.__film && window.__film.env, null, { timeout: 420000 });
  const filmEnv = await p2.evaluate(() => ({ n: __film.env.count(), c: __film.env.get('roof/house/40').st.c }));
  ok(filmEnv.n >= 3 && filmEnv.c === '#d04030', 'Play in film shows the same map changes ' + JSON.stringify(filmEnv));
  ok(errs2.length === 0, 'film page has no errors ' + errs2.slice(0, 3));
  console.log('errors', errs.slice(0, 12));
  ok(errs.length === 0, 'the desk had no page errors');
  await b.close(); server.close();
  if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
