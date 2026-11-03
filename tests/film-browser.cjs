const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// Browser regressions use the real WebGL renderer. Pixel readback is only used in
// correctness checks; FPS samples run independently without screenshots/readbacks.
const root = path.resolve(__dirname, '..');
const out = path.join(root, '.validation');
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root, 'Clockwork_Firefly_fullfilm.html')));
});
let browser;
const errors = [];
const report = { frames: [], transitions: [], performance: [], errors };

async function renderedFrame(page, time, mode) {
  return page.evaluate(({ time, mode }) => {
    const f = window.__film;
    f.director.setMode(mode); f.seekTo(time); f.setPlaying(false);
    f.ember?.update(time, 0, f.anim);
    f.world.sky.follow(f.camera);
    let invalidHDR = 0;
    const originalBloom = f.post.bloom.render;
    if (time === 140 && mode === 'director') {
      f.post.bloom.render = function(renderer, write, read, ...args) {
        const hdr = new Uint16Array(read.width * read.height * 4);
        renderer.readRenderTargetPixels(read, 0, 0, read.width, read.height, hdr);
        for (const value of hdr) if ((value & 0x7c00) === 0x7c00) invalidHDR++;
        originalBloom.call(this, renderer, write, read, ...args);
      };
    }
    f.post.render(time, time, { letter: 0, cinematic: mode === 'director', threshold: 0.8 });
    f.post.bloom.render = originalBloom;
    const gl = f.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const pixels = new Uint8Array(16 * 16 * 4);
    let bright = 0, total = 0, sum = 0;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
      gl.readPixels(Math.floor(w * (0.2 + x * 0.2)), Math.floor(h * (0.25 + y * 0.25)), 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let i = 0; i < pixels.length; i += 4) {
        const value = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
        if (value > 3) bright++; sum += value; total++;
      }
    }
    return { time, mode, set: f.S.set, fade: f.post.grade.uniforms.uFade.value,
      mean: sum / total, lit: bright / total, invalidHDR, camera: f.camera.position.toArray(), glError: gl.getError() };
  }, { time, mode });
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const start = Date.now();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.__film?.st.ready, null, { timeout: 240000 });
  report.bootMs = Date.now() - start;
  report.device = await page.evaluate(() => {
    const f = window.__film, gl = f.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    document.getElementById('loader').classList.add('hidden'); document.getElementById('start').classList.add('hidden');
    f.st.started = true;
    return { gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), viewport: [innerWidth, innerHeight], batching: f.st.batching };
  });
  console.log('Ready:', JSON.stringify(report.device));
  const missingNormals = await page.evaluate(() => {
    const missing = [];
    window.__film.scene.traverse(o => {
      if (o.isMesh && (o.material?.isMeshStandardMaterial || o.material?.isMeshLambertMaterial) && !o.geometry.attributes.normal) missing.push(o.id);
    });
    return missing;
  });
  assert.deepEqual(missingNormals, [], 'Lit geometry is missing surface normals');

  const characterAndGrade = await page.evaluate(() => {
    const f = window.__film, bot = f.anim.bot;
    const backScale = bot.backMech.scale.x;
    const upperGearEdge = (Math.hypot(bot.gearC.mesh.position.x, bot.gearC.mesh.position.y) + bot.gearC.R + 2 * bot.gearC.R / bot.gearC.N * 0.97) * backScale;
    const plateEdge = 0.85 * backScale;
    const wingMap = f.ember.wings[0].p.children[0].material.map;
    const shellMap = f.ember.elyL.material.map;
    f.post.render(150, 0, { letter: 0 });
    const original = { sat: f.post.grade.uniforms.uSat.value, tint: f.post.grade.uniforms.uShadowTint.value.toArray() };
    return { upperGearEdge, plateEdge, wingMap: !!wingMap, shellMap: !!shellMap, original };
  });
  assert(characterAndGrade.upperGearEdge < characterAndGrade.plateEdge, 'Upper back gear protrudes beyond its mounting plate');
  assert(characterAndGrade.wingMap && characterAndGrade.shellMap, 'Firefly surface textures are missing');
  await page.selectOption('#selGrade', 'snyder');
  const snyderGrade = await page.evaluate(() => {
    const f = window.__film;
    f.post.render(150, 0, { letter: 0 });
    return { preset: f.post.preset, sat: f.post.grade.uniforms.uSat.value, tint: f.post.grade.uniforms.uShadowTint.value.toArray() };
  });
  assert.equal(snyderGrade.preset, 'snyder');
  assert(snyderGrade.sat < characterAndGrade.original.sat && snyderGrade.tint[2] > characterAndGrade.original.tint[2], 'Snyder grade did not change the rendered look');
  await page.selectOption('#selGrade', 'default');

  for (const mode of ['director', 'follow', 'face', 'orbit']) {
    // Every authored camera shot plus the formerly black entrance and both sides of cuts.
    const times = mode === 'director'
      ? [3, 7, 9, 12, 15, 19, 22, 25, 30, 33, 36, 39, 43.9, 44, 44.1, 48, 52, 58, 64, 70, 76, 80, 86, 92, 96, 100, 105, 110, 112.8, 113.9, 114, 114.1, 117, 124, 132, 140, 150, 164.6, 172, 185, 195, 205, 214, 220, 228, 235, 240, 252, 260.9, 261, 261.1, 270, 280, 289, 293]
      : [0, 12, 43.9, 44, 56, 92, 112.8, 113.9, 114, 128, 150, 185, 214, 240, 260.9, 261, 272, 295, 299];
    for (const time of times) {
      const frame = await renderedFrame(page, time, mode); report.frames.push(frame);
      assert.equal(frame.glError, 0, `WebGL error at ${mode} ${time}`);
      assert.equal(frame.invalidHDR, 0, `Invalid HDR colors at ${mode} ${time}`);
      assert(frame.camera.every(Number.isFinite), `Invalid camera at ${mode} ${time}`);
      if (mode !== 'director' || (time > 2 && time < 294)) {
        assert.equal(frame.fade, 1, `Unexpected blackout fade at ${mode} ${time}`);
        if (frame.mean <= 0.8 || frame.lit <= 0.005) {
          await page.screenshot({ path: path.join(out, `failure-${mode}-${time}.png`) });
          console.log('Failed frame state:', await page.evaluate(() => ({ target:window.__film.S.camTarget.toArray(), environment:window.__film.scene.environmentIntensity, fog:window.__film.scene.fog.density, ao:window.__film.post.gtao.enabled, grade:window.__film.post.grade.uniforms.uContrast.value })));
          console.log('Pass diagnosis:', await page.evaluate(time => {
            const f=window.__film,gl=f.renderer.getContext(),data=new Uint8Array(4),samples=[];
            for(const [name,target] of [['bright',f.post.bloom.renderTargetBright],['blur',f.post.bloom.renderTargetsHorizontal[0]]]){
              const pixels=new Uint16Array(target.width*target.height*4);f.renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
              let invalid=0;for(const value of pixels)if((value&0x7c00)===0x7c00)invalid++;
              samples.push({name,invalid,total:pixels.length});
            }
            const read=name=>{gl.readPixels(gl.drawingBufferWidth/2,gl.drawingBufferHeight/2,1,1,gl.RGBA,gl.UNSIGNED_BYTE,data);samples.push({name,pixel:[...data]});};
            f.post.bloomOn=false;f.post.render(time,0,{letter:0});read('without bloom');
            f.post.grade.enabled=false;f.post.composer.render();read('without bloom or grade');
            f.post.bloomOn=true;f.post.grade.enabled=true;return samples;
          },time));
        }
        assert(frame.mean > 0.8 && frame.lit > 0.005, `Black frame at ${mode} ${time}: ${JSON.stringify(frame)}`);
      }
    }
    console.log('Frame checks passed:', mode);
  }

  for (const mode of ['director', 'follow', 'face', 'orbit']) for (const cut of [44, 114, 228, 261]) {
    const transition = await page.evaluate(({ mode, cut }) => new Promise(resolve => {
      const f = window.__film;
      f.director.setMode(mode); f.seekTo(cut - 0.3); f.setPlaying(true);
      const mixes = [], intervals = []; let last = null;
      const sample = now => {
        if (last !== null) intervals.push(now - last); last = now;
        mixes.push({ time: f.st.T, mix: f.post.dissolve.uniforms.uMix.value, fade: f.post.grade.uniforms.uFade.value });
        if (f.st.T >= cut + 1) { f.setPlaying(false); resolve({ mode, cut, mixes, maxFrameMs: Math.max(...intervals) }); }
        else requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    }), { mode, cut });
    report.transitions.push(transition);
    assert(transition.mixes.some(s => s.time >= cut && s.mix > 0 && s.mix < 0.95), `Missing dissolve at ${mode} ${cut}`);
    assert(transition.mixes.every(s => s.fade === 1), `Blackout in transition at ${mode} ${cut}`);
    assert(transition.mixes.at(-1).mix === 1, `Dissolve did not finish at ${mode} ${cut}`);
  }
  console.log('All 16 chapter transitions passed');

  // A wide, low orbit cannot enter the floor or the roof/canopy shell after a seek.
  for (const time of [20, 80, 150, 240, 272]) {
    await page.evaluate(time => {
      const f = window.__film; f.director.setMode('orbit'); f.seekTo(time);
      f.camera.position.copy(f.S.root).add({ x: -6, y: -15, z: 2 });
      f.director.update(time, 1 / 60);
    }, time);
    const safe = await page.evaluate(() => {
      const f = window.__film, p = f.camera.position.clone();
      if (f.S.set === 'roof') f.world.roof.resolveCamera(p, f.director.camRadius);
      else if (f.S.set === 'forest') f.world.forest.resolveCamera(p, f.director.camRadius);
      else return f.camera.position.y >= f.director.camRadius;
      return p.distanceTo(f.camera.position) < 1e-4;
    });
    assert(safe, `Unsafe orbit camera at ${time}`);
  }

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const f = window.__film, { width, height } = f.post.composer.readBuffer;
    if (Math.abs(width - innerWidth * f.renderer.getPixelRatio()) > 1 || Math.abs(height - innerHeight * f.renderer.getPixelRatio()) > 1) throw new Error('Composer resolution mismatch');
  });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const t of [12, 112.8, 150, 240, 272]) {
    const frame = await renderedFrame(page, t, 'orbit');
    assert(frame.mean > 0.8 && frame.glError === 0, `Portrait black frame at ${t}`);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  // Start the FPS measurement in a fresh rendering session. The readback/resize
  // stress checks above deliberately stall the GPU and influence adaptive scaling.
  await page.reload();
  await page.waitForFunction(() => window.__film?.st.ready, null, { timeout: 240000 });
  await page.evaluate(() => {
    document.getElementById('loader').classList.add('hidden'); document.getElementById('start').classList.add('hidden');
    window.__film.st.started = true;
  });

  for (const time of [12, 56, 128, 240, 272]) {
    await page.evaluate(time => { const f = window.__film; f.director.setMode('director'); f.seekTo(time); f.setPlaying(true); }, time);
    await page.waitForTimeout(6000);
    const result = await page.evaluate(() => new Promise(resolve => {
      const f = window.__film, intervals = [], calls = []; let last = null;
      const sample = now => {
        if (last !== null) { intervals.push(now - last); calls.push(f.renderer.info.render.calls); } last = now;
        if (intervals.length >= 180 || intervals.reduce((a, b) => a + b, 0) > 5000) {
          intervals.sort((a, b) => a - b);
          f.setPlaying(false);
          resolve({ fps: 1000 * intervals.length / intervals.reduce((a, b) => a + b, 0), p95ms: intervals[Math.floor(intervals.length * 0.95)], maxMs: intervals.at(-1), draws: Math.round(calls.reduce((a, b) => a + b, 0) / calls.length), scale: f.renderer.getPixelRatio(), programs: f.renderer.info.programs.length });
        } else requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    }));
    report.performance.push({ time, ...result }); console.log('Playback:', JSON.stringify(report.performance.at(-1)));
    await page.screenshot({ path: path.join(out, `chapter-${time}.png`) });
  }
  assert.deepEqual(errors, [], 'Browser errors');
  console.log(`PASS: ${report.frames.length} frames, 16 transitions, collision, resize and portrait checks; five playback samples.`);
})().catch(error => { report.failure = error.message; console.error(error); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close(); server.close();
});
