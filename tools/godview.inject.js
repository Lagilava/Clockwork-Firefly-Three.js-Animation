/* ==========================================================================
   GOD'S-EYE VIEW  (injected by tools/build-godview.cjs; lives inside the film's module)
   Samples the whole film once (robot, Ember, authored camera), then draws it all
   over the live scene: paths coloured by time, time ticks, beat and shot labels,
   camera glyphs, a whole-film map, and free overhead cameras with clipping.
   ========================================================================== */
const GV_RANGES = { atrium: [[0, 44], [261, FILM]], roof: [[44, 114]], forest: [[114, 261]] };
const GV_SET_NAMES = { atrium: 'The Atrium', roof: 'Rooftops', forest: 'The Glade' };
const GV_SET_TIME = { atrium: 12, roof: 60, forest: 140 };
const GV_GLYPH = { atrium: 0.5, roof: 2.2, forest: 1.3 };
const gvInRange = (set, t) => GV_RANGES[set].some(([a, b]) => t >= a && t < b);
const gvFmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const gvHue = (t) => { const c = new THREE.Color(); c.setHSL((0.62 - (t / FILM) * 0.62 + 1) % 1, 0.85, 0.58); return c; };

function godViewInstall(film) {
  const { st, anim, seekTo, setPlaying, S, camera, renderer, scene, world, director } = film;
  const $g = (id) => document.getElementById(id);
  document.body.classList.add('godview');
  $g('gvBoot').classList.remove('hidden');

  /* ---------- 1. sample the whole film once ---------- */
  const DT = 1 / 20, N = Math.floor(FILM / DT);
  const sm = { t: new Float32Array(N), root: new Float32Array(N * 3), lure: new Float32Array(N * 3), cam: new Float32Array(N * 3), tgt: new Float32Array(N * 3), shot: new Int16Array(N), n: 0 };
  function sampleFilm() {
    seekTo(0); setPlaying(false);
    const o = { pos: V(), target: V(), fov: 40, shake: 0, roll: 0 };
    for (let i = 0; i < N; i++) {
      anim.step(DT);
      const t = anim.T; sm.t[i] = t;
      sm.root.set([S.root.x, S.root.y, S.root.z], i * 3);
      sm.lure.set([S.lure.x, S.lure.y, S.lure.z], i * 3);
      const si = director.shotAt(t); director.evalShot(si, t, o);
      sm.cam.set([o.pos.x, o.pos.y, o.pos.z], i * 3); sm.tgt.set([o.target.x, o.target.y, o.target.z], i * 3); sm.shot[i] = si;
      sm.n = i + 1;
    }
    seekTo(0);
  }
  sampleFilm();
  const sampleAt = (t) => Math.max(0, Math.min(sm.n - 1, Math.round(t / DT)));
  const rootAt = (i, out = V()) => out.set(sm.root[i * 3], sm.root[i * 3 + 1], sm.root[i * 3 + 2]);
  const lureAt = (i, out = V()) => out.set(sm.lure[i * 3], sm.lure[i * 3 + 1], sm.lure[i * 3 + 2]);
  const camAt = (i, out = V()) => out.set(sm.cam[i * 3], sm.cam[i * 3 + 1], sm.cam[i * 3 + 2]);
  const tgtAt = (i, out = V()) => out.set(sm.tgt[i * 3], sm.tgt[i * 3 + 1], sm.tgt[i * 3 + 2]);

  // per-set bounds from where the actors and the authored cameras actually go
  const bounds = {};
  for (const set of Object.keys(GV_RANGES)) {
    const b = new THREE.Box3().makeEmpty();
    for (let i = 0; i < sm.n; i++) if (gvInRange(set, sm.t[i])) { b.expandByPoint(rootAt(i)); if (sm.lure[i * 3 + 1] < 40) b.expandByPoint(lureAt(i)); b.expandByPoint(camAt(i)); }
    bounds[set] = b;
  }

  /* ---------- 2. overlay objects ---------- */
  const god = new THREE.Group(); god.name = 'godview'; scene.add(god);
  const layers = { paths: true, ember: true, ticks: true, beats: false, cams: true, shots: false, grid: true, live: true };
  const byLayer = {}; for (const k in layers) byLayer[k] = [];
  const add = (layer, obj, set) => { obj.userData.layer = layer; obj.userData.set = set; obj.renderOrder = 10; god.add(obj); byLayer[layer].push(obj); return obj; };
  const lineMats = [];
  const mkLine = (pts, cols, width, dashed = false) => {
    const g = new LineGeometry(); g.setPositions(pts); g.setColors(cols);
    const m = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, dashed, dashSize: 0.8, gapSize: 0.5, transparent: true, depthTest: false, depthWrite: false, worldUnits: false });
    m.resolution.set(innerWidth, innerHeight); lineMats.push(m);
    const l = new Line2(g, m); l.computeLineDistances(); l.frustumCulled = false; return l;
  };
  const labelCache = new Map();
  function labelTex(text, color) {
    const key = text + color; if (labelCache.has(key)) return labelCache.get(key);
    const c = document.createElement('canvas'), x = c.getContext('2d'); x.font = '600 26px system-ui, sans-serif';
    const w = Math.ceil(x.measureText(text).width) + 20; c.width = w; c.height = 40;
    x.font = '600 26px system-ui, sans-serif'; x.fillStyle = 'rgba(8,10,14,.78)'; x.beginPath(); x.roundRect(0, 4, w, 32, 8); x.fill();
    x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 10, 21);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; const r = { tex, w, h: 40 }; labelCache.set(key, r); return r;
  }
  const mkLabel = (text, color = '#ffffff', size = 0.034) => {
    const { tex, w, h } = labelTex(text, color);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false, toneMapped: false }));
    s.scale.set(size * (w / h), size, 1); s.center.set(0.5, -0.2); return s;
  };
  const mkDot = (color, r) => new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, toneMapped: false }));

  for (const set of Object.keys(GV_RANGES)) {
    const scale = GV_GLYPH[set];
    for (const [a, b] of GV_RANGES[set]) {
      const rp = [], rc = [], ep = [], ec = [];
      for (let i = sampleAt(a); i < sampleAt(b); i++) {
        const t = sm.t[i], c = gvHue(t); rootAt(i); rp.push(sm.root[i * 3], sm.root[i * 3 + 1], sm.root[i * 3 + 2]); rc.push(c.r, c.g, c.b);
        if (sm.lure[i * 3 + 1] < 40 && t > 8.9) { ep.push(sm.lure[i * 3], sm.lure[i * 3 + 1], sm.lure[i * 3 + 2]); ec.push(0.78, 1, 0.35); }
      }
      add('paths', mkLine(rp, rc, 3.5), set);
      if (ep.length > 6) add('ember', mkLine(ep, ec, 2, true), set);
    }
    // ticks every 5 s on the hero path
    for (let t = 0; t < FILM; t += 5) {
      if (!gvInRange(set, t)) continue; const i = sampleAt(t), p = rootAt(i);
      const d = add('ticks', mkDot(gvHue(t).getHex(), 0.07 * scale * 1.6), set); d.position.copy(p);
      const l = add('ticks', mkLabel(gvFmt(t), '#e8e8f0', 0.026), set); l.position.copy(p);
    }
    // beat labels where each beat starts
    for (const b of BEATS) {
      if (!gvInRange(set, b.t0)) continue; const i = sampleAt(b.t0);
      const l = add('beats', mkLabel(`${gvFmt(b.t0)} ${b.name}`, '#ffd28a', 0.03), set); l.position.copy(rootAt(i)); l.position.y += 0.4 * scale; l.center.set(0, -0.6);
    }
    // authored cameras: a glyph at each shot start, looking toward its target
    SHOTS.forEach((sh, idx) => {
      if (!gvInRange(set, sh.t0)) return; const i = sampleAt(sh.t0 + 0.2);
      const p = camAt(i), tg = tgtAt(i), dir = tg.clone().sub(p), len = Math.min(dir.length(), 40 * scale), g = new THREE.Group();
      dir.normalize();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22 * scale, 0.7 * scale, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, depthTest: false, toneMapped: false }));
      cone.geometry.rotateX(Math.PI / 2); cone.lookAt(dir); g.add(cone);
      const ray = mkLine([0, 0, 0, dir.x * len * 0.35, dir.y * len * 0.35, dir.z * len * 0.35], [1, 1, 1, 1, 1, 1], 1.2, true); g.add(ray);
      g.position.copy(p); add('cams', g, set);
      const l = add('shots', mkLabel(`S${idx + 1}  ${gvFmt(sh.t0)}`, '#bfe3ff', 0.024), set); l.position.copy(p);
    });
    // a faint camera path
    const cp = [], cc = [];
    for (const [a, b] of GV_RANGES[set]) for (let i = sampleAt(a); i < sampleAt(b); i += 2) { cp.push(sm.cam[i * 3], sm.cam[i * 3 + 1], sm.cam[i * 3 + 2]); cc.push(0.55, 0.75, 1); }
    add('cams', mkLine(cp, cc, 1, true), set).material.opacity = 0.35;
  }
  // live markers: hero and Ember beacons plus the camera currently in use
  const live = new THREE.Group(); god.add(live); byLayer.live.push(live);
  const heroBeacon = mkDot(0xff6a50, 0.35), emberBeacon = mkDot(0xd8ff5a, 0.25), heroLabel = mkLabel('ROBOT', '#ff9a80', 0.03), emberLabel = mkLabel('EMBER', '#d8ff5a', 0.03);
  const heroDrop = mkLine([0, 0, 0, 0, -1, 0], [1, 0.5, 0.4, 1, 0.5, 0.4], 1.5, true), emberDrop = mkLine([0, 0, 0, 0, -1, 0], [0.85, 1, 0.4, 0.85, 1, 0.4], 1.5, true);
  const liveCam = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 4), new THREE.MeshBasicMaterial({ color: 0xffe08a, wireframe: true, depthTest: false, toneMapped: false }));
  liveCam.geometry.rotateX(Math.PI / 2);
  const liveRay = mkLine([0, 0, 0, 0, 0, 1], [1, 0.9, 0.5, 1, 0.9, 0.5], 1.5);
  live.add(heroBeacon, emberBeacon, heroLabel, emberLabel, heroDrop, emberDrop, liveCam, liveRay);
  live.traverse((o) => { o.renderOrder = 12; });
  const grid = new THREE.GridHelper(200, 40, 0x6a7a9a, 0x2a3446); grid.material.depthWrite = false; grid.material.transparent = true; grid.material.opacity = 0.55; grid.renderOrder = 5; grid.userData.layer = 'grid'; god.add(grid); byLayer.grid.push(grid);

  /* ---------- 3. cameras, controls, environment ---------- */
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.screenSpacePanning = true; controls.minDistance = 0.6; controls.maxDistance = 1500; controls.maxPolarAngle = Math.PI;
  const state = { set: 'atrium', auto: true, follow: false, clipOn: false, clipY: 30, fogOff: true, exposure: 1.6, brightFloor: true };
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 30);
  director.setMode('follow'); director.controls.enabled = false;
  camera.far = 4000; camera.near = 0.1; camera.fov = 50; camera.updateProjectionMatrix();
  // neutralise the cinematic image: no fades, light vignette; overall exposure is adjustable
  const sample0 = { exposure: CH.exposure.sample.bind(CH.exposure), fade: CH.fade.sample.bind(CH.fade), vig: CH.vig.sample.bind(CH.vig) };
  CH.fade.sample = () => 0; CH.vig.sample = () => 0.25; CH.exposure.sample = (t) => Math.max(0.85, sample0.exposure(t)) * state.exposure;
  const fogDensity = { v: 0 };

  function frameSet(set, mode) {
    const b = bounds[set], c = b.getCenter(V()), size = b.getSize(V()), span = Math.max(size.x, size.z, size.y * 0.8, 6);
    const fit = (span * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    controls.target.copy(c); controls.target.y = Math.max(b.min.y, c.y - size.y * 0.25);
    const dirs = { top: V(0, 1, 0.0001), aerial: V(0.55, 0.62, 0.78), side: V(0, 0.18, 1), south: V(0, 0.5, 1), east: V(1, 0.4, 0.2) };
    camera.position.copy(controls.target).addScaledVector((dirs[mode] || dirs.aerial).normalize(), fit);
    controls.update();
    grid.position.set(c.x, b.min.y - 0.02, c.z); const gsz = Math.max(20, Math.ceil(span * 1.8 / 10) * 10); grid.scale.setScalar(gsz / 200);
  }
  let curView = 'aerial';
  function setView(mode) { curView = mode; frameSet(state.set, mode); document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === mode)); }
  function setSet(set, jump = true) {
    state.set = set; document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === set));
    if (jump && !gvInRange(set, st.T)) seekTo(GV_SET_TIME[set]);
    setView(curView); renderLists();
  }

  const _o = { pos: V(), target: V(), fov: 40, shake: 0, roll: 0 }, _root = V(), _lure = V(), _last = V(), _fwd = V();
  let lastRootSet = false;
  director.update = function godUpdate() {
    const T = st.T, set = world.cur;
    if (state.auto && set !== state.set) { state.set = set; setView(curView); document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === set)); renderLists(); }
    if (state.fogOff) scene.fog.density = 0;
    renderer.clippingPlanes = state.clipOn ? [clip] : [];
    clip.constant = state.clipY;
    if (state.follow) { _root.copy(S.root); if (lastRootSet) { _fwd.copy(_root).sub(_last); controls.target.add(_fwd); camera.position.add(_fwd); } _last.copy(_root); lastRootSet = true; } else lastRootSet = false;
    controls.update();
    // overlays
    const cur = state.set, i = sampleAt(T);
    for (const k in byLayer) for (const o of byLayer[k]) o.visible = layers[k] && (o.userData.set === undefined || o.userData.set === cur);
    live.visible = layers.live;
    const g = GV_GLYPH[cur];
    rootAt(i, _root); heroBeacon.position.copy(S.root); heroBeacon.scale.setScalar(g); heroLabel.position.copy(S.root).add(_fwd.set(0, 0.8 * g, 0));
    emberBeacon.visible = emberLabel.visible = S.lure.y < 40 && T > 8.9;
    emberBeacon.position.copy(S.lure); emberBeacon.scale.setScalar(g); emberLabel.position.copy(S.lure).add(_fwd.set(0, 0.7 * g, 0));
    const floorY = bounds[cur].min.y - 0.02;
    heroDrop.position.set(S.root.x, floorY, S.root.z); heroDrop.scale.set(1, S.root.y - floorY, 1);
    emberDrop.position.set(S.lure.x, floorY, S.lure.z); emberDrop.scale.set(1, Math.max(0.01, S.lure.y - floorY), 1); emberDrop.visible = emberBeacon.visible;
    director.evalShot(director.shotAt(T), T, _o);
    liveCam.position.copy(_o.pos); liveCam.scale.setScalar(g * 1.4); liveCam.lookAt(_o.target);
    liveRay.position.copy(_o.pos); _fwd.copy(_o.target).sub(_o.pos); const L = Math.min(_fwd.length(), 60 * g);
    liveRay.scale.set(1, 1, L); liveRay.quaternion.setFromUnitVectors(V(0, 0, 1), _fwd.normalize());
    world.sky.follow(camera);
    updateReadout(T, i);
  };

  /* ---------- 4. panels ---------- */
  const readout = $g('gvReadout');
  function updateReadout(T, i) {
    const bi = beatAt(T), b = BEATS[bi], si = director.shotAt(T), ci = chapterAt(T);
    const f = (v) => v.toFixed(1);
    readout.innerHTML = `<b>${gvFmt(T)}</b> · ${GV_SET_NAMES[world.cur]} · Chapter ${CHAPTERS[ci].num} ${CHAPTERS[ci].name}<br>
      <span class="k">Beat</span> ${b.name} <span class="k">Shot</span> S${si + 1} (${gvFmt(SHOTS[si].t0)}–${gvFmt(SHOTS[si].t1)})<br>
      <span class="k">Robot</span> ${f(S.root.x)}, ${f(S.root.y)}, ${f(S.root.z)} <span class="k">Ember</span> ${S.lure.y < 40 ? `${f(S.lure.x)}, ${f(S.lure.y)}, ${f(S.lure.z)}` : 'off stage'}`;
    if (i !== lastListI) { lastListI = i; markActive(T); }
  }
  let lastListI = -1;
  function renderLists() {
    const cur = state.set, bl = $g('gvBeats'), sl = $g('gvShots');
    bl.innerHTML = BEATS.filter((b) => gvInRange(cur, b.t0)).map((b) => `<li data-t="${b.t0}"><span class="t">${gvFmt(b.t0)}</span><span>${b.name}</span></li>`).join('');
    sl.innerHTML = SHOTS.map((s, i) => [s, i]).filter(([s]) => gvInRange(cur, s.t0)).map(([s, i]) => `<li data-t="${s.t0}" data-shot="${i}"><span class="t">${gvFmt(s.t0)}</span><span>S${i + 1} · ${(s.t1 - s.t0).toFixed(1)}s</span></li>`).join('');
    lastListI = -1;
  }
  function markActive(T) {
    for (const ul of [$g('gvBeats'), $g('gvShots')]) {
      let act = null; for (const li of ul.children) { const t = +li.dataset.t; if (t <= T) act = li; li.classList.remove('on'); }
      if (act) { act.classList.add('on'); if (!ul.matches(':hover')) { const r = act.offsetTop - ul.clientHeight / 2; ul.scrollTop += (r - ul.scrollTop) * 0.2; } }
    }
  }
  for (const id of ['gvBeats', 'gvShots']) $g(id).addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) { seekTo(+li.dataset.t); setPlaying(false); } });

  document.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => { state.auto = false; $g('gvAuto').checked = false; setSet(b.dataset.set); });
  document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => setView(b.dataset.view));
  $g('gvAuto').onchange = (e) => { state.auto = e.target.checked; };
  $g('gvFollow').onchange = (e) => { state.follow = e.target.checked; };
  $g('gvFog').onchange = (e) => { state.fogOff = e.target.checked; };
  $g('gvClipOn').onchange = (e) => { state.clipOn = e.target.checked; };
  $g('gvClipY').oninput = (e) => { state.clipY = +e.target.value; $g('gvClipV').textContent = state.clipY + ' m'; };
  $g('gvExp').oninput = (e) => { state.exposure = +e.target.value; $g('gvExpV').textContent = state.exposure.toFixed(1) + '×'; };
  document.querySelectorAll('[data-layer]').forEach((c) => { c.checked = layers[c.dataset.layer]; c.onchange = () => { layers[c.dataset.layer] = c.checked; }; });
  document.querySelectorAll('.gvTab').forEach((b) => b.onclick = () => { document.querySelectorAll('.gvTab').forEach((x) => x.classList.toggle('on', x === b)); $g('gvBeats').classList.toggle('hidden', b.dataset.tab !== 'beats'); $g('gvShots').classList.toggle('hidden', b.dataset.tab !== 'shots'); });
  addEventListener('resize', () => lineMats.forEach((m) => m.resolution.set(innerWidth, innerHeight)));

  /* hover on the paths: nearest hero or Ember sample in screen space */
  const tip = $g('gvTip'), _p = V();
  function nearestSample(px, py) {
    const set = state.set; let best = null, bd = 22 * 22;
    for (let i = 0; i < sm.n; i += 2) {
      if (!gvInRange(set, sm.t[i])) continue;
      for (const kind of (layers.ember ? ['root', 'lure'] : ['root'])) {
        if (kind === 'lure' && (sm.lure[i * 3 + 1] > 40 || sm.t[i] < 8.9)) continue;
        const a = sm[kind]; _p.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]).project(camera);
        if (_p.z > 1) continue;
        const sx = (_p.x * 0.5 + 0.5) * innerWidth, sy = (-_p.y * 0.5 + 0.5) * innerHeight, d = (sx - px) ** 2 + (sy - py) ** 2;
        if (d < bd) { bd = d; best = { i, kind, sx, sy }; }
      }
    }
    return best;
  }
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons) { tip.classList.add('hidden'); return; }
    const n = nearestSample(e.clientX, e.clientY);
    if (!n) { tip.classList.add('hidden'); return; }
    const t = sm.t[n.i], b = BEATS[beatAt(t)], a = sm[n.kind];
    tip.innerHTML = `<b>${n.kind === 'root' ? 'Robot' : 'Ember'}</b> ${gvFmt(t)}<br>${b.name} · S${sm.shot[n.i] + 1}<br>${a[n.i * 3].toFixed(1)}, ${a[n.i * 3 + 1].toFixed(1)}, ${a[n.i * 3 + 2].toFixed(1)}`;
    tip.style.left = Math.min(innerWidth - 190, e.clientX + 14) + 'px'; tip.style.top = Math.min(innerHeight - 90, e.clientY + 14) + 'px'; tip.classList.remove('hidden');
    renderer.domElement.style.cursor = 'pointer';
  });
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const n = nearestSample(e.clientX, e.clientY); if (n) { seekTo(sm.t[n.i]); setPlaying(false); }
  });

  /* ---------- 5. whole-film map (every set at once, top-down and side) ---------- */
  const mapEl = $g('gvMap'), cv = $g('gvMapCanvas'), mctx = cv.getContext('2d');
  let mapHit = [];
  function drawMap() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; mctx.setTransform(dpr, 0, 0, dpr, 0, 0); mctx.clearRect(0, 0, W, H);
    mapHit = []; const sets = ['atrium', 'roof', 'forest'], padX = 24, colW = (W - padX * 4) / 3, rowH = (H - 90) / 2;
    sets.forEach((set, ci) => {
      const b = bounds[set], x0 = padX + ci * (colW + padX);
      [['top', 'x', 'z'], ['side', 'x', 'y']].forEach(([view, ax, ay], ri) => {
        const y0 = 48 + ri * (rowH + 14), bx0 = b.min[ax], bx1 = b.max[ax], by0 = b.min[ay], by1 = b.max[ay];
        const spanX = Math.max(bx1 - bx0, 4), spanY = Math.max(by1 - by0, 4), s = Math.min((colW - 16) / spanX, (rowH - 16) / spanY);
        const ox = x0 + (colW - spanX * s) / 2, oy = y0 + (rowH - spanY * s) / 2;
        const px = (v) => ox + (v - bx0) * s, py = (v) => (view === 'top' ? oy + (v - by0) * s : oy + (by1 - v) * s);
        mctx.fillStyle = '#0d1018'; mctx.strokeStyle = '#242c3d'; mctx.lineWidth = 1; mctx.beginPath(); mctx.roundRect(x0, y0, colW, rowH, 8); mctx.fill(); mctx.stroke();
        if (ri === 0) { mctx.fillStyle = '#d8d0c0'; mctx.font = '600 15px system-ui'; mctx.fillText(GV_SET_NAMES[set], x0 + 4, y0 - 20); mctx.fillStyle = '#7f8aa0'; mctx.font = '12px system-ui'; mctx.fillText(`${gvFmt(GV_RANGES[set][0][0])}–${gvFmt(GV_RANGES[set].at(-1)[1])} · top view (x→, z↓)`, x0 + 4, y0 - 5); }
        else { mctx.fillStyle = '#7f8aa0'; mctx.font = '12px system-ui'; mctx.fillText('side view (x→, height↑)', x0 + 8, y0 + 16); }
        mctx.save(); mctx.beginPath(); mctx.rect(x0, y0, colW, rowH); mctx.clip();
        // authored cameras
        mctx.fillStyle = 'rgba(160,200,255,.7)';
        for (let i = 0; i < sm.n; i += 20) if (gvInRange(set, sm.t[i])) { mctx.fillRect(px(sm.cam[i * 3 + (ax === 'x' ? 0 : 0)]) - 1.5, py(sm.cam[i * 3 + (ay === 'z' ? 2 : 1)]) - 1.5, 3, 3); }
        // Ember
        mctx.strokeStyle = 'rgba(200,255,90,.8)'; mctx.setLineDash([4, 3]); mctx.lineWidth = 1.2; mctx.beginPath(); let pen = false;
        for (let i = 0; i < sm.n; i++) { if (!gvInRange(set, sm.t[i]) || sm.lure[i * 3 + 1] > 40 || sm.t[i] < 8.9) { pen = false; continue; } const X = px(sm.lure[i * 3]), Y = py(sm.lure[i * 3 + (ay === 'z' ? 2 : 1)]); if (!pen) { mctx.moveTo(X, Y); pen = true; } else mctx.lineTo(X, Y); }
        mctx.stroke(); mctx.setLineDash([]);
        // robot, coloured by time
        mctx.lineWidth = 2.4; mctx.lineCap = 'round';
        for (let i = 1; i < sm.n; i++) {
          if (!gvInRange(set, sm.t[i]) || !gvInRange(set, sm.t[i - 1])) continue;
          const c = gvHue(sm.t[i]); mctx.strokeStyle = `rgb(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0})`;
          mctx.beginPath(); mctx.moveTo(px(sm.root[(i - 1) * 3]), py(sm.root[(i - 1) * 3 + (ay === 'z' ? 2 : 1)])); mctx.lineTo(px(sm.root[i * 3]), py(sm.root[i * 3 + (ay === 'z' ? 2 : 1)])); mctx.stroke();
          if (i % 2 === 0) mapHit.push({ x: px(sm.root[i * 3]), y: py(sm.root[i * 3 + (ay === 'z' ? 2 : 1)]), t: sm.t[i], col: ci, row: ri });
        }
        // time ticks
        mctx.fillStyle = '#e8e8f0'; mctx.font = '10px system-ui';
        for (let t = 0; t < FILM; t += 10) if (gvInRange(set, t)) { const i = sampleAt(t), X = px(sm.root[i * 3]), Y = py(sm.root[i * 3 + (ay === 'z' ? 2 : 1)]); mctx.beginPath(); mctx.arc(X, Y, 2.6, 0, 7); mctx.fill(); if (ri === 0) mctx.fillText(gvFmt(t), X + 4, Y - 4); }
        // the hero and Ember right now
        const dotAt = (v, col) => { mctx.fillStyle = col; mctx.strokeStyle = '#000'; mctx.beginPath(); mctx.arc(px(v[ax === 'x' ? 0 : 0]), py(v[ay === 'z' ? 2 : 1]), 5, 0, 7); mctx.fill(); mctx.stroke(); };
        if (world.cur === set) { dotAt([S.root.x, S.root.y, S.root.z], '#ff6a50'); if (S.lure.y < 40) dotAt([S.lure.x, S.lure.y, S.lure.z], '#d8ff5a'); }
        mctx.restore();
      });
    });
  }
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 18 * 18;
    for (const h of mapHit) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } }
    if (best) { seekTo(best.t); setPlaying(false); mapEl.classList.add('hidden'); }
  });
  const openMap = () => { mapEl.classList.remove('hidden'); drawMap(); };
  $g('gvMapBtn').onclick = () => (mapEl.classList.contains('hidden') ? openMap() : mapEl.classList.add('hidden'));
  $g('gvMapClose').onclick = () => mapEl.classList.add('hidden');
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k === 'm') $g('gvMapBtn').click(); else if (k === 'escape') mapEl.classList.add('hidden');
    else if (k === '1') setView('top'); else if (k === '2') setView('aerial'); else if (k === '3') setView('side'); else if (k === '4') setView('south');
    else if (k === 'g') { layers.grid = !layers.grid; document.querySelector('[data-layer=grid]').checked = layers.grid; }
  });
  mapEl.addEventListener('transitionend', () => {});
  setInterval(() => { if (!mapEl.classList.contains('hidden')) drawMap(); }, 500);

  // ready: hide the boot veil and the film's start screen, show the scene paused at the start
  for (const id of ['start', 'loader']) $g(id)?.classList.add('gone', 'hidden');
  st.started = true; seekTo(GV_SET_TIME.atrium); setPlaying(false);
  setSet('atrium', false); setView('aerial'); renderLists();
  $g('gvBoot').classList.add('hidden');
  window.__godview = { sm, bounds, state, layers, setView, setSet, openMap, frameSet };
}

