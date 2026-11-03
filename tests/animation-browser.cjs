const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, '.validation');
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/three/')) {
    const relative = req.url.slice('/three/'.length);
    if (!/^(build|examples\/jsm)\/[\w./-]+\.js$/.test(relative) || relative.includes('..')) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, 'node_modules', 'three', relative))); return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, 'Clockwork_Firefly_fullfilm.html'), 'utf8')
    .replace('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js', '/three/build/three.module.js')
    .replace('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/', '/three/examples/jsm/'));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); if (process.env.DEBUG_BOOT) console.error('Page error:', e.message); });
    page.on('requestfailed', r => { if (/\/three\/|127\.0\.0\.1/.test(r.url())) errors.push(`${r.failure()?.errorText}: ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if (process.env.DEBUG_BOOT) {
      await page.waitForTimeout(4000);
      console.log('Boot status:', await page.evaluate(() => ({ film: !!window.__film, loader: document.getElementById('loader')?.textContent?.slice(0, 150) })), errors);
    }
    await page.waitForFunction(() => window.__film?.st.ready, null, { timeout: 240000 })
      .catch(e => { throw new Error(`${e.message}\nBrowser errors: ${errors.join('\n')}`); });
    await page.evaluate(() => {
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('start').classList.add('hidden');
      window.__film.st.started = true;
    });

    if (process.env.CAMERA_MOTION === '1') {
      const motion = await page.evaluate(full => {
        const f = window.__film, rows = [];
        const ranges = full ? [[0, 300]] : [[47, 76], [94, 113], [128, 151], [188, 214], [228, 260], [261, 282]];
        const stepTime = full ? 1 / 20 : 1 / 30;
        for (const [start, end] of ranges) {
          f.director.setMode('director'); f.seekTo(start);
          let last = f.camera.position.clone(), lastStep = null, lastCorrection = 0, lastShot = f.director.shotAt(start);
          for (let t = start + stepTime; t <= end; t += stepTime) {
            f.anim.step(stepTime, true); f.ember.update(t, stepTime, f.anim);
            f.world.update(t, f.camera, 500, f.anim, stepTime);
            f.director.update(t, stepTime);
            const shot = f.director.shotAt(t), step = f.camera.position.clone().sub(last);
            const correction = f.camera.position.distanceTo(f.director.cinePos.p);
            if (shot === lastShot) rows.push({ t: +t.toFixed(2), shot, set: f.S.set,
              move: step.length(), correction,
              jerk: lastStep ? step.clone().sub(lastStep).length() : 0,
              collisionJerk: lastStep && Math.max(correction, lastCorrection) > 0.1 ? step.clone().sub(lastStep).length() : 0,
              desired: f.director.cinePos.p.toArray().map(v => +v.toFixed(2)),
              actual: f.camera.position.toArray().map(v => +v.toFixed(2)) });
            last.copy(f.camera.position); lastStep = shot === lastShot ? step : null; lastCorrection = shot === lastShot ? correction : 0; lastShot = shot;
          }
        }
        const byShot = new Map();
        for (const row of rows) if (!byShot.has(row.shot) || row.correction > byShot.get(row.shot).correction) byShot.set(row.shot, row);
        return {
          correction: [...byShot.values()].sort((a, b) => b.correction - a.correction).slice(0, 14),
          jerk: [...rows].sort((a, b) => b.collisionJerk - a.collisionJerk).slice(0, 5),
        };
      }, process.env.CAMERA_MOTION_FULL === '1');
      if (motion.correction[0].correction >= 0.65)
        console.log('Largest corrections:', JSON.stringify(motion.correction.map(({ t, shot, correction, desired, actual }) => ({ t, shot, correction, desired, actual }))));
      assert(motion.correction[0].correction < 0.65, `Camera intersects scenery: ${JSON.stringify(motion.correction[0])}`);
      if (motion.jerk[0].collisionJerk >= 0.35)
        console.log('Largest collision jerks:', JSON.stringify(motion.jerk.map(({ t, shot, collisionJerk, correction, desired, actual }) => ({ t, shot, collisionJerk, correction, desired, actual }))));
      assert(motion.jerk[0].collisionJerk < 0.35, `Camera snaps against scenery: ${JSON.stringify(motion.jerk[0])}`);
      console.log(`PASS: moving camera clearance ${motion.correction[0].correction.toFixed(3)} and peak collision jerk ${motion.jerk[0].collisionJerk.toFixed(3)}`);
      return;
    }

    const cameraReview = process.env.CAMERA_REVIEW === '1';
    const times = cameraReview
      ? (process.env.CAMERA_TIMES ? process.env.CAMERA_TIMES.split(',').map(Number) : [44.8, 58.8, 69.6, 133.2, 167.4, 201.6, 228.8, 230.6, 235.7, 269.2])
      : [12, 25, 58, 80, 125, 190, 214, 240, 270, 292];
    for (const time of times) {
      const state = await page.evaluate(time => {
        const f = window.__film;
        f.director.setMode('director'); f.seekTo(time);
        f.post.render(time, time, { letter: 0, cinematic: true, threshold: 0.8 });
        const moving = [f.ember.body, f.anim.bot.body, ...f.anim.bot.wings.map(w => w.flapG),
          f.world.roof.cat.body, f.world.forest.owl.head];
        return {
          time, set: f.S.set, glError: f.renderer.getContext().getError(),
          finite: moving.every(o => [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()].every(Number.isFinite)),
          butterflyBodies: f.world.forest.bfBody.count,
          swarmLightAligned: Math.abs(f.world.forest.flashA.position.x - f.S.swarmCenter.x - 1.5) < 1e-4,
        };
      }, time);
      assert.equal(state.glError, 0, `WebGL error at ${time}`);
      assert(state.finite, `Invalid animation transform at ${time}`);
      assert.equal(state.butterflyBodies, 6);
      if (state.set === 'forest') assert(state.swarmLightAligned, `Swarm light lags at ${time}`);
      if (cameraReview || [80, 240, 270].includes(time))
        await page.screenshot({ path: path.join(out, `${cameraReview ? 'camera' : 'animation'}-${time}.png`) });
      console.log(`Animation frame passed: ${time}s (${state.set})`);
    }

    const takeoff = await page.evaluate(() => {
      const roof = window.__film.world.roof, bird = roof.birds[0];
      const at = t => {
        roof.updateBirds(t);
        const m = roof.birdBody.instanceMatrix.array;
        return [m[8], m[9], m[10]];
      };
      const start = 58 + bird.delay;
      const a = at(start - 0.001), b = at(start + 0.001);
      return Math.acos(Math.max(-1, Math.min(1, (a[0]*b[0] + a[1]*b[1] + a[2]*b[2]) /
        (Math.hypot(...a) * Math.hypot(...b)))));
    });
    assert(takeoff < 0.1, `Bird orientation jumps at takeoff: ${takeoff}`);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${times.length} ${cameraReview ? 'camera review' : 'chapter animation'} frames and rooftop bird takeoff continuity`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
