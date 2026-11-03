const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.validation');
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, 'Clockwork_Firefly_fullfilm.html')));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.__film?.st.ready, null, { timeout: 240000 });
    await page.evaluate(() => {
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('start').classList.add('hidden');
      window.__directorUpdate = window.__film.director.update;
      window.__film.director.update = () => {};
      window.__film.seekTo(12);
    });
    const grades = {};
    for (const name of ['default', 'snyder', 'anderson', 'nolan', 'wong', 'villeneuve', 'coppola']) {
      await page.selectOption('#selGrade', name);
      grades[name] = await page.evaluate(() => {
        const f = window.__film;
        f.post.render(12, 0, { letter: 0 });
        const u = f.post.grade.uniforms;
        return [u.uSat.value, u.uContrast.value, ...u.uShadowTint.value.toArray(), ...u.uHighTint.value.toArray(), ...u.uMidTint.value.toArray()];
      });
      assert(grades[name].every(Number.isFinite), `Invalid grade values for ${name}`);
      if (name !== 'default') assert.notDeepEqual(grades[name], grades.default, `Grade ${name} matches default`);
    }
    await page.selectOption('#selGrade', 'default');
    const action = await page.evaluate(() => {
      const f = window.__film, bot = f.anim.bot;
      f.director.update = window.__directorUpdate;
      const chase = [], clearances = [], bounces = {};
      for (const t of [12, 50, 56, 64, 68, 92, 104, 106, 125, 150, 164, 240, 278]) {
        f.seekTo(t); f.ember.update(t, 0, f.anim);
        const c = bot.abd[0].children[0], a = c.localToWorld(f.camera.position.clone().set(0, -0.25, 0));
        const b = c.localToWorld(f.camera.position.clone().set(0, 0.25, 0));
        const ab = b.clone().sub(a), p = bot.gearA.mesh.getWorldPosition(f.camera.position.clone());
        const nearest = a.clone().addScaledVector(ab, Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())));
        clearances.push({ t, gap: p.distanceTo(nearest) - (0.3 + 2 * 0.3 / 16 * 0.97) * 0.76 - 0.30 });
        if ([12, 92, 150, 240].includes(t)) bounces[t] = f.world.surfaceBounce.intensity;
        if ([50, 56, 64, 68, 104, 106].includes(t)) {
          const away = f.ember.pos.clone().sub(f.S.root); away.y = 0; away.normalize();
          const yaw = f.ember.yaw;
          chase.push({ t, facingAway: Math.sin(yaw) * away.x + Math.cos(yaw) * away.z,
            speed: f.S.lureVel.length(), offset: f.S.root.clone().sub(f.ember.pos).toArray() });
        }
      }
      const moves = [];
      for (const [a, b] of [[122.6, 124.8], [164.5, 166.1], [243.5, 245.8], [272.7, 275.1]]) {
        f.seekTo(a); const p = f.camera.position.clone();
        f.seekTo(b); moves.push({ shot: a, distance: p.distanceTo(f.camera.position) });
      }
      f.seekTo(241.6);
      const framing = { head: f.S.head.clone().project(f.camera).toArray(), ember: f.ember.pos.clone().project(f.camera).toArray() };
      return { chase, clearances, bounces, moves, framing };
    });
    assert(action.clearances.every(x => x.gap > 0.02), `Gear/stalk intersection: ${JSON.stringify(action.clearances)}`);
    assert(action.chase.every(x => x.facingAway > -0.08), `Ember turns toward the robot during pursuit: ${JSON.stringify(action.chase)}`);
    assert(action.chase.every(x => x.speed > 0.5), `Ember's flight velocity was lost: ${JSON.stringify(action.chase)}`);
    assert(action.chase[0].offset.some((v, i) => Math.abs(v - action.chase[1].offset[i]) > 0.25), 'Robot simply copies Ember’s chase path');
    assert(Object.values(action.bounces).every(x => x > 0), 'Surface bounce is missing in a scene');
    assert(action.moves.every(x => x.distance > 0.25), `Chapter 3/4 camera move is too static: ${JSON.stringify(action.moves)}`);
    assert([action.framing.head, action.framing.ember].every(p => Math.abs(p[0]) < 0.95 && Math.abs(p[1]) < 0.95 && p[2] < 1), `Morning two-shot loses a character: ${JSON.stringify(action.framing)}`);
    for (const grade of ['default', 'snyder', 'anderson', 'wong']) {
      await page.selectOption('#selGrade', grade);
      await page.evaluate(() => { const f = window.__film; f.seekTo(165.2); f.post.render(165.2, 0, { letter: 0 }); });
      await page.screenshot({ path: path.join(out, `grade-${grade}.png`) });
    }
    await page.selectOption('#selGrade', 'default');
    for (const t of [56, 104, 123.5, 165.2, 241.6, 244.5, 273.5]) {
      await page.evaluate(t => { const f = window.__film; f.seekTo(t); f.post.render(t, 0, { letter: 0 }); }, t);
      await page.screenshot({ path: path.join(out, `camera-${t}.png`) });
    }
    await page.evaluate(() => { window.__film.director.update = () => {}; window.__film.seekTo(12); });
    const back = await page.evaluate(() => {
      const f = window.__film, body = f.anim.bot.body;
      f.camera.position.copy(body.localToWorld(body.position.clone().set(0, 0.15, -3.2)));
      f.camera.lookAt(body.localToWorld(body.position.clone().set(0, 0.15, 0)));
      f.camera.updateMatrixWorld(true); f.world.sky.follow(f.camera);
      f.post.render(12, 0, { letter: 0 });
      return { gear: f.anim.bot.gearC.mesh.position.toArray(), scale: f.anim.bot.backMech.scale.x };
    });
    await page.screenshot({ path: path.join(out, 'robot-back.png') });
    await page.evaluate(() => {
      const f = window.__film, fly = f.ember.group;
      const target = fly.getWorldPosition(f.camera.position.clone());
      f.camera.position.copy(target).add({ x: 0.22, y: 0.13, z: 0.32 });
      f.camera.lookAt(target); f.camera.updateMatrixWorld(true); f.world.sky.follow(f.camera);
      f.post.render(12, 0, { letter: 0 });
    });
    await page.screenshot({ path: path.join(out, 'ember-close.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => {
      const r = document.getElementById('selGrade').getBoundingClientRect();
      return { left: r.left, right: r.right, width: innerWidth };
    });
    assert(mobile.left >= 0 && mobile.right <= mobile.width, 'Grade select overflows portrait viewport');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ back, mobile, action, presets: Object.keys(grades), screenshots: ['robot-back.png', 'ember-close.png'] }));
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
