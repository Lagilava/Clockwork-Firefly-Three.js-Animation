// End-to-end check of custom projects: save in the desk, list on the projects page, play in the film.
// Usage: node tools/projtest.cjs <outDir>   (env THREE_ROOT, PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE like gvtest.cjs)
const fs = require('fs'), http = require('http'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..'), out = process.argv[2] || path.join(root, '.validation', 'projects');
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
  const base = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE || '/opt/pw-browsers/chromium', args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-gl=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const errs = []; const watch = (p) => { p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); };
  const desk = await ctx.newPage(); watch(desk);
  await desk.goto(base + '/Clockwork_Firefly_godview.html'); await desk.waitForFunction(() => window.__godview, null, { timeout: 420000 }); await desk.waitForTimeout(2000);
  ok('fresh desk starts empty', await desk.evaluate(() => window.__godview.projects.state()) === 'empty');
  await desk.evaluate(() => window.__godview.selectShot(10)); await desk.waitForTimeout(800);
  await desk.click('#iEdit'); await desk.waitForTimeout(1200);
  await desk.fill('#gvIShot [data-f=py]', '3.5'); await desk.waitForTimeout(600);
  ok('an edit makes an autosaved draft', await desk.evaluate(() => window.__godview.projects.state()) === 'draft');
  ok('save button enabled', await desk.evaluate(() => !document.querySelector('#gvSaveBtn').disabled));
  await desk.click('#gvSaveBtn'); await desk.waitForSelector('#gvDlg:not(.hidden)');
  await desk.fill('#gvDlgInput', 'Test cut'); await desk.screenshot({ path: path.join(out, 'save-dialog.png') });
  await desk.click('#gvDlgYes'); await desk.waitForTimeout(700);
  const after = await desk.evaluate(() => { const g = window.__godview.projects, s = g.store(); return { state: g.state(), n: Object.keys(s.projects).length, name: document.querySelector('#gvProjName').textContent, id: g.from() }; });
  ok('saved as a named project', after.state === 'clean' && after.n === 1 && after.name === 'Test cut', JSON.stringify(after));
  await desk.fill('#gvIShot [data-f=py]', '3.2'); await desk.waitForTimeout(700);
  ok('editing a saved project shows unsaved changes', await desk.evaluate(() => window.__godview.projects.state()) === 'dirty');
  await desk.keyboard.press('Control+s'); await desk.waitForTimeout(700);
  ok('Ctrl+S saves it', await desk.evaluate(() => window.__godview.projects.state()) === 'clean');
  await desk.click('#gvProjBtn'); await desk.waitForTimeout(300); await desk.screenshot({ path: path.join(out, 'menu.png') });
  const id = after.id;
  const list = await ctx.newPage(); watch(list); await list.goto(base + '/projects.html'); await list.waitForTimeout(500);
  await list.screenshot({ path: path.join(out, 'projects-page.png') });
  const cards = await list.$$eval('.card h2', (e) => e.map((x) => x.textContent));
  ok('projects page lists it', cards.includes('Test cut'), JSON.stringify(cards));
  const play = await list.$eval('.card a.btn.pri', (a) => a.getAttribute('href')); ok('play link points at the film', play === 'Clockwork_Firefly_fullfilm.html?project=' + id, play);
  const home = await ctx.newPage(); watch(home); await home.goto(base + '/'); await home.waitForTimeout(400); await home.screenshot({ path: path.join(out, 'start.png') });
  ok('start page has three buttons', (await home.$$eval('main a', (a) => a.map((x) => x.firstChild.textContent))).join('|') === 'Custom projects|Default film|God\'s eye');
  await desk.close();
  const film = await ctx.newPage(); watch(film); await film.goto(base + '/' + play);
  await film.waitForSelector('#projChip', { timeout: 420000 }); await film.waitForTimeout(1500);
  ok('film shows the project chip', (await film.$eval('#projChip', (e) => e.textContent)).includes('Test cut'));
  await film.screenshot({ path: path.join(out, 'film.png'), timeout: 180000 }); await film.close();
  const plain = await ctx.newPage(); watch(plain); await plain.goto(base + '/Clockwork_Firefly_fullfilm.html', { timeout: 180000 }); await plain.waitForTimeout(8000);
  ok('plain film has no project chip', (await plain.$('#projChip')) === null);
  await plain.close();
  const d2 = await ctx.newPage(); watch(d2); await d2.goto(base + '/Clockwork_Firefly_godview.html?open=' + id); await d2.waitForFunction(() => window.__godview, null, { timeout: 420000 }); await d2.waitForTimeout(1500);
  ok('?open= loads the project in the desk', await d2.evaluate(() => document.querySelector('#gvProjName').textContent) === 'Test cut' && await d2.evaluate(() => window.__godview.projects.state()) === 'clean');
  await list.reload(); await list.click('button[data-a=rm]'); await list.waitForSelector('dialog[open]'); await list.click('#dlgYes'); await list.waitForTimeout(500);
  ok('delete removes it from the list', !(await list.$$eval('.card h2', (e) => e.map((x) => x.textContent))).includes('Test cut'));
  console.log('errors', errs.slice(0, 10));
  await b.close(); server.close();
})();
