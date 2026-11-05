/* ==========================================================================
   DIRECTOR'S DESK  (injected by tools/build-godview.cjs; lives inside the film's module)
   A Sculptor editor for the film. It samples the whole film once (robot, Ember, authored
   cameras), draws all of it over the live scene, mirrors the director's cut in a monitor with
   the film's real grade, lets you place camera keyframes for any shot, and runs a timeline.
   ========================================================================== */
const GV_RANGES = { atrium: [[0, 44], [261, FILM]], roof: [[44, 114]], forest: [[114, 261]] };
const GV_SET_NAMES = { atrium: 'The Atrium', roof: 'Rooftops', forest: 'The Glade' };
const GV_SET_TIME = { atrium: 12, roof: 60, forest: 140 };
const GV_GLYPH = { atrium: 0.5, roof: 2.2, forest: 1.3 };
const GV_CHAP_COL = ['#e0b75a', '#e8785e', '#4fc3a1', '#9b86e8'];
const GV_SET_COL = { atrium: '#7f93c9', roof: '#d98a5f', forest: '#5aa889' };
const GV_VIEW = { w: 0, h: 0 };
const GV_SHOT_NOTES = /*__GV_NOTES__*/{};
const GV_LS = { edits: 'clockwork.godview.edits.v1', grade: 'clockwork.godview.grade.v1' };
const gvInRange = (set, t) => GV_RANGES[set].some(([a, b]) => t >= a && t < b);
const gvFmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const gvFmtF = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const gvHue = (t) => { const c = new THREE.Color(); c.setHSL((0.62 - (t / FILM) * 0.62 + 1) % 1, 0.85, 0.58); return c; };
const gvIcon = { play: '<svg class="ic" viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>', pause: '<svg class="ic" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' };
const gvShotTitle = (t0, i) => { const n = GV_SHOT_NOTES[t0]; if (!n) return `Shot ${i + 1}`; const h = n.split(/\s+[—-]\s+/)[0].trim().replace(/[.]$/, ''); return h.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()); };
const gvEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function godViewInstall(film) {
  const { st, anim, seekTo, setPlaying, S, camera, renderer, scene, world, director, post } = film;
  const $g = (id) => document.getElementById(id);
  document.body.classList.add('godview');
  $g('gvBoot').classList.remove('hidden');
  const MON_ASPECT = 16 / 9;
  const gv = { notes: {}, markers: [], multi: new Set(), clip: {}, sel: 0, selKey: 0, pinned: false, editOn: false, ov: {}, thumbs: [], grade: null, tl: null, dirty: true, frameNo: 0 };
  gv.film = film;

  /* ---------- 0. stage: the film's canvas lives in the viewport cell ---------- */
  const stage = $g('gvStage'); stage.prepend(renderer.domElement);
  const fitStage = () => { const r = stage.getBoundingClientRect(), q = gv.qscale || 1; GV_VIEW.w = Math.max(64, Math.round(r.width * q)); GV_VIEW.h = Math.max(64, Math.round(r.height * q)); if (gv.xp && gv.xp.view) { GV_VIEW.w = gv.xp.view.w; GV_VIEW.h = gv.xp.view.h; } window.dispatchEvent(new Event('resize')); lineMats.forEach((m) => m.resolution.set(GV_VIEW.w, GV_VIEW.h)); };
  const lineMats = [];
  new ResizeObserver(() => { clearTimeout(fitStage.h); fitStage.h = setTimeout(fitStage, 30); }).observe(stage);

  /* ---------- 1. sample the whole film once ---------- */
  const DT = 1 / 20, N = Math.floor(FILM / DT);
  const sm = { t: new Float32Array(N), root: new Float32Array(N * 3), lure: new Float32Array(N * 3), cam: new Float32Array(N * 3), tgt: new Float32Array(N * 3), fov: new Float32Array(N), roll: new Float32Array(N), shake: new Float32Array(N), shot: new Int16Array(N), n: 0 };
  gv.sm = sm;
  const _so = { pos: V(), target: V(), fov: 40, shake: 0, roll: 0 };
  function record(i) {
    const t = i * DT; sm.t[i] = t;
    sm.root[i * 3] = S.root.x; sm.root[i * 3 + 1] = S.root.y; sm.root[i * 3 + 2] = S.root.z;
    sm.lure[i * 3] = S.lure.x; sm.lure[i * 3 + 1] = S.lure.y; sm.lure[i * 3 + 2] = S.lure.z;
    const si = director.shotAt(t); director.evalShot(si, t, _so);
    sm.cam[i * 3] = _so.pos.x; sm.cam[i * 3 + 1] = _so.pos.y; sm.cam[i * 3 + 2] = _so.pos.z;
    sm.tgt[i * 3] = _so.target.x; sm.tgt[i * 3 + 1] = _so.target.y; sm.tgt[i * 3 + 2] = _so.target.z;
    sm.fov[i] = _so.fov; sm.roll[i] = _so.roll || 0; sm.shake[i] = _so.shake; sm.shot[i] = si;
  }
  function sampleRange(a, b) {
    const i0 = clamp(Math.round(a / DT), 0, N - 1), i1 = clamp(Math.round(b / DT), 0, N - 1);
    seekTo(i0 * DT); setPlaying(false);
    for (let i = i0; i <= i1; i++) { if (i > i0) anim.step(DT); record(i); sm.n = Math.max(sm.n, i + 1); }
  }
  sampleRange(0, FILM);
  const sampleAt = (t) => clamp(Math.round(t / DT), 0, sm.n - 1);
  const rootAt = (i, out = V()) => out.set(sm.root[i * 3], sm.root[i * 3 + 1], sm.root[i * 3 + 2]);
  const lureAt = (i, out = V()) => out.set(sm.lure[i * 3], sm.lure[i * 3 + 1], sm.lure[i * 3 + 2]);
  const camAt = (i, out = V()) => out.set(sm.cam[i * 3], sm.cam[i * 3 + 1], sm.cam[i * 3 + 2]);
  const tgtAt = (i, out = V()) => out.set(sm.tgt[i * 3], sm.tgt[i * 3 + 1], sm.tgt[i * 3 + 2]);
  gv.sampleAt = sampleAt; gv.rootAt = rootAt;
  const shotOfSet = (i) => setAt(SHOTS[i].t0);
  const shotDur = (i) => SHOTS[i].t1 - SHOTS[i].t0;
  const shotT = (i, u) => SHOTS[i].t0 + u * shotDur(i);
  gv.shotT = shotT; gv.shotDur = shotDur;
  // Where to park the playhead for a key: a key at u = 1 sits on the cut, which belongs to the next shot, so stop just short of it.
  const keyT = (i, u) => Math.min(shotT(i, u), SHOTS[i].t1 - 0.05); gv.keyT = keyT;

  const bounds = {};
  const computeBounds = () => {
    for (const set of Object.keys(GV_RANGES)) {
      const b = new THREE.Box3().makeEmpty();
      for (let i = 0; i < sm.n; i++) if (gvInRange(set, sm.t[i])) { b.expandByPoint(rootAt(i)); if (sm.lure[i * 3 + 1] < 40) b.expandByPoint(lureAt(i)); b.expandByPoint(camAt(i)); }
      bounds[set] = b;
    }
  };
  computeBounds();

  /* ---------- 2. overlay objects ---------- */
  const god = new THREE.Group(); god.name = 'godview'; scene.add(god);
  const layers = { paths: true, ember: true, ticks: true, beats: false, cams: true, shots: false, grid: true, live: true };
  const byLayer = {}; for (const k in layers) byLayer[k] = [];
  const add = (layer, obj, set) => { obj.userData.layer = layer; obj.userData.set = set; obj.renderOrder = 10; god.add(obj); byLayer[layer].push(obj); return obj; };
  const remove = (obj) => { god.remove(obj); for (const k in byLayer) { const a = byLayer[k], i = a.indexOf(obj); if (i >= 0) a.splice(i, 1); } obj.traverse((o) => { o.geometry?.dispose(); if (o.material && !o.material.map) o.material.dispose?.(); }); };
  const mkLine = (pts, cols, width, dashed = false) => {
    const g = new LineGeometry(); g.setPositions(pts); g.setColors(cols);
    const m = new LineMaterial({ color: 0xffffff, linewidth: width, vertexColors: true, dashed, dashSize: 0.8, gapSize: 0.5, transparent: true, depthTest: false, depthWrite: false, worldUnits: false });
    m.resolution.set(GV_VIEW.w || innerWidth, GV_VIEW.h || innerHeight); lineMats.push(m);
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
        const t = sm.t[i], c = gvHue(t); rp.push(sm.root[i * 3], sm.root[i * 3 + 1], sm.root[i * 3 + 2]); rc.push(c.r, c.g, c.b);
        if (sm.lure[i * 3 + 1] < 40 && t > 8.9) { ep.push(sm.lure[i * 3], sm.lure[i * 3 + 1], sm.lure[i * 3 + 2]); ec.push(0.78, 1, 0.35); }
      }
      add('paths', mkLine(rp, rc, 3.5), set);
      if (ep.length > 6) add('ember', mkLine(ep, ec, 2, true), set);
    }
    for (let t = 0; t < FILM; t += 5) {
      if (!gvInRange(set, t)) continue; const i = sampleAt(t), p = rootAt(i);
      const d = add('ticks', mkDot(gvHue(t).getHex(), 0.07 * scale * 1.6), set); d.position.copy(p);
      const l = add('ticks', mkLabel(gvFmt(t), '#e8e8f0', 0.026), set); l.position.copy(p);
    }
    for (const b of BEATS) {
      if (!gvInRange(set, b.t0)) continue; const i = sampleAt(b.t0);
      const l = add('beats', mkLabel(`${gvFmt(b.t0)} ${b.name}`, '#ffd28a', 0.03), set); l.position.copy(rootAt(i)); l.position.y += 0.4 * scale; l.center.set(0, -0.6);
    }
  }
  /* authored camera glyphs, one per shot; rebuilt for a shot after it is edited */
  const shotObjs = [], camPathObjs = {};
  function buildShotGlyph(idx) {
    const old = shotObjs[idx]; if (old) { remove(old.g); remove(old.l); }
    const sh = SHOTS[idx], set = shotOfSet(idx), scale = GV_GLYPH[set], i = sampleAt(sh.t0 + 0.2);
    const p = camAt(i), tg = tgtAt(i), dir = tg.clone().sub(p), len = Math.min(dir.length(), 40 * scale), g = new THREE.Group();
    dir.normalize();
    const edited = !!gv.ov[sh.t0];
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22 * scale, 0.7 * scale, 4), new THREE.MeshBasicMaterial({ color: edited ? 0xffb347 : 0xffffff, wireframe: true, depthTest: false, toneMapped: false }));
    cone.geometry.rotateX(Math.PI / 2); cone.lookAt(dir); g.add(cone);
    g.add(mkLine([0, 0, 0, dir.x * len * 0.35, dir.y * len * 0.35, dir.z * len * 0.35], edited ? [1, 0.7, 0.28, 1, 0.7, 0.28] : [1, 1, 1, 1, 1, 1], 1.2, true));
    g.position.copy(p); add('cams', g, set);
    const l = add('shots', mkLabel(`S${idx + 1}  ${gvFmt(sh.t0)}`, edited ? '#ffb347' : '#bfe3ff', 0.024), set); l.position.copy(p);
    shotObjs[idx] = { g, l };
  }
  function buildCamPath(set) {
    if (camPathObjs[set]) remove(camPathObjs[set]);
    const cp = [], cc = [];
    for (const [a, b] of GV_RANGES[set]) for (let i = sampleAt(a); i < sampleAt(b); i += 2) { cp.push(sm.cam[i * 3], sm.cam[i * 3 + 1], sm.cam[i * 3 + 2]); cc.push(0.55, 0.75, 1); }
    camPathObjs[set] = add('cams', mkLine(cp, cc, 1, true), set); camPathObjs[set].material.opacity = 0.35;
  }
  SHOTS.forEach((_, i) => buildShotGlyph(i));
  for (const set of Object.keys(GV_RANGES)) buildCamPath(set);

  /* the selected shot: camera path, target path, and view rays through the shot */
  const selG = new THREE.Group(); god.add(selG); selG.userData.setOf = 'atrium';
  function buildSelPath() {
    while (selG.children.length) { const c = selG.children[0]; selG.remove(c); c.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    const i = gv.sel, sh = SHOTS[i], i0 = sampleAt(sh.t0), i1 = sampleAt(sh.t1 - DT), set = shotOfSet(i), g = GV_GLYPH[set];
    selG.userData.setOf = set;
    const cp = [], cc = [], tp = [], tc = [];
    for (let k = i0; k <= i1; k++) { cp.push(sm.cam[k * 3], sm.cam[k * 3 + 1], sm.cam[k * 3 + 2]); cc.push(0.42, 0.77, 1); tp.push(sm.tgt[k * 3], sm.tgt[k * 3 + 1], sm.tgt[k * 3 + 2]); tc.push(1, 0.45, 0.85); }
    if (cp.length >= 6) { selG.add(mkLine(cp, cc, 3)); selG.add(mkLine(tp, tc, 2, true)); }
    const rays = [], rc = [];
    const nR = Math.max(2, Math.min(7, Math.round(shotDur(i) / 0.6)));
    for (let r = 0; r < nR; r++) { const k = Math.round(i0 + (i1 - i0) * (r / (nR - 1))); rays.push(sm.cam[k * 3], sm.cam[k * 3 + 1], sm.cam[k * 3 + 2], sm.tgt[k * 3], sm.tgt[k * 3 + 1], sm.tgt[k * 3 + 2]); const f = 0.35 + 0.65 * (r / (nR - 1)); rc.push(0.42 * f, 0.77 * f, f, 1 * f, 0.45 * f, 0.85 * f); }
    for (let r = 0; r < nR; r++) selG.add(mkLine(rays.slice(r * 6, r * 6 + 6), rc.slice(r * 6, r * 6 + 6), 1.2));
    const s0 = mkDot(0x6cc4ff, 0.12 * g * 1.6); s0.position.set(sm.cam[i0 * 3], sm.cam[i0 * 3 + 1], sm.cam[i0 * 3 + 2]); selG.add(s0);
    const s1 = mkDot(0xff73d9, 0.1 * g * 1.6); s1.position.set(sm.tgt[i0 * 3], sm.tgt[i0 * 3 + 1], sm.tgt[i0 * 3 + 2]); selG.add(s1);
    selG.traverse((o) => { o.renderOrder = 11; });
  }

  /* live markers: hero and Ember beacons plus the camera currently in use */
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
  const state = { set: 'atrium', auto: true, follow: false, clipOn: false, clipY: 30, fogOff: true, exposure: 1.6 };
  gv.state = state; gv.layers = layers; gv.bounds = bounds;
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 30);
  director.setMode('follow'); director.controls.enabled = false;
  camera.far = 4000; camera.near = 0.1; camera.fov = 50; camera.updateProjectionMatrix();
  post.dissolve.enabled = false;
  const real = { exposure: CH.exposure.sample.bind(CH.exposure), fade: CH.fade.sample.bind(CH.fade), vig: CH.vig.sample.bind(CH.vig), bloom: CH.bloom.sample.bind(CH.bloom) };

  /* colour grade: presets from the film plus free sliders, applied to the monitor (and optionally the god view) */
  const gradeNames = {}; document.querySelectorAll('#selGrade option').forEach((o) => { gradeNames[o.value] = o.textContent; });
  if (!gradeNames.default) gradeNames.default = 'Original color grade';
  const cloneGrade = (p) => JSON.parse(JSON.stringify(p));
  const G = gv.grade = { base: GRADE_PRESETS.directorgrade ? 'directorgrade' : 'default', vals: null, scope: 'film', applyGod: false, bypass: false, touched: false };
  G.vals = cloneGrade(GRADE_PRESETS[G.base]);
  GRADE_PRESETS.gvcustom = G.vals;
  const gradeDefaults = () => ({ ...cloneGrade(GRADE_PRESETS[G.base]) });
  const lookGod = () => {
    const ap = G.applyGod && !G.bypass;
    CH.fade.sample = () => 0; CH.vig.sample = () => 0.25;
    CH.exposure.sample = (t) => Math.max(0.85, real.exposure(t)) * state.exposure;
    CH.bloom.sample = (t) => real.bloom(t);
    post.setPreset(ap ? 'gvcustom' : 'default');
  };
  const lookMon = () => {
    CH.fade.sample = real.fade; CH.vig.sample = real.vig;
    CH.exposure.sample = real.exposure;
    CH.bloom.sample = real.bloom;
    post.setPreset(G.bypass ? 'default' : 'gvcustom');
  };
  lookGod();

  function frameSet(set, mode) {
    const b = bounds[set], c = b.getCenter(V()), size = b.getSize(V()), span = Math.max(size.x, size.z, size.y * 0.8, 6);
    const fit = (span * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    controls.target.copy(c); controls.target.y = Math.max(b.min.y, c.y - size.y * 0.25);
    const dirs = { top: V(0, 1, 0.0001), aerial: V(0.55, 0.62, 0.78), side: V(0, 0.18, 1), south: V(0, 0.5, 1) };
    camera.position.copy(controls.target).addScaledVector((dirs[mode] || dirs.aerial).normalize(), fit);
    controls.update();
    grid.position.set(c.x, b.min.y - 0.02, c.z); const gsz = Math.max(20, Math.ceil(span * 1.8 / 10) * 10); grid.scale.setScalar(gsz / 200);
  }
  let curView = 'aerial';
  function setView(mode) { curView = mode; frameSet(state.set, mode); document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === mode)); }
  function setSet(set, jump = true) {
    state.set = set; document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === set));
    if (jump && !gvInRange(set, st.T)) seekTo(GV_SET_TIME[set]);
    setView(curView); gv.dirty = true; buildSelPath();
  }
  function frameShot(i) {
    const set = shotOfSet(i); if (state.set !== set) { state.set = set; document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === set)); }
    const i0 = sampleAt(SHOTS[i].t0), i1 = sampleAt(SHOTS[i].t1 - DT), b = new THREE.Box3().makeEmpty();
    for (let k = i0; k <= i1; k += 2) { b.expandByPoint(camAt(k)); b.expandByPoint(tgtAt(k)); b.expandByPoint(rootAt(k)); }
    const key = gv.ov[SHOTS[i].t0]; if (key) for (const k of key.keys) { const w = keyWorld(i, k); b.expandByPoint(w.pos); b.expandByPoint(w.tgt); }
    const c = b.getCenter(V()), size = b.getSize(V()), span = Math.max(size.x, size.y, size.z, 3);
    controls.target.copy(c); const d = (span * 0.9) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dir = _fwd.copy(camera.position).sub(controls.target).normalize(); if (dir.lengthSq() < 0.5) dir.set(0.55, 0.62, 0.78).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, d); controls.update();
  }

  /* ---------- 4. shot overrides: the camera editor's model ---------- */
  const _r1 = V(), _r3 = V(), _kw = { pos: V(), tgt: V() };
  const keyRoot = (i, k, out) => rootAt(sampleAt(shotT(i, k.u)), out);
  const aimOf = (ov) => (ov && (ov.aim || (ov.rel ? 'robot' : 'world'))) || 'world'; // what the aim offsets are measured from
  function anchorsOf(i, k) { // where the key's offsets are measured from, at the key's own moment: { pos, tgt } as vectors or null
    const ov = gv.ov[SHOTS[i].t0], aim = aimOf(ov), idx = sampleAt(shotT(i, k.u));
    const needRoot = !!ov && (ov.rel || aim === 'robot'); if (needRoot) rootAt(idx, _r1);
    if (aim === 'ember') lureAt(idx, _r3);
    return { pos: ov && ov.rel ? _r1 : null, tgt: aim === 'robot' ? _r1 : aim === 'ember' ? _r3 : null };
  }
  function keyWorld(i, k, out = { pos: V(), tgt: V() }) {
    out.pos.set(k.pos[0], k.pos[1], k.pos[2]); out.tgt.set(k.target[0], k.target[1], k.target[2]);
    const an = anchorsOf(i, k); if (an.pos) out.pos.add(an.pos); if (an.tgt) out.tgt.add(an.tgt);
    return out;
  }
  function setKeyWorld(i, k, pos, tgt) {
    const an = anchorsOf(i, k), P = an.pos || { x: 0, y: 0, z: 0 }, T = an.tgt || { x: 0, y: 0, z: 0 };
    if (pos) { k.pos = [pos.x - P.x, pos.y - P.y, pos.z - P.z]; }
    if (tgt) { k.target = [tgt.x - T.x, tgt.y - T.y, tgt.z - T.z]; }
  }
  function keyFromSample(i, u) {
    const k = sampleAt(clamp(shotT(i, u), SHOTS[i].t0, SHOTS[i].t1 - DT));
    const p = camAt(k), tg = tgtAt(k);
    return { u, pos: [p.x, p.y, p.z], target: [tg.x, tg.y, tg.z], fov: +sm.fov[k].toFixed(2), roll: +sm.roll[k].toFixed(4), shake: +sm.shake[k].toFixed(3) };
  }
  const round3 = (v) => Math.round(v * 1000) / 1000;
  function applyOv(i) { const t0 = SHOTS[i].t0, ov = gv.ov[t0]; applyShotOverride(t0, ov && ov.keys.length ? ov : null); gv.dirty = true; gv.pv.dirty = true; }
  /* ---------- projects: an autosaved draft, plus named projects the user chooses to save ---------- */
  const PKEY = 'clockwork.projects.v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const G_BASE0 = G.base;
  let PS = { version: 2, draft: null, projects: {} };
  let PFROM = null; // id of the saved project the open work came from
  let storageOk = true, ptimer = 0;
  const readStore = () => { try { const x = JSON.parse(localStorage.getItem(PKEY) || 'null'); return x && x.projects ? x : null; } catch (e) { return null; } };
  const writeStore = () => { try { localStorage.setItem(PKEY, JSON.stringify(PS)); storageOk = true; } catch (e) { storageOk = false; } return storageOk; };
  const gradeState = () => ({ base: G.base, vals: G.vals, applyGod: G.applyGod, touched: G.touched });
  /* older saves kept exposure and bloom beside the values; fold them in */
  const legacyVals = (gs) => { const v = clone(gs.vals); if (gs.exposure != null && gs.exposure !== 1 && v.exposure == null) v.exposure = gs.exposure; if (gs.bloom != null && gs.bloom !== 1 && v.bloom == null) v.bloom = gs.bloom; return v; };
  const setVals = (v) => { G.vals = v; GRADE_PRESETS.gvcustom = v; };
  const snapshot = () => ({ overrides: clone(gv.ov), grade: G.touched ? clone(gradeState()) : null, notes: clone(gv.notes), markers: clone(gv.markers) });
  const baseline = () => ({ overrides: clone(SHOT_OVERRIDES), grade: null, notes: {}, markers: [] });
  const sameWork = (a, b) => JSON.stringify([a.overrides || {}, a.grade ? a.grade.vals : null, a.notes || {}, a.markers || []]) === JSON.stringify([b.overrides || {}, b.grade ? b.grade.vals : null, b.notes || {}, b.markers || []]);
  const curProject = () => (PFROM && PS.projects[PFROM]) || null;
  function projState() { // clean: matches the saved project, dirty: changed since saving, draft: edits with no project, empty: nothing yet
    const w = snapshot(), p = curProject();
    if (p) return sameWork(w, p) ? 'clean' : 'dirty';
    return sameWork(w, baseline()) ? 'empty' : 'draft';
  }
  function renderProjectBar() {
    const p = curProject(), st = projState(), el = $g('gvSave');
    $g('gvProjName').textContent = p ? p.name : 'Untitled draft';
    el.textContent = !storageOk ? 'Not stored (browser storage blocked)' : st === 'clean' ? 'Saved' : st === 'dirty' ? 'Unsaved changes' : st === 'draft' ? 'Draft, autosaved' : 'No changes yet';
    el.title = el.textContent; el.className = 'save ' + (!storageOk ? 'blocked' : st === 'dirty' || st === 'draft' ? 'saving' : '');
    $g('gvSaveBtn').disabled = st === 'clean' || st === 'empty'; $g('gvSaveBtn').textContent = p ? 'Save' : 'Save project';
    $g('gvPlayFilm').disabled = !storageOk;
  }
  function persistNow() { clearTimeout(ptimer); ptimer = 0; PS.draft = { ...snapshot(), from: PFROM, updated: Date.now() }; writeStore(); renderProjectBar(); if (typeof histPush === 'function' && hist) histPush(); }
  let hist = null; // undo history, created once the desk is built
  function schedulePersist() { clearTimeout(ptimer); ptimer = setTimeout(persistNow, 250); }
  const saveEdits = schedulePersist, saveGrade = schedulePersist;
  addEventListener('pagehide', () => { if (ptimer) persistNow(); });

  function resampleShot(i) {
    const T0 = st.T, was = st.playing; sampleRange(SHOTS[i].t0, SHOTS[i].t1 - DT);
    seekTo(T0); setPlaying(was);
    computeBounds(); buildShotGlyph(i); buildCamPath(shotOfSet(i)); buildSelPath();
  }
  function setAim(mode) { // what the camera looks at: a fixed point, or offsets that follow the robot or Ember
    const i = gv.sel, ov = gv.ov[SHOTS[i].t0]; if (!ov || aimOf(ov) === mode) return;
    const worlds = ov.keys.map((k) => { const w = keyWorld(i, k); return { pos: w.pos.clone(), tgt: w.tgt.clone() }; });
    if (mode === (ov.rel ? 'robot' : 'world')) delete ov.aim; else ov.aim = mode;
    ov.keys.forEach((k, n) => setKeyWorld(i, k, null, worlds[n].tgt)); ov.keys.forEach((k) => { k.target = k.target.map(round3); });
    applyOv(i); saveEdits(); resampleShot(i); renderInspector(); rebuildEdit();
  }
  function editKeys(fn, after = true) { const i = gv.sel, ov = gv.ov[SHOTS[i].t0]; if (!ov) return; fn(ov, i); applyOv(i); saveEdits(); resampleShot(i); renderInspector(); rebuildEdit(); if (after) renderExport(); }
  const LENSES = [18, 24, 35, 50, 85, 135];
  const mmToFov = (mm) => +(2 * THREE.MathUtils.radToDeg(Math.atan(12 / mm))).toFixed(2);
  function enterEdit(i) {
    const t0 = SHOTS[i].t0;
    if (!gv.ov[t0]) {
      const us = shotDur(i) > 2.5 ? [0, 0.5, 1] : [0, 1];
      gv.ov[t0] = { rel: false, keys: us.map((u) => keyFromSample(i, u)) };
      applyOv(i); saveEdits(); resampleShot(i); renderShotRows(); renderExport();
    }
    gv.editOn = true; gv.pinned = true; gv.selKey = Math.min(gv.selKey, gv.ov[t0].keys.length - 1); gv.dirty = true; renderInspector();
  }
  function exitEdit() { gv.editOn = false; gv.pinned = false; renderInspector(); }
  function resetShot(i) { delete gv.ov[SHOTS[i].t0]; applyOv(i); saveEdits(); gv.editOn = false; gv.pinned = false; resampleShot(i); renderShotRows(); renderInspector(); renderExport(); }
  function addKeyHere() {
    const i = gv.sel, ov = gv.ov[SHOTS[i].t0]; if (!ov) return;
    const T = clamp(st.T, SHOTS[i].t0, SHOTS[i].t1), u = (T - SHOTS[i].t0) / shotDur(i);
    if (ov.keys.some((k) => Math.abs(k.u - u) < 0.015)) return;
    const o = { pos: V(), target: V(), fov: 40, shake: 0.15, roll: 0 }; director.evalShot(i, T, o);
    const k = { u: round3(u), pos: [0, 0, 0], target: [0, 0, 0], fov: +o.fov.toFixed(2), roll: +(o.roll || 0).toFixed(4), shake: +o.shake.toFixed(3) };
    setKeyWorld(i, k, o.pos, o.target);
    k.pos = k.pos.map(round3); k.target = k.target.map(round3);
    ov.keys.push(k); ov.keys.sort((a, b) => a.u - b.u); gv.selKey = ov.keys.indexOf(k);
    applyOv(i); saveEdits(); resampleShot(i); renderInspector(); renderExport();
  }
  function deleteKey() {
    const i = gv.sel, ov = gv.ov[SHOTS[i].t0]; if (!ov || ov.keys.length <= 1) return;
    ov.keys.splice(gv.selKey, 1); ov.keys[0].u = 0; ov.keys[ov.keys.length - 1].u = ov.keys.length > 1 ? 1 : ov.keys[0].u;
    gv.selKey = clamp(gv.selKey, 0, ov.keys.length - 1); applyOv(i); saveEdits(); resampleShot(i); renderInspector(); renderExport();
  }
  function toggleRel(rel) {
    const i = gv.sel, ov = gv.ov[SHOTS[i].t0]; if (!ov || ov.rel === rel) return;
    const worlds = ov.keys.map((k) => { const w = keyWorld(i, k); return { pos: w.pos.clone(), tgt: w.tgt.clone() }; });
    const aim = aimOf(ov); ov.rel = rel; if (ov.aim || aim !== (rel ? 'robot' : 'world')) ov.aim = aim; ov.keys.forEach((k, n) => setKeyWorld(i, k, worlds[n].pos, worlds[n].tgt));
    ov.keys.forEach((k) => { k.pos = k.pos.map(round3); k.target = k.target.map(round3); });
    applyOv(i); saveEdits(); resampleShot(i); renderInspector();
  }
  function selectKey(n, seek = true) { gv.selKey = n; const ov = gv.ov[SHOTS[gv.sel].t0]; if (seek && ov) { seekTo(keyT(gv.sel, ov.keys[n].u)); setPlaying(false); } renderInspector(); gv.dirty = true; }
  function moveKeyU(n, u) {
    const i = gv.sel, ov = gv.ov[SHOTS[i].t0]; if (!ov || n === 0 || n === ov.keys.length - 1) return;
    ov.keys[n].u = round3(clamp(u, ov.keys[n - 1].u + 0.02, ov.keys[n + 1].u - 0.02)); applyOv(i); saveEdits(); gv.dirty = true;
  }
  gv.moveKeyU = moveKeyU; gv.commitKeys = () => { resampleShot(gv.sel); renderInspector(); };

  /* 3D gizmos and key visuals for the shot being edited */
  const editG = new THREE.Group(); scene.add(editG);
  const proxyPos = new THREE.Object3D(), proxyTgt = new THREE.Object3D(); scene.add(proxyPos, proxyTgt);
  const tcPos = new TransformControls(camera, renderer.domElement), tcTgt = new TransformControls(camera, renderer.domElement);
  tcPos.setSize(0.75); tcTgt.setSize(0.6); tcPos.setSpace('world'); tcTgt.setSpace('world');
  const helperPos = tcPos.getHelper(), helperTgt = tcTgt.getHelper(); scene.add(helperPos, helperTgt);
  helperPos.visible = helperTgt.visible = false;
  let dragging = false;
  for (const tc of [tcPos, tcTgt]) tc.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; dragging = e.value; if (!e.value) gv.commitKeys(); });
  const onGizmo = () => {
    const i = gv.sel, ov = gv.ov[SHOTS[i].t0]; if (!ov) return; const k = ov.keys[gv.selKey]; if (!k) return;
    setKeyWorld(i, k, proxyPos.position, proxyTgt.position);
    k.pos = k.pos.map(round3); k.target = k.target.map(round3); applyOv(i); saveEdits(); syncKeyFields();
  };
  tcPos.addEventListener('objectChange', onGizmo); tcTgt.addEventListener('objectChange', onGizmo);
  const editMat = (c, o = 1) => new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, toneMapped: false });
  function frustumGeom(fov, len) {
    const h = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * len, w = h * MON_ASPECT, v = [[0, 0, 0], [-w, -h, len], [w, -h, len], [w, h, len], [-w, h, len]], idx = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [2, 3], [3, 4], [4, 1]], pts = [];
    for (const [a, b] of idx) pts.push(...v[a], ...v[b]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
  }
  function rebuildEdit() {
    while (editG.children.length) { const c = editG.children[0]; editG.remove(c); c.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    const i = gv.sel, ov = gv.ov[SHOTS[i].t0], on = gv.editOn && ov && shotOfSet(i) === state.set;
    helperPos.visible = helperTgt.visible = !!on; tcPos.enabled = tcTgt.enabled = !!on;
    if (!on) { tcPos.detach(); tcTgt.detach(); return; }
    const g = GV_GLYPH[state.set], pathPts = [];
    ov.keys.forEach((k, n) => {
      const w = keyWorld(i, k), sel = n === gv.selKey, col = sel ? 0xffb347 : 0x9a7433;
      const fr = new THREE.LineSegments(frustumGeom(k.fov, 1.8 * g), editMat(col, sel ? 1 : 0.7)); fr.position.copy(w.pos); fr.lookAt(w.tgt); fr.renderOrder = 20; editG.add(fr);
      const tp = mkDot(sel ? 0xff73d9 : 0x8a4a7a, (sel ? 0.16 : 0.1) * g); tp.position.copy(w.tgt); tp.renderOrder = 20; editG.add(tp);
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([w.pos, w.tgt]), editMat(sel ? 0xffd9a0 : 0x6a5a3a, sel ? 0.9 : 0.5)); ln.renderOrder = 20; editG.add(ln);
      pathPts.push(w.pos.clone());
    });
    if (pathPts.length > 1) { const cv = new THREE.CatmullRomCurve3(pathPts); const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(cv.getPoints(pathPts.length * 24)), editMat(0xffd27a, 0.95)); l.renderOrder = 20; editG.add(l); }
    const sk = ov.keys[gv.selKey], w = keyWorld(i, sk);
    proxyPos.position.copy(w.pos); proxyTgt.position.copy(w.tgt);
    tcPos.attach(proxyPos); tcTgt.attach(proxyTgt);
  }
  gv.rebuildEdit = rebuildEdit;

  /* ---------- 5. the director's-cut monitor, grade and thumbnails ---------- */
  const monitor = $g('gvMon'), mctx = monitor.getContext('2d');
  const pv = gv.pv = { on: true, rate: 1, pos: V(), quat: new THREE.Quaternion(), fov: 40, lastT: -1, dirty: true, need: false, fog: 0 };
  const cap = { active: false, i: 0, restoreT: 0, restoreSet: 'atrium' };
  const xp = gv.xp = { active: false, want: false, ready: null, view: null }; // the exporter (godview.studio.js) steps the film frame by frame
  const thumbCv = document.createElement('canvas'); thumbCv.width = 192; thumbCv.height = 108; const thumbCtx = thumbCv.getContext('2d');
  const origUpdate = director.update;
  const _gp = V(), _gq = new THREE.Quaternion();
  function computePreviewPose(T, dt) {
    _gp.copy(camera.position); _gq.copy(camera.quaternion); const gfov = camera.fov, mode = director.mode;
    camera.aspect = MON_ASPECT;
    if (T < pv.lastT - 0.001 || T - pv.lastT > 0.25) director.prevCineShot = -1;
    director.mode = 'director';
    origUpdate.call(director, T, Math.min(Math.max(dt, 1 / 120), 1 / 30));
    pv.pos.copy(camera.position); pv.quat.copy(camera.quaternion); pv.fov = camera.fov; pv.lastT = T;
    director.mode = mode; camera.position.copy(_gp); camera.quaternion.copy(_gq); camera.fov = gfov;
    camera.aspect = GV_VIEW.w / Math.max(1, GV_VIEW.h); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    S.cam.copy(camera.position);
  }
  const render0 = post.render.bind(post);
  const hideDuring = [god, helperPos, helperTgt, editG];
  function renderMonitor(t, time, o) {
    const gp = _gp.copy(camera.position), gq = _gq.copy(camera.quaternion), gfov = camera.fov, vis = hideDuring.map((h) => h.visible), clips = renderer.clippingPlanes, fog = scene.fog.density;
    camera.position.copy(pv.pos); camera.quaternion.copy(pv.quat); camera.fov = pv.fov; camera.aspect = MON_ASPECT; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    hideDuring.forEach((h) => { h.visible = false; }); renderer.clippingPlanes = []; scene.fog.density = pv.fog;
    world.sky.follow(camera); lookMon();
    render0(t, time, { ...o, letter: clamp((1 - MON_ASPECT / 2.2) / 2, 0, 0.12), cinematic: true });
    const src = renderer.domElement;
    mctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, monitor.width, monitor.height);
    if (cap.active) captureThumb();
    if (xp.active && xp.want) { xp.want = false; setPlaying(false); xp.ready && xp.ready(); }
    hideDuring.forEach((h, n) => { h.visible = vis[n]; }); renderer.clippingPlanes = clips; scene.fog.density = fog;
    camera.position.copy(gp); camera.quaternion.copy(gq); camera.fov = gfov; camera.aspect = GV_VIEW.w / Math.max(1, GV_VIEW.h); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    world.sky.follow(camera);
  }
  // Idle saver: when nothing is playing and nothing has changed (time, camera, canvas size, input), the viewport is
  // not redrawn every frame. Any input, or a 250 ms heartbeat for changes made from code, brings full rate straight back.
  film.idle.heartbeat = -1; // the desk has its own idle saver below; the film's must never skip its calls (monitor, grade preview)
  const idle = gv.idle = { heartbeat: 250, lastInput: performance.now(), lastDraw: 0, sig: new Float64Array(12), skipped: 0, drawn: 0 };
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'input', 'change', 'touchstart']) addEventListener(ev, () => { idle.lastInput = performance.now(); }, { capture: true, passive: true });
  const idleSig = (T) => {
    const c = renderer.domElement, p = camera.position, q = camera.quaternion, sg = idle.sig; let same = true;
    const v = [T, p.x, p.y, p.z, q.x, q.y, q.z, q.w, camera.fov, c.width, c.height, post.gtao.blendIntensity]; // the AO fade eases per drawn frame, so wait for it to settle
    for (let n = 0; n < v.length; n++) { if (Math.abs(sg[n] - v[n]) > (n === 11 ? 1e-4 : 0)) same = false; }
    if (!same) for (let n = 0; n < v.length; n++) sg[n] = v[n];
    return same;
  };
  post.render = (t, time, o) => {
    const now = performance.now(), same = idleSig(st.T);
    if (same && !pv.need && !st.playing && !dragging && !cap.active && now - idle.lastInput > 1200 && now - idle.lastDraw < idle.heartbeat) { idle.skipped++; return; }
    idle.lastDraw = now; idle.drawn++;
    if (pv.need) { pv.need = false; renderMonitor(t, time, o); }
    lookGod();
    render0(t, time, { ...o, cinematic: false, letter: 0 });
  };
  function captureThumb() {
    thumbCtx.drawImage(monitor, 0, 0, monitor.width, monitor.height, 0, 0, 192, 108);
    const c = document.createElement('canvas'); c.width = 192; c.height = 108; c.getContext('2d').drawImage(thumbCv, 0, 0);
    gv.thumbs[cap.i] = c; cap.i++; gv.dirty = true;
    $g('gvCapStat').textContent = `${cap.i} / ${SHOTS.length}`;
    if (cap.i % 6 === 0 || cap.i >= SHOTS.length) renderShotRows();
    nextCapture();
  }
  function nextCapture() {
    if (cap.i >= SHOTS.length) { cap.active = false; state.auto = $g('gvAuto').checked; seekTo(cap.restoreT); setSet(cap.restoreSet, false); $g('gvCapture').textContent = 'Capture all shots'; renderShotRows(); return; }
    const s = SHOTS[cap.i]; seekTo(s.t0 + Math.min(1.2, (s.t1 - s.t0) * 0.45)); pv.dirty = true;
  }
  function startCapture() {
    if (cap.active) { cap.active = false; $g('gvCapture').textContent = 'Capture all shots'; seekTo(cap.restoreT); return; }
    cap.active = true; cap.i = 0; cap.restoreT = st.T; cap.restoreSet = state.set; setPlaying(false); pv.on = true; $g('gvMonOn').checked = true; $g('gvCapture').textContent = 'Stop capturing'; nextCapture();
  }

  /* ---------- 6. the per-frame update ---------- */
  const _o = { pos: V(), target: V(), fov: 40, shake: 0, roll: 0 }, _root = V(), _last = V(), _fwd = V(), _tmp = V();
  let lastRootSet = false, lastSelTick = -1;
  // Monitor rate. "Auto" keeps the monitor at full rate while the machine keeps up and halves it (then quarters it) only
  // while playback is struggling, which frees the second full render per frame. It recovers on its own.
  const mon = { auto: true, level: 1, lastFpsT: 0, good: 0 };
  function monRate() {
    if (!mon.auto) return pv.rate;
    const fps = st.fps; if (fps && fps !== mon.lastFpsT) {
      mon.lastFpsT = fps;
      if (fps < 50 && mon.level < 4) { mon.level *= 2; mon.good = 0; }
      else if (fps > 58 && mon.level > 1) { if (++mon.good >= 4) { mon.level /= 2; mon.good = 0; } }
      else mon.good = 0;
    }
    return mon.level;
  }
  gv.mon = mon;
  director.update = function godUpdate(T, dt) {
    const set = world.cur;
    if (state.auto && !cap.active && set !== state.set) { state.set = set; setView(curView); document.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === set)); buildSelPath(); rebuildEdit(); pv.dirty = true; }
    pv.fog = scene.fog.density;
    if (state.fogOff) scene.fog.density = 0;
    renderer.clippingPlanes = state.clipOn ? [clip] : []; clip.constant = state.clipY;
    if (state.follow) { _root.copy(S.root); if (lastRootSet) { _fwd.copy(_root).sub(_last); controls.target.add(_fwd); camera.position.add(_fwd); } _last.copy(_root); lastRootSet = true; } else lastRootSet = false;
    controls.update();
    // the selection follows the playhead unless a shot is pinned (or being edited)
    const si = director.shotAt(T);
    if (!gv.pinned && !cap.active && si !== gv.sel) selectShot(si, false);
    // overlays
    const cur = state.set, i = sampleAt(T);
    for (const k in byLayer) for (const o of byLayer[k]) o.visible = layers[k] && (o.userData.set === undefined || o.userData.set === cur);
    selG.visible = shotOfSet(gv.sel) === cur; live.visible = layers.live;
    const g = GV_GLYPH[cur];
    heroBeacon.position.copy(S.root); heroBeacon.scale.setScalar(g); heroLabel.position.copy(S.root).add(_fwd.set(0, 0.8 * g, 0));
    emberBeacon.visible = emberLabel.visible = S.lure.y < 40 && T > 8.9;
    emberBeacon.position.copy(S.lure); emberBeacon.scale.setScalar(g); emberLabel.position.copy(S.lure).add(_fwd.set(0, 0.7 * g, 0));
    const floorY = bounds[cur].min.y - 0.02;
    heroDrop.position.set(S.root.x, floorY, S.root.z); heroDrop.scale.set(1, S.root.y - floorY, 1);
    emberDrop.position.set(S.lure.x, floorY, S.lure.z); emberDrop.scale.set(1, Math.max(0.01, S.lure.y - floorY), 1); emberDrop.visible = emberBeacon.visible;
    // gizmos follow their key unless being dragged
    if (gv.editOn && tcPos.enabled && !dragging) { const ov = gv.ov[SHOTS[gv.sel].t0], k = ov?.keys[gv.selKey]; if (k) { const w = keyWorld(gv.sel, k); proxyPos.position.copy(w.pos); proxyTgt.position.copy(w.tgt); } }
    // the director's camera, as the film's own director computes it
    gv.frameNo++;
    const playing = st.playing, moved = T !== pv.lastT;
    if (pv.on && (cap.active || xp.active || pv.dirty || (moved && (!playing || gv.frameNo % monRate() === 0)))) { computePreviewPose(T, dt || 1 / 60); pv.need = true; pv.dirty = false; }
    liveCam.position.copy(pv.pos); liveCam.scale.setScalar(g * 1.4); _fwd.set(0, 0, -1).applyQuaternion(pv.quat); liveCam.lookAt(_tmp.copy(pv.pos).add(_fwd));
    liveRay.position.copy(pv.pos); const L = 25 * g; liveRay.scale.set(1, 1, L); liveRay.quaternion.setFromUnitVectors(V(0, 0, 1), _fwd.normalize());
    world.sky.follow(camera);
    updateLive(T, i);
  };

  /* ---------- 7. panels ---------- */
  const readout = $g('gvReadout');
  function selectShot(i, seek = true) {
    gv.sel = clamp(i, 0, SHOTS.length - 1);
    const ov = gv.ov[SHOTS[gv.sel].t0]; gv.selKey = clamp(gv.selKey, 0, ov ? ov.keys.length - 1 : 0);
    if (!ov && gv.editOn) { gv.editOn = false; gv.pinned = false; }
    if (seek) { seekTo(SHOTS[gv.sel].t0 + 0.05); setPlaying(false); }
    buildSelPath(); renderInspector(); markShotRows(); rebuildEdit(); gv.dirty = true; pv.dirty = true;
    if (G.scope !== 'film' && gv.renderGrade) gv.renderGrade();
  }
  gv.selectShot = selectShot; gv.shotOfSet = shotOfSet;
  const stepShot = (d) => { const i = clamp(director.shotAt(st.T) + d, 0, SHOTS.length - 1); gv.pinned = false; gv.editOn = false; selectShot(i, true); };

  let lastBeat = -1, lastShotRow = -1, lastClock = '';
  function updateLive(T, i) {
    const clock = `<b>${gvFmtF(T)}</b> / ${gvFmt(FILM)}`; if (clock !== lastClock) { $g('gvClock').innerHTML = clock; lastClock = clock; }
    const f = (v) => v.toFixed(1), bi = beatAt(T), ci = chapterAt(T);
    readout.innerHTML = `<b>${GV_SET_NAMES[world.cur]}</b> · Ch ${CHAPTERS[ci].num} ${CHAPTERS[ci].name} · ${BEATS[bi].name}<br><span class="r">Robot</span> ${f(S.root.x)}, ${f(S.root.y)}, ${f(S.root.z)} &nbsp; <span class="e">Ember</span> ${S.lure.y < 40 ? `${f(S.lure.x)}, ${f(S.lure.y)}, ${f(S.lure.z)}` : 'off stage'}`;
    if (bi !== lastBeat) { lastBeat = bi; markBeatRows(bi); }
    if (gv.sel !== lastShotRow) { lastShotRow = gv.sel; markShotRows(); }
    // monitor text
    const sh = SHOTS[gv.sel], focal = 12 / Math.tan(THREE.MathUtils.degToRad(pv.fov / 2));
    $g('gvMonTc').textContent = `S${gv.sel + 1}  ${gvFmtF(T)}`; $g('gvMonLens').textContent = `${focal.toFixed(0)} mm · ${pv.fov.toFixed(0)}°`;
    $g('gvMonShot').textContent = `S${gv.sel + 1} · ${gvShotTitle(sh.t0, gv.sel)}`;
    $g('gvMonPose').textContent = `${pv.pos.x.toFixed(1)}, ${pv.pos.y.toFixed(1)}, ${pv.pos.z.toFixed(1)}`;
    const playSvg = st.playing ? gvIcon.pause : gvIcon.play;
    for (const id of ['gvPlay', 'gvMonPlay']) { const b = $g(id); if (b.dataset.st !== String(st.playing)) { b.innerHTML = playSvg; b.dataset.st = String(st.playing); } }
    $g('gvEditBadge').classList.toggle('hidden', !gv.editOn);
    if (gv.tl && (gv.dirty || T !== gv.tl.lastT || st.playing)) { gv.tl.draw(T); gv.dirty = false; }
  }

  /* shots and beats lists */
  const thumbURL = [];
  function renderShotRows() {
    const box = $g('gvLShots'); let html = '', lastChap = -1;
    SHOTS.forEach((s, i) => {
      const ci = chapterAt(s.t0 + 0.01); if (ci !== lastChap) { lastChap = ci; html += `<div class="chead" style="--cc:${GV_CHAP_COL[ci]}">Chapter ${CHAPTERS[ci].num} · ${CHAPTERS[ci].name}</div>`; }
      const th = gv.thumbs[i]; if (th && !thumbURL[i]) thumbURL[i] = th.toDataURL('image/jpeg', 0.72);
      html += `<div class="srow" data-shot="${i}"><div class="th" ${thumbURL[i] ? `style="background-image:url(${thumbURL[i]})"` : ''}>${thumbURL[i] ? '' : 'S' + (i + 1)}</div><div class="tx"><div class="nm">S${i + 1} · ${gvEsc(gvShotTitle(s.t0, i))}</div><div class="sb">${gvFmt(s.t0)} · ${(s.t1 - s.t0).toFixed(1)} s · ${GV_SET_NAMES[setAt(s.t0)]}</div></div>${gv.ov[s.t0] ? '<span class="ed" title="Camera edited">✎</span>' : ''}${gv.grade.vals && gv.grade.vals.shots && gv.grade.vals.shots[s.t0] ? '<span class="ed" title="Own colour grade">◐</span>' : ''}${gv.notes[s.t0] ? '<span class="ed" title="Has a note">¶</span>' : ''}</div>`;
    });
    const top = box.scrollTop; box.innerHTML = html; box.scrollTop = top; lastShotRow = -1; applyShotFilter();
  }
  function markShotRows() {
    const rows = $g('gvLShots').querySelectorAll('.srow'); let act = null;
    rows.forEach((r) => { const on = +r.dataset.shot === gv.sel; r.classList.toggle('on', on); if (on) act = r; });
    if (act) { const box = $g('gvLShots'); if (!box.matches(':hover')) { const y = act.offsetTop - box.clientHeight / 2 + act.offsetHeight / 2; box.scrollTop += (y - box.scrollTop) * 0.35; } }
  }
  function renderBeatRows() {
    let html = '', lastChap = -1;
    BEATS.forEach((b, i) => { const ci = chapterAt(b.t0 + 0.01); if (ci !== lastChap) { lastChap = ci; html += `<div class="chead" style="--cc:${GV_CHAP_COL[ci]}">Chapter ${CHAPTERS[ci].num} · ${CHAPTERS[ci].name}</div>`; } html += `<div class="brow" data-beat="${i}"><span class="t">${gvFmt(b.t0)}</span><span>${gvEsc(b.name)}</span></div>`; });
    $g('gvLBeats').innerHTML = html;
  }
  function markBeatRows(bi) {
    let act = null; $g('gvLBeats').querySelectorAll('.brow').forEach((r) => { const on = +r.dataset.beat === bi; r.classList.toggle('on', on); if (on) act = r; });
    const b = BEATS[bi], note = $g('gvBeatNote');
    note.innerHTML = `<b>${gvEsc(b.name)} · ${gvFmt(b.t0)}–${gvFmt(b.t1)}</b>${gvEsc(b.text)}<div class="pr">${b.p.map((p) => `<span>${gvEsc((PRINCIPLES.find((x) => x[0] === p) || [0, p])[1])}</span>`).join('')}</div>`;
    if (act) { const box = $g('gvLBeats'); if (!box.matches(':hover')) { const y = act.offsetTop - box.clientHeight / 2; box.scrollTop += (y - box.scrollTop) * 0.35; } }
  }
  $g('gvLShots').addEventListener('click', (e) => {
    const r = e.target.closest('.srow'); if (!r) return; const i = +r.dataset.shot;
    if (e.ctrlKey || e.metaKey) { if (!gv.multi.size) gv.multi.add(gv.sel); if (gv.multi.has(i) && gv.multi.size > 1) gv.multi.delete(i); else gv.multi.add(i); gv.pinned = false; gv.editOn = false; if (gv.multi.has(i)) selectShot(i, false); else selectShot([...gv.multi][0], false); markMulti(); return; }
    if (e.shiftKey) { const a = gv.sel, lo = Math.min(a, i), hi = Math.max(a, i); gv.multi = new Set(); for (let n = lo; n <= hi; n++) gv.multi.add(n); markMulti(); return; }
    if (gv.multi.size) { gv.multi.clear(); markMulti(); }
    gv.pinned = false; gv.editOn = false; selectShot(+r.dataset.shot, true); if (innerWidth <= 900) $g('gv').classList.remove('openL'); });
  $g('gvLBeats').addEventListener('click', (e) => { const r = e.target.closest('.brow'); if (r) { seekTo(BEATS[+r.dataset.beat].t0); setPlaying(false); } });
  document.querySelectorAll('#gvLTabs button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('#gvLTabs button').forEach((x) => x.classList.toggle('on', x === b));
    $g('gvLShots').classList.toggle('hidden', b.dataset.ltab !== 'shots'); $g('gvLBeats').classList.toggle('hidden', b.dataset.ltab !== 'beats'); $g('gvLMarkers').classList.toggle('hidden', b.dataset.ltab !== 'markers'); $g('gvLView').classList.toggle('hidden', b.dataset.ltab !== 'view'); $g('gvBeatNote').classList.toggle('hidden', b.dataset.ltab !== 'beats'); $g('gvLFilter').classList.toggle('hidden', b.dataset.ltab !== 'shots');
  });

  /* inspector: shot tab */
  const num = (v, d = 2) => (typeof v === 'number' ? +v.toFixed(d) : 0);
  function renderInspector() {
    const i = gv.sel, s = SHOTS[i], ov = gv.ov[s.t0], box = $g('gvIShot'), note = GV_SHOT_NOTES[s.t0];
    const drift = s.base?.drift || DRIFT.get(s.t0), hand = HANDHELD.get(s.t0);
    let h = `<div class="shead"><h3>S${i + 1} · ${gvEsc(gvShotTitle(s.t0, i))}</h3><span class="m">${gvFmtF(s.t0)}–${gvFmtF(s.t1)} · ${shotDur(i).toFixed(1)} s</span></div>`;
    const desc = note && note.split(/\s+[—-]\s+/).length > 1 ? note.split(/\s+[—-]\s+/).slice(1).join(' — ') : '';
    h += `<div class="snote">${gvEsc(desc || 'Authored in code. Its camera follows the action with springs and a slow move.')}</div>`;
    h += `<div class="btns"><button class="btn pri" id="iEdit">${ov ? (gv.editOn ? 'Editing…' : 'Edit camera') : 'Edit camera'}</button><button class="btn" id="iFrame">Frame</button><button class="btn" id="iStart">Start</button>${ov ? '<button class="btn warn" id="iReset">Reset to authored</button>' : ''}</div>`;
    if (!ov) {
      h += `<div class="note">This shot is driven by code: it reads the robot's position, adds spring smoothing and a slow move${drift ? ` (drift ${gvEsc(Object.entries(drift).map(([k, v]) => k + ' ' + JSON.stringify(v)).join(', '))})` : ''}${hand ? `, plus handheld sway (${hand[0]})` : ''}. <b>Edit camera</b> bakes it into ${shotDur(i) > 2.5 ? '3' : '2'} keyframes you can move with the gizmos or the numbers below.</div>`;
    } else {
      const k = ov.keys[gv.selKey] || ov.keys[0], pf = ov.rel ? 'Offset from robot' : 'World position';
      h += `<label class="chk"><input type="checkbox" id="iRel" ${ov.rel ? 'checked' : ''}> Follow the robot (keys are offsets from it)</label>`;
      h += `<div class="rg mo"><label for="iEase">Motion</label><select class="sel" id="iEase">${[['smooth', 'Smooth (default)'], ['linear', 'Linear, constant speed'], ['in', 'Ease in (starts slow)'], ['out', 'Ease out (ends slow)'], ['slow', 'Slow, fast, slow']].map(([v, l]) => `<option value="${v}" ${(ov.ease || 'smooth') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span></span></div>`;
      h += `<div class="rg mo"><label for="iAim">Looks at</label><select class="sel" id="iAim">${[['world', 'A fixed point'], ['robot', 'The robot (follows it)'], ['ember', 'Ember (follows her)']].map(([v, l]) => `<option value="${v}" ${aimOf(ov) === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span></span></div>`;
      h += `<div class="sect">Keyframes <span class="hint">${ov.keys.length} · K adds one at the playhead</span></div><div class="keys">${ov.keys.map((kk, n) => `<button data-key="${n}" class="${n === gv.selKey ? 'on' : ''}">${n + 1} · ${Math.round(kk.u * 100)}%</button>`).join('')}</div>`;
      h += `<div class="btns"><button class="btn sm" id="iAddKey">+ Key at playhead</button><button class="btn sm" id="iDupKey" title="Copy this key to halfway to the next one">Duplicate key</button><button class="btn sm warn" id="iDelKey" ${ov.keys.length <= 1 ? 'disabled' : ''}>Delete key</button><button class="btn sm" id="iGoKey">Go to key</button></div>`;
      h += `<div class="sect">${pf}</div><div class="xyz"><label>Camera</label>${['px', 'py', 'pz'].map((f, n) => `<input class="num" data-f="${f}" type="number" step="0.05" value="${num(k.pos[n])}">`).join('')}</div>`;
      h += `<div class="xyz"><label>Aim</label>${['tx', 'ty', 'tz'].map((f, n) => `<input class="num" data-f="${f}" type="number" step="0.05" value="${num(k.target[n])}">`).join('')}</div>`;
      h += `<div class="rg mo"><label for="kEase">Into next key</label><select class="sel" id="kEase" ${gv.selKey >= ov.keys.length - 1 ? 'disabled' : ''}>${[['', 'Motion setting (default)'], ['smooth', 'Smooth'], ['linear', 'Linear, constant speed'], ['in', 'Ease in'], ['out', 'Ease out'], ['slow', 'Slow, fast, slow'], ['hold', 'Hold, then cut to the next']].map(([v, l]) => `<option value="${v}" ${(k.ease || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span></span></div>`;
      h += `<div class="rg"><label for="kFov">Lens</label><input type="range" id="kFov" data-f="fov" min="12" max="90" step="0.5" value="${num(k.fov, 1)}"><output id="kFovV">${num(k.fov, 0)}° · ${(12 / Math.tan(THREE.MathUtils.degToRad(k.fov / 2))).toFixed(0)} mm</output></div>`;
      h += `<div class="lenses">${LENSES.map((mm) => `<button class="chipbtn" data-mm="${mm}" title="${mm} mm lens">${mm}</button>`).join('')}<span>mm</span></div>`;
      h += `<div class="rg"><label for="kRoll">Dutch</label><input type="range" id="kRoll" data-f="roll" min="-15" max="15" step="0.25" value="${num((k.roll || 0) * 57.2958, 2)}"><output id="kRollV">${num((k.roll || 0) * 57.2958, 1)}°</output></div>`;
      h += `<div class="rg"><label for="kShake">Shake</label><input type="range" id="kShake" data-f="shake" min="0" max="1" step="0.01" value="${num(k.shake ?? 0.15)}"><output id="kShakeV">${num(k.shake ?? 0.15)}</output></div>`;
      if (gv.selKey > 0 && gv.selKey < ov.keys.length - 1) h += `<div class="rg"><label for="kU">Time</label><input type="range" id="kU" data-f="u" min="0" max="100" step="1" value="${Math.round(k.u * 100)}"><output id="kUV">${Math.round(k.u * 100)}%</output></div>`;
      h += `<div class="sect">Whole move</div><div class="xyz"><label>Shift all</label>${['sx', 'sy', 'sz'].map((f) => `<input class="num" id="i${f}" type="number" step="0.1" value="0">`).join('')}</div><div class="btns"><button class="btn sm" id="iShift">Shift camera and aim</button><button class="btn sm" id="iReverse" title="Play the move backwards">Reverse move</button><button class="btn sm" id="iLevel" title="Remove the dutch tilt from every key">Level horizon</button></div>`;
      h += `<div class="sect">Aim helpers</div><div class="btns"><button class="btn sm" id="iFromGod">Camera = god view</button><button class="btn sm" id="iFocusGod">Look at = god focus</button><button class="btn sm" id="iLookRobot">Look at robot</button><button class="btn sm" id="iLookEmber">Look at Ember</button></div>`;
      h += `<div class="note edit">${ov.rel ? 'This shot follows the robot.' : 'Fixed world positions: the camera will not follow the robot unless you tick Follow.'} ${gv.editOn ? 'Drag the amber gizmo for the camera and the pink one for what it looks at.' : 'Press Edit camera to show the gizmos.'}</div>`;
      h += `<div class="btns"><button class="btn" id="iDone">${gv.editOn ? 'Done editing' : 'Show gizmos'}</button></div>`;
    }
    h += `<div class="sect">Notes</div><textarea class="notebox" id="iNote" placeholder="Director's notes for this shot…" spellcheck="true">${gvEsc(gv.notes[s.t0] || '')}</textarea>`;
    h += `<div class="btns"><button class="btn sm" id="iCopyCam" ${ov ? '' : 'disabled'} title="Ctrl+C">Copy camera</button><button class="btn sm" id="iPasteCam" ${gv.clip.cam ? '' : 'disabled'} title="Ctrl+V">Paste camera</button></div>`;
    const top = box.scrollTop; box.innerHTML = h; box.scrollTop = top;
  }
  function syncKeyFields() {
    const ov = gv.ov[SHOTS[gv.sel].t0], k = ov?.keys[gv.selKey]; if (!k) return; const box = $g('gvIShot');
    ['px', 'py', 'pz'].forEach((f, n) => { const el = box.querySelector(`[data-f=${f}]`); if (el && document.activeElement !== el) el.value = num(k.pos[n]); });
    ['tx', 'ty', 'tz'].forEach((f, n) => { const el = box.querySelector(`[data-f=${f}]`); if (el && document.activeElement !== el) el.value = num(k.target[n]); });
  }
  const insp = $g('gvIShot');
  insp.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return; const i = gv.sel;
    if (t.dataset.key !== undefined) return selectKey(+t.dataset.key, true);
    if (t.dataset.mm) { const kk = gv.ov[SHOTS[i].t0]?.keys[gv.selKey]; if (kk) { kk.fov = mmToFov(+t.dataset.mm); applyOv(i); saveEdits(); resampleShot(i); renderInspector(); rebuildEdit(); } return; }
    const ov = gv.ov[SHOTS[i].t0], k = ov?.keys[gv.selKey];
    switch (t.id) {
      case 'iEdit': enterEdit(i); rebuildEdit(); frameShot(i); break;
      case 'iFrame': frameShot(i); break;
      case 'iStart': seekTo(SHOTS[i].t0 + 0.05); setPlaying(false); break;
      case 'iReset': resetShot(i); break;
      case 'iCopyCam': copyCam(); break;
      case 'iPasteCam': pasteCam(); break;
      case 'iDone': if (gv.editOn) exitEdit(); else { gv.editOn = true; gv.pinned = true; renderInspector(); } rebuildEdit(); break;
      case 'iAddKey': addKeyHere(); rebuildEdit(); break;
      case 'iDupKey': editKeys((o) => { const n = gv.selKey, a = o.keys[n], b = o.keys[n + 1] || o.keys[n - 1]; if (!b) return; const c = clone(a); c.u = round3((a.u + b.u) / 2); if (Math.abs(c.u - a.u) < 0.01) c.u = round3(a.u + 0.02); delete c.ease; o.keys.push(c); o.keys.sort((p, q) => p.u - q.u); gv.selKey = o.keys.indexOf(c); }); break;
      case 'iShift': { const d = ['isx', 'isy', 'isz'].map((id) => parseFloat($g(id).value) || 0); if (d.some((x) => x)) editKeys((o) => o.keys.forEach((kk) => { for (let n = 0; n < 3; n++) { kk.pos[n] = round3(kk.pos[n] + d[n]); kk.target[n] = round3(kk.target[n] + d[n]); } })); break; }
      case 'iReverse': editKeys((o) => { o.keys.forEach((kk) => { kk.u = round3(1 - kk.u); }); o.keys.reverse(); o.keys.forEach((kk) => { delete kk.ease; }); gv.selKey = clamp(o.keys.length - 1 - gv.selKey, 0, o.keys.length - 1); }); break;
      case 'iLevel': editKeys((o) => o.keys.forEach((kk) => { kk.roll = 0; })); break;
      case 'iDelKey': deleteKey(); rebuildEdit(); break;
      case 'iGoKey': if (k) { seekTo(keyT(i, k.u)); setPlaying(false); } break;
      case 'iFromGod': if (k) { setKeyWorld(i, k, camera.position, null); k.pos = k.pos.map(round3); applyOv(i); saveEdits(); resampleShot(i); renderInspector(); rebuildEdit(); } break;
      case 'iFocusGod': if (k) { setKeyWorld(i, k, null, controls.target); k.target = k.target.map(round3); applyOv(i); saveEdits(); resampleShot(i); renderInspector(); rebuildEdit(); } break;
      case 'iLookRobot': if (k) { keyRoot(i, k, _tmp); _tmp.y += 0.4; setKeyWorld(i, k, null, _tmp); k.target = k.target.map(round3); applyOv(i); saveEdits(); resampleShot(i); renderInspector(); rebuildEdit(); } break;
      case 'iLookEmber': if (k) { lureAt(sampleAt(shotT(i, k.u)), _tmp); setKeyWorld(i, k, null, _tmp); k.target = k.target.map(round3); applyOv(i); saveEdits(); resampleShot(i); renderInspector(); rebuildEdit(); } break;
      default:
    }
  });
  insp.addEventListener('input', (e) => {
    const el = e.target, f = el.dataset.f, i = gv.sel, ov = gv.ov[SHOTS[i].t0], k = ov?.keys[gv.selKey];
    if (el.id === 'iRel') return toggleRel(el.checked), rebuildEdit();
    if (el.id === 'iNote') { const t0 = SHOTS[i].t0; if (el.value.trim()) gv.notes[t0] = el.value; else delete gv.notes[t0]; saveEdits(); return; }
    if (el.id === 'iAim') return setAim(el.value);
    if (el.id === 'kEase') { if (k) { if (el.value) k.ease = el.value; else delete k.ease; applyOv(i); saveEdits(); resampleShot(i); renderExport(); } return; }
    if (el.id === 'iEase') { if (ov) { if (el.value === 'smooth') delete ov.ease; else ov.ease = el.value; applyOv(i); saveEdits(); resampleShot(i); renderExport(); } return; }
    if (!f || !k) return;
    const v = parseFloat(el.value); if (Number.isNaN(v)) return;
    if (f === 'px') k.pos[0] = v; else if (f === 'py') k.pos[1] = v; else if (f === 'pz') k.pos[2] = v;
    else if (f === 'tx') k.target[0] = v; else if (f === 'ty') k.target[1] = v; else if (f === 'tz') k.target[2] = v;
    else if (f === 'fov') { k.fov = v; $g('kFovV').textContent = `${v.toFixed(0)}° · ${(12 / Math.tan(THREE.MathUtils.degToRad(v / 2))).toFixed(0)} mm`; }
    else if (f === 'roll') { k.roll = v / 57.2958; $g('kRollV').textContent = `${v.toFixed(1)}°`; }
    else if (f === 'shake') { k.shake = v; $g('kShakeV').textContent = v.toFixed(2); }
    else if (f === 'u') { moveKeyU(gv.selKey, v / 100); $g('kUV').textContent = `${v}%`; }
    applyOv(i); saveEdits(); rebuildEdit();
  });
  insp.addEventListener('change', (e) => { if (e.target.dataset.f) { resampleShot(gv.sel); renderInspector(); } else if (e.target.id === 'iNote') { renderShotRows(); } });
  insp.addEventListener('keydown', (e) => { if (e.target.id === 'iNote') e.stopPropagation(); });

  /* inspector: colour grade tab */
  const GRADE_GROUPS = [
    ['Light', [['exposure', 'Exposure', 0.3, 3, 0.01, 1], ['bloom', 'Bloom', 0, 3, 0.01, 1], ['gamma', 'Gamma', 0.5, 2, 0.01, 1], ['contrast', 'Contrast', 0.3, 2.2, 0.01, 1], ['pivot', 'Contrast pivot', 0.05, 0.6, 0.01, 0.18], ['shadows', 'Shadows', -0.6, 0.6, 0.01, 0], ['highlights', 'Highlights', -0.6, 0.6, 0.01, 0], ['lift', 'Black lift', 0, 0.08, 0.001, 0.004], ['matte', 'Matte fade', 0, 0.4, 0.005, 0]]],
    ['Colour', [['sat', 'Saturation', 0, 2.5, 0.01, 1], ['vibrance', 'Vibrance', -1, 1, 0.01, 0], ['warm', 'Warm highlights', 0, 2, 0.01, 1], ['temp', 'Temperature', -1, 1, 0.01, 0], ['tint', 'Tint', -1, 1, 0.01, 0], ['hue', 'Hue shift', -180, 180, 1, 0]]],
    ['Texture', [['grain', 'Grain', 0, 3, 0.01, 1], ['grainSize', 'Grain size', 0.5, 4, 0.05, 1], ['sharpen', 'Sharpen', 0, 1.5, 0.01, 0], ['halation', 'Halation', 0, 1.5, 0.01, 0], ['streak', 'Light streaks', 0, 1.5, 0.01, 0], ['aberr', 'Colour fringe', 0, 6, 0.05, 1]]],
    ['Frame', [['vig', 'Vignette', 0, 2.2, 0.01, 1], ['vigSoft', 'Vignette softness', 0.3, 2, 0.01, 1], ['vigAmt', 'Vignette depth', 0, 0.9, 0.01, 0.28], ['letterbox', 'Letterbox bars', 0, 0.2, 0.002, 0]]],
  ];
  const GRADE_DEFS = {}; GRADE_GROUPS.forEach(([, rows]) => rows.forEach((r) => { GRADE_DEFS[r[0]] = r; }));
  GRADE_DEFS.lutAmount = ['lutAmount', 'LUT strength', 0, 1, 0.01, 1];
  const gdec = (k) => (GRADE_DEFS[k][4] < 0.01 ? 3 : GRADE_DEFS[k][4] < 1 ? 2 : 0);
  const tintHex = (v) => '#' + v.map((c) => Math.round(clamp(c - 0.5, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  const hexTint = (h) => [1, 3, 5].map((n) => 0.5 + parseInt(h.slice(n, n + 2), 16) / 255);
  const shotKey = () => String(SHOTS[gv.sel].t0);
  const shotGradeAt = (i, make) => { if (!G.vals.shots) { if (!make) return null; G.vals.shots = {}; } const k = String(SHOTS[i].t0); if (!G.vals.shots[k] && make) G.vals.shots[k] = {}; return G.vals.shots[k] || null; };
  const shotGrade = (make) => shotGradeAt(gv.sel, make);
  // scopes: "film" edits the film grade, "shot" this shot's own values, "end" the values the shot eases to by its last frame
  const gtAt = (i, make) => { if (G.scope === 'end') { const o = shotGradeAt(i, make); if (!o) return null; if (!o.to && make) o.to = {}; return o.to || null; } return G.scope === 'shot' ? shotGradeAt(i, make) : null; };
  const gtg = (make) => gtAt(gv.sel, make);
  const gTargets = () => (gv.multi.size > 1 && gv.multi.has(gv.sel) ? [...gv.multi].sort((p, q) => p - q) : [gv.sel]); // shots selected together are graded together
  const gVal = (k) => { const o = gtg(false); if (o && o[k] !== undefined) return o[k]; if (G.scope === 'end') { const s0 = shotGrade(false); if (s0 && s0[k] !== undefined) return s0[k]; } return G.vals[k] ?? GRADE_NEUTRAL[k] ?? (GRADE_PRESETS.default[k]); };
  const gIsOv = (k) => { const o = gtg(false); return !!(o && o[k] !== undefined); };
  function gSet(k, v) { if (G.scope !== 'film') gTargets().forEach((i) => { gtAt(i, true)[k] = v; }); else G.vals[k] = v; }
  function gDrop(k) { gTargets().forEach((i) => { const o = gtAt(i, false); if (o) delete o[k]; const so = shotGradeAt(i, false); if (so) { if (so.to && !Object.keys(so.to).length) delete so.to; if (!Object.keys(so).length) delete G.vals.shots[String(SHOTS[i].t0)]; } }); }
  const shotsGraded = () => Object.keys(G.vals.shots || {}).filter((k) => Object.keys(G.vals.shots[k]).length);
  function renderGrade() {
    const names = Object.entries(gradeNames).filter(([k]) => k !== 'gvcustom'), sc = G.scope !== 'film', en = G.scope === 'end', i = gv.sel;
    let h = `<div class="note">Applies to the director's-cut monitor and the thumbnails, on top of the film's own chapter colour script. Everything here is baked into the film on export. ${G.touched ? '<b>Edited.</b>' : ''}</div>`;
    h += `<div class="seg" id="gScope"><button data-scope="film" class="${sc ? '' : 'on'}">Whole film</button><button data-scope="shot" class="${G.scope === 'shot' ? 'on' : ''}">S${i + 1} only${shotGrade(false) && Object.keys(shotGrade(false)).filter((x) => x !== 'to').length ? ' ●' : ''}</button><button data-scope="end" class="${en ? 'on' : ''}" title="Animate the grade across this shot: set where it ends up">S${i + 1} → end${shotGrade(false) && shotGrade(false).to && Object.keys(shotGrade(false).to).length ? ' ●' : ''}</button></div>`;
    h += en ? `<div class="note edit">You are setting where the grade <b>ends up</b> by the last frame of S${i + 1}. It eases there from the shot's own look (set under "S${i + 1} only"). Rows you leave alone stay constant. ↺ drops a value.</div>` : sc ? `<div class="note edit">Changes you make now only affect shot S${i + 1}${gTargets().length > 1 ? ` and the ${gTargets().length - 1} other selected shot${gTargets().length > 2 ? 's' : ''}` : ''}. A highlighted row differs from the film grade; its ↺ puts it back. ${shotsGraded().length ? `${shotsGraded().length} shot${shotsGraded().length === 1 ? '' : 's'} have their own grade.` : ''}</div>` : '';
    if (!sc) {
      h += `<div class="sect">Look</div><select class="sel" id="gBase">${names.map(([k, v]) => `<option value="${k}" ${k === G.base ? 'selected' : ''}>${gvEsc(v)}</option>`).join('')}</select>`;
      const looks = readLooks(), ln = Object.keys(looks);
      h += `<div class="btns"><button class="btn sm" id="gLookSave">Save as my look…</button>${ln.length ? `<select class="sel" id="gLookPick" style="flex:1;min-width:0"><option value="">My looks…</option>${ln.map((n) => `<option value="${gvEsc(n)}">${gvEsc(n)}</option>`).join('')}</select><button class="btn sm warn" id="gLookDel" title="Delete the look shown in the list">Delete</button>` : ''}</div>`;
      h += `<label class="chk"><input type="checkbox" id="gBypass" ${G.bypass ? 'checked' : ''}> Bypass grade (compare with the original)</label><label class="chk"><input type="checkbox" id="gGod" ${G.applyGod ? 'checked' : ''}> Also apply to the god view</label>`;
    }
    const row = ([k, l, a, b, st, def]) => {
      const v = gVal(k), d = gdec(k), ov = gIsOv(k); a = Math.min(a, v); b = Math.max(b, v); // a typed value beyond the slider widens it
      return `<div class="rg ${ov ? 'ov' : ''}"><label title="${k}: double-click to reset">${l}</label><input type="range" data-gv="${k}" min="${a}" max="${b}" step="${st}" value="${v}"><output>${(+v).toFixed(d)}</output>${sc ? `<button class="gundo" data-undo="${k}" title="Use the film value" ${ov ? '' : 'disabled'}>↺</button>` : ''}</div>`;
    };
    h += GRADE_GROUPS.map(([title, rows]) => `<div class="sect">${title}</div>` + rows.map(row).join('')).join('');
    const lut = G.vals.lut;
    h += `<div class="sect">Colour LUT <span class="hint">.cube, 3D or 1D</span></div>`;
    if (lut) h += `<div class="lutrow"><b title="${gvEsc(lut.name)}">${gvEsc(lut.name)}</b><span>${lut.n}³</span>${sc ? '' : '<button class="btn sm warn" id="gLutRm">Remove</button>'}</div>${row(GRADE_DEFS.lutAmount)}`;
    else h += `<div class="note">Import a look from your colourist or a LUT pack. It runs after the grade, on the final image, and is baked into the film on export.</div>`;
    if (!sc) h += `<div class="btns"><button class="btn" id="gLutImport">${lut ? 'Replace LUT…' : 'Import LUT (.cube)…'}</button></div>`;
    h += `<div class="sect">Tint</div>` + [['sh', 'Shadows'], ['mid', 'Midtones'], ['hi', 'Highlights']].map(([k, l]) => { const o = sc ? gtg(false) : null, ov = !!(o && o[k]), s0 = en ? shotGrade(false) : null; return `<div class="tint ${ov ? 'ov' : ''}"><label>${l}</label><div class="cols"><input type="color" data-gt="${k}" value="${tintHex(ov ? o[k] : s0 && s0[k] ? s0[k] : G.vals[k])}">${sc ? `<button class="gundo" data-undo="${k}" title="Use the film value" ${ov ? '' : 'disabled'}>↺</button>` : ''}</div></div>`; }).join('');
    if (sc) h += `<div class="btns"><button class="btn sm" id="gCopy" title="Ctrl+Shift+C">Copy shot grade</button><button class="btn sm" id="gPaste" ${gv.clip.grade ? '' : 'disabled'} title="Ctrl+Shift+V">Paste</button><button class="btn sm" id="gPasteChap" ${gv.clip.grade ? '' : 'disabled'}>Paste to chapter</button></div>`;
    h += `<div class="btns">${sc ? `<button class="btn" id="gShotReset" ${shotGrade(false) && Object.keys(shotGrade(false)).length ? '' : 'disabled'}>Reset S${i + 1}'s grade</button>` : `<button class="btn" id="gReset">Reset to ${gvEsc(gradeNames[G.base] || G.base)}</button>`}${shotsGraded().length ? '<button class="btn warn" id="gShotsClear">Clear all shot grades</button>' : ''}</div>`;
    const box = $g('gvIGrade'), top = box.scrollTop; box.innerHTML = h; box.scrollTop = top;
  }
  gv.renderGrade = renderGrade;
  const gradeBox = $g('gvIGrade');
  const gradeChanged = () => { G.touched = true; pv.dirty = true; saveGrade(); renderExport(); };
  gradeBox.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.gv) {
      const k = el.dataset.gv, v = parseFloat(el.value); gSet(k, v); el.nextElementSibling.textContent = v.toFixed(gdec(k));
      const row = el.closest('.rg'); if (G.scope !== 'film' && row) { row.classList.add('ov'); const u = row.querySelector('.gundo'); if (u) u.disabled = false; }
      gradeChanged();
    } else if (el.dataset.gt) {
      const k = el.dataset.gt, v = hexTint(el.value); gSet(k, v);
      const row = el.closest('.tint'); if (G.scope !== 'film' && row) { row.classList.add('ov'); const u = row.querySelector('.gundo'); if (u) u.disabled = false; }
      gradeChanged();
    } else if (el.id === 'gBypass') { G.bypass = el.checked; pv.dirty = true; saveGrade(); renderExport(); }
    else if (el.id === 'gGod') { G.applyGod = el.checked; pv.dirty = true; saveGrade(); renderExport(); }
  });
  gradeBox.addEventListener('change', (e) => {
    if (e.target.id === 'gLookPick') { const l = readLooks()[e.target.value]; if (l) { const shots = G.vals.shots; setVals(clone(l)); if (shots) G.vals.shots = shots; gradeChanged(); renderGrade(); gvToast('Look applied'); } return; }
    if (e.target.id === 'gBase') { const shots = G.vals.shots; G.base = e.target.value; setVals(gradeDefaults()); if (shots) G.vals.shots = shots; G.touched = G.base !== 'default' || !!shots; pv.dirty = true; saveGrade(); renderGrade(); renderExport(); }
  });
  gradeBox.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.scope) { G.scope = t.dataset.scope; renderGrade(); return; }
    if (t.id === 'gLutImport') { $g('gvLutIn').click(); return; }
    if (t.id === 'gLutRm') { delete G.vals.lut; gradeChanged(); renderGrade(); gvToast('LUT removed'); return; }
    if (t.id === 'gCopy') return copyGrade(); if (t.id === 'gPaste') return pasteGrade(false); if (t.id === 'gPasteChap') return pasteGrade(true);
    if (t.id === 'gLookSave') return saveLook();
    if (t.id === 'gLookDel') { const sel = $g('gLookPick'); if (sel && sel.value) { const l = readLooks(); delete l[sel.value]; writeLooks(l); renderGrade(); gvToast('Look deleted'); } return; }
    if (t.dataset.undo) { gDrop(t.dataset.undo); gradeChanged(); renderGrade(); renderShotRows(); return; }
    if (t.id === 'gShotReset') { if (G.vals.shots) gTargets().forEach((i) => { delete G.vals.shots[String(SHOTS[i].t0)]; }); gradeChanged(); renderGrade(); renderShotRows(); }
    else if (t.id === 'gShotsClear') { delete G.vals.shots; gradeChanged(); renderGrade(); renderShotRows(); }
    else if (t.id === 'gReset') { setVals(gradeDefaults()); G.touched = false; pv.dirty = true; saveGrade(); renderGrade(); renderExport(); }
  });

  /* inspector: export tab */
  const editsJSON = () => JSON.stringify({ version: 1, name: curProject()?.name, overrides: gv.ov, ...(Object.keys(gv.notes).length ? { notes: gv.notes } : {}), ...(gv.markers.length ? { markers: gv.markers } : {}), ...(G.touched ? { grade: G.vals } : {}) }, null, 1);
  function renderExport() {
    const keys = Object.keys(gv.ov);
    let h = `<div class="note">Your work autosaves as a draft in this browser. Press Save project (top bar) to keep it under Custom projects, or export a file to bake it into the film itself.</div><div class="sect">Edited shots <span class="hint">${keys.length}</span></div>`;
    h += keys.length ? keys.map((t0) => { const idx = SHOTS.findIndex((s) => s.t0 === +t0); return `<div class="srow" data-goshot="${idx}"><div class="tx"><div class="nm">S${idx + 1} · ${gvEsc(gvShotTitle(+t0, idx))}</div><div class="sb">${gv.ov[t0].keys.length} keys${gv.ov[t0].rel ? ' · follows robot' : ''}</div></div><button class="btn sm warn" data-rm="${idx}">Reset</button></div>`; }).join('') : '<div class="note">No camera edits yet. Pick a shot and press Edit camera.</div>';
    h += `<div class="sect">Colour grade</div><div class="note">${G.touched ? `Custom grade based on ${gvEsc(gradeNames[G.base] || G.base)} will be exported.` : 'Unchanged, nothing to export.'}</div>`;
    h += `<div class="btns"><button class="btn pri" id="xDown">Download edits.json</button><button class="btn" id="xCopy">Copy JSON</button></div><div class="sect">Import</div><textarea class="num" id="xText" placeholder="Paste exported JSON here"></textarea><div class="btns"><button class="btn" id="xImport">Import pasted JSON</button><button class="btn warn" id="xClear">Clear all edits</button></div><div class="note">To bake into the film: <code>node tools/apply-overrides.cjs edits.json</code> then <code>npm run build:godview</code>.</div><div id="xMsg" class="lens"></div>`;
    $g('gvIExport').innerHTML = h;
  }
  const xbox = $g('gvIExport');
  xbox.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); const row = e.target.closest('[data-goshot]'); const msg = (m) => { const x = $g('xMsg'); if (x) x.textContent = m; };
    if (t?.dataset.rm !== undefined) { selectShot(+t.dataset.rm, false); resetShot(+t.dataset.rm); return; }
    if (row && !t) { gv.pinned = false; selectShot(+row.dataset.goshot, true); return; }
    if (!t) return;
    if (t.id === 'xDown') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([editsJSON()], { type: 'application/json' })); a.download = 'clockwork-edits.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); msg('Downloaded.'); }
    else if (t.id === 'xCopy') { try { await navigator.clipboard.writeText(editsJSON()); msg('Copied to the clipboard.'); } catch (err) { $g('xText').value = editsJSON(); $g('xText').select(); msg('Clipboard blocked: the JSON is in the box, copy it from there.'); } }
    else if (t.id === 'xImport') {
      try {
        const d = JSON.parse($g('xText').value); if (!d.overrides) throw new Error('no overrides in this JSON');
        for (const t0 of Object.keys(gv.ov)) { delete gv.ov[t0]; applyShotOverride(+t0, null); }
        for (const [t0, ov] of Object.entries(d.overrides)) { gv.ov[t0] = ov; applyShotOverride(+t0, ov); }
        if (d.grade) { setVals(d.grade); G.touched = true; renderGrade(); }
        saveEdits(); saveGrade(); await resampleAll(); msg(`Imported ${Object.keys(gv.ov).length} shot edit(s).`);
      } catch (err) { msg('Could not import: ' + err.message); }
    } else if (t.id === 'xClear') { for (const t0 of Object.keys(gv.ov)) { delete gv.ov[t0]; applyShotOverride(+t0, null); } saveEdits(); gv.editOn = false; gv.pinned = false; await resampleAll(); msg('Cleared.'); }
  });
  async function resampleAll() {
    const T0 = st.T, was = st.playing; sampleRange(0, FILM); seekTo(T0); setPlaying(was); computeBounds();
    SHOTS.forEach((_, i) => buildShotGlyph(i)); for (const set of Object.keys(GV_RANGES)) buildCamPath(set);
    buildSelPath(); rebuildEdit(); renderShotRows(); renderInspector(); renderExport(); pv.dirty = true; gv.dirty = true;
  }
  document.querySelectorAll('#gvITabs button').forEach((b) => b.onclick = () => {
    document.querySelectorAll('#gvITabs button').forEach((x) => x.classList.toggle('on', x === b));
    for (const [t, id] of [['shot', 'gvIShot'], ['grade', 'gvIGrade'], ['versions', 'gvIVers'], ['export', 'gvIExport']]) $g(id).classList.toggle('hidden', b.dataset.itab !== t);
    if (b.dataset.itab === 'versions' && gv.renderVersions) gv.renderVersions();
  });

  /* ---------- 8. controls: toolbar, view options, pointer, keyboard, map ---------- */
  const syncChecks = () => { $g('gvTrackBtn').classList.toggle('on', state.follow); $g('gvFollow').checked = state.follow; $g('gvClipBtn').classList.toggle('on', state.clipOn); $g('gvClipOn').checked = state.clipOn; };
  document.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => { state.auto = false; $g('gvAuto').checked = false; setSet(b.dataset.set); rebuildEdit(); });
  document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => setView(b.dataset.view));
  $g('gvFrame').onclick = () => setView(curView); $g('gvFocus').onclick = () => frameShot(gv.sel);
  $g('gvAuto').onchange = (e) => { state.auto = e.target.checked; };
  $g('gvFollow').onchange = (e) => { state.follow = e.target.checked; syncChecks(); };
  $g('gvTrackBtn').onclick = () => { state.follow = !state.follow; syncChecks(); };
  $g('gvClipBtn').onclick = () => { state.clipOn = !state.clipOn; syncChecks(); };
  $g('gvFog').onchange = (e) => { state.fogOff = e.target.checked; };
  $g('gvClipOn').onchange = (e) => { state.clipOn = e.target.checked; syncChecks(); };
  $g('gvClipY').oninput = (e) => { state.clipY = +e.target.value; $g('gvClipV').textContent = state.clipY + ' m'; };
  $g('gvExp').oninput = (e) => { state.exposure = +e.target.value; $g('gvExpV').textContent = state.exposure.toFixed(1) + '×'; };
  $g('gvMonOn').onchange = (e) => { pv.on = e.target.checked; pv.dirty = true; $g('gvMonOff').style.display = pv.on ? 'none' : 'grid'; };
  $g('gvMonRate').onchange = (e) => { mon.auto = e.target.value === 'auto'; if (!mon.auto) pv.rate = +e.target.value; else mon.level = 1; };
  $g('gvCapture').onclick = startCapture;
  document.querySelectorAll('[data-layer]').forEach((c) => { c.checked = layers[c.dataset.layer]; c.onchange = () => { layers[c.dataset.layer] = c.checked; }; });
  const togglePlay = () => setPlaying(!st.playing);
  for (const id of ['gvPlay', 'gvMonPlay']) $g(id).onclick = togglePlay;
  for (const id of ['gvPrevShot', 'gvMonPrev']) $g(id).onclick = () => stepShot(-1);
  for (const id of ['gvNextShot', 'gvMonNext']) $g(id).onclick = () => stepShot(1);
  $g('gvSpeed').onchange = (e) => { st.speed = +e.target.value; };
  $g('gvLeftBtn').onclick = () => { $g('gv').classList.toggle('openL'); $g('gv').classList.remove('openR'); };
  $g('gvRightBtn').onclick = () => { $g('gv').classList.toggle('openR'); $g('gv').classList.remove('openL'); };
  $g('gvHelpBtn').onclick = () => $g('gvHelp').classList.toggle('hidden'); $g('gvHelpClose').onclick = () => $g('gvHelp').classList.add('hidden');
  // timeline height grip
  { const grip = $g('gvTLGrip'); let y0 = 0, h0 = 0, on = false; grip.addEventListener('pointerdown', (e) => { on = true; y0 = e.clientY; h0 = $g('gvTL').getBoundingClientRect().height; grip.setPointerCapture(e.pointerId); });
    grip.addEventListener('pointermove', (e) => { if (!on) return; const h = clamp(h0 + (y0 - e.clientY), 150, innerHeight * 0.65); $g('gv').style.setProperty('--gv-tlh', h + 'px'); gv.dirty = true; });
    grip.addEventListener('pointerup', () => { on = false; lay.tlh = Math.round($g('gvTL').getBoundingClientRect().height); saveLay(); }); }

  /* hover on the paths: nearest hero or Ember sample in screen space */
  const tip = $g('gvTip'), _p = V();
  function nearestSample(px, py) {
    const rect = renderer.domElement.getBoundingClientRect(), set = state.set; let best = null, bd = 22 * 22;
    for (let i = 0; i < sm.n; i += 2) {
      if (!gvInRange(set, sm.t[i])) continue;
      for (const kind of (layers.ember ? ['root', 'lure'] : ['root'])) {
        if (kind === 'lure' && (sm.lure[i * 3 + 1] > 40 || sm.t[i] < 8.9)) continue;
        const a = sm[kind]; _p.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]).project(camera);
        if (_p.z > 1) continue;
        const sx = rect.left + (_p.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-_p.y * 0.5 + 0.5) * rect.height, d = (sx - px) ** 2 + (sy - py) ** 2;
        if (d < bd) { bd = d; best = { i, kind, sx, sy }; }
      }
    }
    return best;
  }
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons || dragging) { tip.classList.add('hidden'); return; }
    const n = nearestSample(e.clientX, e.clientY);
    if (!n) { tip.classList.add('hidden'); renderer.domElement.style.cursor = ''; return; }
    const t = sm.t[n.i], b = BEATS[beatAt(t)], a = sm[n.kind];
    tip.innerHTML = `<b>${n.kind === 'root' ? 'Robot' : 'Ember'}</b> ${gvFmtF(t)}<br>${gvEsc(b.name)} · S${sm.shot[n.i] + 1}<br>${a[n.i * 3].toFixed(1)}, ${a[n.i * 3 + 1].toFixed(1)}, ${a[n.i * 3 + 2].toFixed(1)}`;
    tip.style.left = Math.min(innerWidth - 190, e.clientX + 14) + 'px'; tip.style.top = Math.min(innerHeight - 90, e.clientY + 14) + 'px'; tip.classList.remove('hidden');
    renderer.domElement.style.cursor = 'pointer';
  });
  renderer.domElement.addEventListener('pointerleave', () => tip.classList.add('hidden'));
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || dragging || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const n = nearestSample(e.clientX, e.clientY); if (n) { gv.pinned = false; seekTo(sm.t[n.i]); setPlaying(false); }
  });

  /* the map: every set at once, or one set up close with pan, zoom and draggable cameras */
  const mapEl = $g('gvMap'), cv = $g('gvMapCanvas'), mapCtx = cv.getContext('2d');
  const mp = { set: 'all', tool: 'seek', views: {}, hit: [], panels: [], drag: null, raf: 0 };
  const MAP_SETS = ['atrium', 'roof', 'forest'];
  const mapAxes = { top: ['x', 'z'], side: ['x', 'y'] };
  function panelView(set, view, w, h) { // the user's pan and zoom for this panel, or the fit-to-set default
    const k = set + ':' + view, b = bounds[set], [ax, ay] = mapAxes[view];
    const spanX = Math.max(b.max[ax] - b.min[ax], 4), spanY = Math.max(b.max[ay] - b.min[ay], 4);
    const fit = { s: Math.min((w - 16) / spanX, (h - 16) / spanY), cx: (b.min[ax] + b.max[ax]) / 2, cy: (b.min[ay] + b.max[ay]) / 2 };
    return mp.views[k] ? { ...mp.views[k], fit } : { ...fit, fit };
  }
  function drawPanel(set, view, x0, y0, w, h, focus) {
    const c = mapCtx, [ax, ay] = mapAxes[view], yi = ay === 'z' ? 2 : 1, V0 = panelView(set, view, w, h), s = V0.s;
    const px = (v) => x0 + w / 2 + (v - V0.cx) * s, py = (v) => (view === 'top' ? y0 + h / 2 + (v - V0.cy) * s : y0 + h / 2 - (v - V0.cy) * s);
    mp.panels.push({ set, view, x0, y0, w, h, V: V0, px, py });
    c.fillStyle = '#0d1018'; c.strokeStyle = '#242c3d'; c.lineWidth = 1; c.beginPath(); c.roundRect(x0, y0, w, h, 8); c.fill(); c.stroke();
    c.save(); c.beginPath(); c.rect(x0, y0, w, h); c.clip();
    if (focus) { // a faint metre grid so distances read
      const step = [1, 2, 5, 10, 20, 50, 100].find((q) => q * s >= 38) || 100; c.strokeStyle = '#161c29'; c.lineWidth = 1; c.beginPath();
      const wx0 = V0.cx - w / 2 / s, wx1 = V0.cx + w / 2 / s, wy0 = V0.cy - h / 2 / s, wy1 = V0.cy + h / 2 / s;
      for (let X = Math.ceil(wx0 / step) * step; X <= wx1; X += step) { c.moveTo(px(X), y0); c.lineTo(px(X), y0 + h); }
      for (let Y = Math.ceil(wy0 / step) * step; Y <= wy1; Y += step) { c.moveTo(x0, py(Y)); c.lineTo(x0 + w, py(Y)); }
      c.stroke(); c.fillStyle = '#4b556b'; c.font = '10px system-ui'; c.fillText(step + ' m grid', x0 + 8, y0 + h - 8);
    }
    const selShot = gv.sel;
    // authored camera positions, the selected shot's path in amber
    c.fillStyle = 'rgba(160,200,255,.65)';
    for (let i = 0; i < sm.n; i += focus ? 8 : 20) if (gvInRange(set, sm.t[i]) && sm.shot[i] !== selShot) c.fillRect(px(sm.cam[i * 3]) - 1.5, py(sm.cam[i * 3 + yi]) - 1.5, 3, 3);
    if (focus) for (let i = 0; i < sm.n; i += 3) if (gvInRange(set, sm.t[i]) && sm.shot[i] !== undefined && i % 12 === 0 && mp.tool === 'cams') mp.hit.push({ kind: 'shot', x: px(sm.cam[i * 3]), y: py(sm.cam[i * 3 + yi]), shot: sm.shot[i], panel: mp.panels.length - 1 });
    c.strokeStyle = '#ffb347'; c.lineWidth = 2; c.beginPath(); let pen = false;
    for (let i = 0; i < sm.n; i++) { if (sm.shot[i] !== selShot || !gvInRange(set, sm.t[i])) { pen = false; continue; } const X = px(sm.cam[i * 3]), Y = py(sm.cam[i * 3 + yi]); if (!pen) { c.moveTo(X, Y); pen = true; } else c.lineTo(X, Y); }
    c.stroke();
    // Ember, dashed
    c.strokeStyle = 'rgba(200,255,90,.8)'; c.setLineDash([4, 3]); c.lineWidth = 1.2; c.beginPath(); pen = false;
    for (let i = 0; i < sm.n; i++) { if (!gvInRange(set, sm.t[i]) || sm.lure[i * 3 + 1] > 40 || sm.t[i] < 8.9) { pen = false; continue; } const X = px(sm.lure[i * 3]), Y = py(sm.lure[i * 3 + yi]); if (!pen) { c.moveTo(X, Y); pen = true; } else c.lineTo(X, Y); }
    c.stroke(); c.setLineDash([]);
    // the robot's path, coloured by time
    c.lineWidth = focus ? 2.8 : 2.4; c.lineCap = 'round';
    for (let i = 1; i < sm.n; i++) {
      if (!gvInRange(set, sm.t[i]) || !gvInRange(set, sm.t[i - 1])) continue;
      const col = gvHue(sm.t[i]); c.strokeStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
      c.beginPath(); c.moveTo(px(sm.root[(i - 1) * 3]), py(sm.root[(i - 1) * 3 + yi])); c.lineTo(px(sm.root[i * 3]), py(sm.root[i * 3 + yi])); c.stroke();
      if (i % 2 === 0) mp.hit.push({ kind: 'time', x: px(sm.root[i * 3]), y: py(sm.root[i * 3 + yi]), t: sm.t[i], panel: mp.panels.length - 1 });
    }
    c.fillStyle = '#e8e8f0'; c.font = '10px system-ui';
    for (let t = 0; t < FILM; t += focus ? 5 : 10) if (gvInRange(set, t)) { const i = sampleAt(t), X = px(sm.root[i * 3]), Y = py(sm.root[i * 3 + yi]); c.beginPath(); c.arc(X, Y, 2.6, 0, 7); c.fill(); if (view === 'top' || focus) c.fillText(gvFmt(t), X + 4, Y - 4); }
    // the camera you are looking through right now: position, aim line and lens cone
    if (gvInRange(set, st.T)) {
      const i = sampleAt(st.T), X = px(sm.cam[i * 3]), Y = py(sm.cam[i * 3 + yi]), TX = px(sm.tgt[i * 3]), TY = py(sm.tgt[i * 3 + yi]);
      const ang = Math.atan2(TY - Y, TX - X), half = THREE.MathUtils.degToRad(sm.fov[i] / 2) * (view === 'top' ? 1 : 0.6), L = Math.min(Math.hypot(TX - X, TY - Y), 90);
      c.fillStyle = 'rgba(255,179,71,.14)'; c.beginPath(); c.moveTo(X, Y); c.lineTo(X + Math.cos(ang - half) * L, Y + Math.sin(ang - half) * L); c.lineTo(X + Math.cos(ang + half) * L, Y + Math.sin(ang + half) * L); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,179,71,.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(X, Y); c.lineTo(TX, TY); c.stroke();
      c.fillStyle = '#ffb347'; c.beginPath(); c.arc(X, Y, 4.5, 0, 7); c.fill();
    }
    if (world.cur === set) { const dot = (v, col) => { c.fillStyle = col; c.strokeStyle = '#000'; c.beginPath(); c.arc(px(v[0]), py(v[yi]), 5, 0, 7); c.fill(); c.stroke(); }; dot([S.root.x, S.root.y, S.root.z], '#ff6a50'); if (S.lure.y < 40) dot([S.lure.x, S.lure.y, S.lure.z], '#d8ff5a'); }
    // draggable camera keys of every edited shot in this set
    if (focus) {
      SHOTS.forEach((sh, i) => {
        const ov = gv.ov[sh.t0]; if (!ov || !gvInRange(set, sh.t0 + 0.01)) return; const on = i === selShot, a = on ? 1 : 0.45;
        const pts = ov.keys.map((k) => { const w = keyWorld(i, k); return { k, X: px(w.pos[ax]), Y: py(w.pos[ay]), TX: px(w.tgt[ax]), TY: py(w.tgt[ay]) }; });
        c.globalAlpha = a; c.strokeStyle = on ? '#ffb347' : '#8aa4d6'; c.lineWidth = on ? 1.6 : 1;
        c.beginPath(); pts.forEach((q, n) => (n ? c.lineTo(q.X, q.Y) : c.moveTo(q.X, q.Y))); c.stroke();
        pts.forEach((q, n) => {
          c.strokeStyle = on ? 'rgba(255,122,92,.8)' : 'rgba(255,122,92,.4)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(q.X, q.Y); c.lineTo(q.TX, q.TY); c.stroke(); c.setLineDash([]);
          const sel = on && n === gv.selKey;
          c.fillStyle = sel ? '#fff4d8' : on ? '#ffb347' : '#8aa4d6'; c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.rect(q.X - 5.5, q.Y - 5.5, 11, 11); c.fill(); c.stroke();
          c.fillStyle = sel ? '#ffd0c4' : '#ff7a5c'; c.beginPath(); c.moveTo(q.TX, q.TY - 6); c.lineTo(q.TX + 6, q.TY); c.lineTo(q.TX, q.TY + 6); c.lineTo(q.TX - 6, q.TY); c.closePath(); c.fill(); c.stroke();
          if (on) { c.fillStyle = '#ffe9c0'; c.font = '600 10px system-ui'; c.fillText(`S${i + 1}·${n + 1}`, q.X + 8, q.Y - 7); }
          mp.hit.unshift({ kind: 'handle', part: 'pos', x: q.X, y: q.Y, i, k: q.k, n, panel: mp.panels.length - 1 }, { kind: 'handle', part: 'tgt', x: q.TX, y: q.TY, i, k: q.k, n, panel: mp.panels.length - 1 });
        });
        c.globalAlpha = 1;
      });
    }
    c.restore();
    c.fillStyle = '#7f8aa0'; c.font = '12px system-ui'; c.fillText(view === 'top' ? 'top view (x→, z↓)' : 'side view (x→, height↑)', x0 + 8, y0 + 16);
  }
  function drawMap() {
    const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0); mapCtx.clearRect(0, 0, W, H); mp.hit = []; mp.panels = [];
    const c = mapCtx, padX = 24;
    if (mp.set === 'all') {
      const wide = W > 760, colW = wide ? (W - padX * 4) / 3 : W - padX * 2, rowH = wide ? (H - 90) / 2 : (H - 60) / 6 - 14;
      MAP_SETS.forEach((set, ci) => {
        const x0 = padX + (wide ? ci * (colW + padX) : 0);
        ['top', 'side'].forEach((view, ri) => {
          const y0 = wide ? 48 + ri * (rowH + 14) : 40 + (ci * 2 + ri) * (rowH + 22);
          if (ri === 0) { c.fillStyle = '#d8d0c0'; c.font = '600 15px system-ui'; c.fillText(GV_SET_NAMES[set], x0 + 4, y0 - 20); c.fillStyle = '#7f8aa0'; c.font = '12px system-ui'; c.fillText(`${gvFmt(GV_RANGES[set][0][0])}–${gvFmt(GV_RANGES[set][GV_RANGES[set].length - 1][1])} · double-click to open`, x0 + 4 + c.measureText(GV_SET_NAMES[set]).width + 12, y0 - 20); }
          mp.views[set + ':' + view] = null; drawPanel(set, view, x0, y0, colW, rowH, false);
        });
      });
    } else {
      const wide = W > 820, topW = wide ? (W - padX * 3) * 0.62 : W - padX * 2, sideW = wide ? W - padX * 3 - topW : W - padX * 2, h = H - 40;
      const set = mp.set;
      drawPanel(set, 'top', padX, 20, topW, wide ? h : h * 0.58, true);
      drawPanel(set, 'side', wide ? padX * 2 + topW : padX, wide ? 20 : 20 + h * 0.58 + 14, sideW, wide ? h : h * 0.42 - 14, true);
    }
    const hint = $g('gvMapHint');
    hint.textContent = mp.set === 'all' ? 'Robot path coloured by time, Ember dashed. Click a point to jump there. Double-click a set to open it, or pick one above.'
      : mp.tool === 'cams' ? 'Drag a square (camera) or diamond (aim) to move it. Click a blue dot to pick that shot. Wheel zooms, drag the background to pan.' : 'Click the robot\'s path to jump to that moment. Wheel zooms, drag the background to pan. Switch to Cameras to move shots.';
    const ov = gv.ov[SHOTS[gv.sel].t0]; $g('gvMapEdit').classList.toggle('hidden', mp.set === 'all'); $g('gvMapEdit').disabled = !!ov;
    $g('gvMapEdit').textContent = ov ? `S${gv.sel + 1} has editable cameras` : `Edit camera of S${gv.sel + 1}`;
    $g('gvMapTool').classList.toggle('hidden', mp.set === 'all'); $g('gvMapReset').classList.toggle('hidden', mp.set === 'all');
  }
  const mapSoon = () => { if (!mp.raf) mp.raf = requestAnimationFrame(() => { mp.raf = 0; drawMap(); }); };
  const mapPoint = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const panelAt = (x, y) => mp.panels.findIndex((q) => x >= q.x0 && x <= q.x0 + q.w && y >= q.y0 && y <= q.y0 + q.h);
  const nearest = (x, y, kinds, r = 12) => { let best = null, bd = r * r; for (const h of mp.hit) { if (!kinds.includes(h.kind)) continue; const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d < bd) { bd = d; best = h; } } return best; };
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; const [x, y] = mapPoint(e), pi = panelAt(x, y); mp.drag = { x0: x, y0: y, moved: false, pi, handle: null, pan: null };
    if (mp.set === 'all' || pi < 0) return; cv.setPointerCapture(e.pointerId);
    const hnd = mp.tool === 'cams' ? nearest(x, y, ['handle'], 11) : null;
    if (hnd) { mp.drag.handle = hnd; if (gv.sel !== hnd.i) { selectShot(hnd.i, false); } gv.selKey = hnd.n; renderInspector(); mapSoon(); }
    else { const V0 = mp.panels[pi].V; mp.drag.pan = { cx: V0.cx, cy: V0.cy }; }
  });
  cv.addEventListener('pointermove', (e) => {
    const d = mp.drag; if (!d || d.pi < 0 || mp.set === 'all') { const [x, y] = mapPoint(e); cv.style.cursor = mp.set !== 'all' && mp.tool === 'cams' && nearest(x, y, ['handle'], 11) ? 'grab' : mp.set === 'all' ? 'crosshair' : 'default'; return; }
    const [x, y] = mapPoint(e); if (Math.hypot(x - d.x0, y - d.y0) > 3) d.moved = true; if (!d.moved) return;
    const q = mp.panels[d.pi], [ax, ay] = mapAxes[q.view], sgn = q.view === 'top' ? 1 : -1;
    if (d.handle) {
      const h = d.handle, ov = gv.ov[SHOTS[h.i].t0], k = ov && ov.keys[h.n]; if (!k) return;
      const w = keyWorld(h.i, k), vec = h.part === 'pos' ? w.pos : w.tgt;
      vec[ax] = q.V.cx + (x - (q.x0 + q.w / 2)) / q.V.s; vec[ay] = q.V.cy + sgn * (y - (q.y0 + q.h / 2)) / q.V.s;
      if (h.part === 'pos') setKeyWorld(h.i, k, vec, null); else setKeyWorld(h.i, k, null, vec);
      k.pos = k.pos.map(round3); k.target = k.target.map(round3); applyOv(h.i); saveEdits(); cv.style.cursor = 'grabbing';
    } else if (d.pan) {
      mp.views[q.set + ':' + q.view] = { s: q.V.s, cx: d.pan.cx - (x - d.x0) / q.V.s, cy: d.pan.cy - sgn * (y - d.y0) / q.V.s }; cv.style.cursor = 'move';
    }
    mapSoon();
  });
  const mapUp = (e) => {
    const d = mp.drag; mp.drag = null; if (!d) return; const [x, y] = mapPoint(e);
    if (d.handle && d.moved) { resampleShot(d.handle.i); renderInspector(); renderExport(); rebuildEdit(); mapSoon(); return; }
    if (d.moved) return;
    if (mp.set === 'cams-none') return;
    const pick = mp.tool === 'cams' && mp.set !== 'all' ? nearest(x, y, ['shot'], 12) : null;
    if (pick) { gv.pinned = false; gv.editOn = false; selectShot(pick.shot, true); mapSoon(); return; }
    const t = nearest(x, y, ['time'], 18);
    if (t) { gv.pinned = false; seekTo(t.t); setPlaying(false); if (mp.set === 'all') { clearTimeout(mp.closeT); mp.closeT = setTimeout(() => mapEl.classList.add('hidden'), 280); } else mapSoon(); }
  };
  cv.addEventListener('pointerup', mapUp); cv.addEventListener('pointercancel', () => { mp.drag = null; });
  cv.addEventListener('wheel', (e) => {
    if (mp.set === 'all') return; const [x, y] = mapPoint(e), pi = panelAt(x, y); if (pi < 0) return; e.preventDefault();
    const q = mp.panels[pi], [, ay] = mapAxes[q.view], sgn = q.view === 'top' ? 1 : -1, k = Math.pow(1.0018, -e.deltaY), s2 = clamp(q.V.s * k, q.V.fit.s * 0.4, q.V.fit.s * 40);
    const wx = q.V.cx + (x - (q.x0 + q.w / 2)) / q.V.s, wy = q.V.cy + sgn * (y - (q.y0 + q.h / 2)) / q.V.s;
    mp.views[q.set + ':' + q.view] = { s: s2, cx: wx - (x - (q.x0 + q.w / 2)) / s2, cy: wy - sgn * (y - (q.y0 + q.h / 2)) / s2 }; mapSoon();
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    clearTimeout(mp.closeT); const [x, y] = mapPoint(e), pi = panelAt(x, y); if (pi < 0) return; const q = mp.panels[pi];
    if (mp.set === 'all') { setMapSet(q.set); return; } mp.views[q.set + ':' + q.view] = null; mapSoon();
  });
  function setMapSet(set) {
    mp.set = set; document.querySelectorAll('#gvMapSets button').forEach((b) => b.classList.toggle('on', b.dataset.ms === set));
    if (set !== 'all' && mp.tool === 'seek') { /* keep the user's tool */ } mapSoon();
  }
  $g('gvMapSets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMapSet(b.dataset.ms); });
  $g('gvMapTool').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; mp.tool = b.dataset.mt; document.querySelectorAll('#gvMapTool button').forEach((x) => x.classList.toggle('on', x === b)); mapSoon(); });
  $g('gvMapEdit').onclick = () => { enterEdit(gv.sel); rebuildEdit(); renderShotRows(); mapSoon(); };
  $g('gvMapReset').onclick = () => { for (const k of Object.keys(mp.views)) mp.views[k] = null; mapSoon(); };
  const openMap = () => { mapEl.classList.remove('hidden'); const s = SHOTS[gv.sel]; if (mp.set === 'all' && false) setMapSet(setAt(s.t0)); drawMap(); };
  gv.map = mp; gv.setMapSet = setMapSet;
  $g('gvMapBtn').onclick = () => (mapEl.classList.contains('hidden') ? openMap() : mapEl.classList.add('hidden'));
  $g('gvMapClose').onclick = () => mapEl.classList.add('hidden');
  setInterval(() => { if (!mapEl.classList.contains('hidden') && !mp.drag) drawMap(); }, 500);

  // The desk owns the keyboard: the film's own shortcuts (camera modes, notes) must not fire here.
  addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopImmediatePropagation(); saveProject(false); return; }
    if (!$g('gvDlg').classList.contains('hidden') || !$g('gvXp').classList.contains('hidden')) return;
    const tag = e.target.tagName; if (tag === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return; if (tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const ck = e.key.toLowerCase(); let hit = true;
      if (ck === 'z') histGo(e.shiftKey ? 1 : -1); else if (ck === 'y') histGo(1);
      else if (ck === 'c') (e.shiftKey ? copyGrade() : copyCam()); else if (ck === 'v') (e.shiftKey ? pasteGrade(false) : pasteCam()); else hit = false;
      if (hit) { e.preventDefault(); e.stopImmediatePropagation(); } return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase(); let used = true;
    if (gv.studioKey && gv.studioKey(k, e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.code === 'Space') togglePlay();
    else if (k === 'arrowleft') seekTo(st.T - (e.shiftKey ? 1 : 1 / 24)); else if (k === 'arrowright') seekTo(st.T + (e.shiftKey ? 1 : 1 / 24));
    else if (k === 'arrowup') stepShot(-1); else if (k === 'arrowdown') stepShot(1);
    else if (k === 'm') $g('gvMapBtn').click(); else if (k === 'escape') { gv.onEscape && gv.onEscape(); mapEl.classList.add('hidden'); $g('gvHelp').classList.add('hidden'); closeProjMenu(); }
    else if (k === '1') setView('top'); else if (k === '2') setView('aerial'); else if (k === '3') setView('side'); else if (k === '4') setView('south');
    else if (k === 'g') { layers.grid = !layers.grid; document.querySelector('[data-layer=grid]').checked = layers.grid; }
    else if (k === 'f') setView(curView); else if (k === 's') frameShot(gv.sel);
    else if (k === 't') { state.follow = !state.follow; syncChecks(); } else if (k === 'c') { state.clipOn = !state.clipOn; syncChecks(); }
    else if (k === 'e') { if (gv.editOn) exitEdit(); else enterEdit(gv.sel); rebuildEdit(); }
    else if (k === 'k') { addKeyHere(); rebuildEdit(); } else if (k === 'delete' || k === 'backspace') { deleteKey(); rebuildEdit(); }
    else if (k === '?') $g('gvHelp').classList.toggle('hidden');
    else if (k === '/') { $g('gvLTabs').querySelector('button').click(); $g('gv').classList.add('openL'); setTimeout(() => $g('gvShotQ').focus(), 0); }
    else if (k === '=' || k === '+') gv.tl?.zoomBy(1.4); else if (k === '-') gv.tl?.zoomBy(1 / 1.4);
    else if (k === 'home') seekTo(0); else if (k === 'end') seekTo(FILM - 0.05);
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); } else e.stopImmediatePropagation();
  }, true);


  /* ---------- editor tools: toast, layout, LUTs, looks, undo/redo, copy and paste, filter, stills, drop ---------- */
  let toastT = 0;
  function gvToast(text, err = false) { const el = $g('gvToast'); el.textContent = text; el.classList.toggle('err', err); el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), err ? 5200 : 2400); }

  // draggable panel edges, remembered between visits
  const LAY_KEY = 'clockwork.sculptor.layout.v1'; let lay = {};
  try { lay = JSON.parse(localStorage.getItem(LAY_KEY) || '{}') || {}; } catch (e) { lay = {}; }
  const saveLay = () => { try { localStorage.setItem(LAY_KEY, JSON.stringify(lay)); } catch (e) { /* private window */ } };
  function applyLay() {
    const g = $g('gv');
    if (lay.lw) g.style.setProperty('--gv-lw', lay.lw + 'px'); if (lay.rw) g.style.setProperty('--gv-rw', lay.rw + 'px');
    if (lay.monw) g.style.setProperty('--gv-monw', lay.monw + '%'); if (lay.tlh) g.style.setProperty('--gv-tlh', lay.tlh + 'px');
    $g('gvMonCard').classList.toggle('folded', !!lay.fold);
  }
  function gripDrag(el, start, move) {
    let on = false, x0 = 0, y0 = 0, st0;
    el.addEventListener('pointerdown', (e) => { on = true; x0 = e.clientX; y0 = e.clientY; st0 = start(); el.classList.add('on'); el.setPointerCapture(e.pointerId); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (on) { move(e.clientX - x0, e.clientY - y0, st0); applyLay(); gv.dirty = true; pv.dirty = true; fitStage(); } });
    const end = () => { if (!on) return; on = false; el.classList.remove('on'); saveLay(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => { move(0, 0, null, true); applyLay(); saveLay(); fitStage(); });
  }
  gripDrag($g('gvLGrip'), () => $g('gvLeft').getBoundingClientRect().width, (dx, dy, w0, reset) => { if (reset) { delete lay.lw; $g('gv').style.removeProperty('--gv-lw'); } else lay.lw = clamp(Math.round(w0 + dx), 200, 480); });
  gripDrag($g('gvRGrip'), () => $g('gvRight').getBoundingClientRect().width, (dx, dy, w0, reset) => { if (reset) { delete lay.rw; $g('gv').style.removeProperty('--gv-rw'); } else lay.rw = clamp(Math.round(w0 - dx), 280, 640); });
  gripDrag($g('gvMonGrip'), () => ({ w: document.querySelector('#gvMonCard .monwrap').getBoundingClientRect().width, c: $g('gvMonCard').getBoundingClientRect().width }), (dx, dy, s0, reset) => { if (reset) { delete lay.monw; $g('gv').style.removeProperty('--gv-monw'); } else { lay.monw = clamp(Math.round(((s0.w + dy * 16 / 9) / s0.c) * 100), 30, 100); lay.fold = false; } });
  $g('gvMonFold').onclick = () => { lay.fold = !lay.fold; applyLay(); saveLay(); fitStage(); };
  applyLay();

  // colour LUTs (.cube)
  function parseCube(text, fname) {
    let name = fname.replace(/\.[^.]+$/, ''), n3 = 0, n1 = 0; const v = [];
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim(); if (!l || l[0] === '#') continue;
      if (/^TITLE/i.test(l)) { const m = l.match(/"(.*)"/); if (m && m[1]) name = m[1]; continue; }
      if (/^LUT_3D_SIZE/i.test(l)) { n3 = parseInt(l.split(/\s+/)[1], 10); continue; }
      if (/^LUT_1D_SIZE/i.test(l)) { n1 = parseInt(l.split(/\s+/)[1], 10); continue; }
      if (/^[A-Za-z_]/.test(l)) continue;
      const q = l.split(/\s+/); if (q.length >= 3) v.push(+q[0], +q[1], +q[2]);
    }
    if (v.some((x) => Number.isNaN(x))) throw new Error('the file has values that are not numbers');
    const N = 33, out = new Uint8Array(N * N * N * 3), b8 = (x) => Math.round(clamp(x, 0, 1) * 255);
    if (n3 >= 2) {
      if (v.length !== n3 * n3 * n3 * 3) throw new Error(`expected ${n3 * n3 * n3} colour rows for a ${n3}-point LUT, found ${v.length / 3}`);
      const n = Math.min(n3, N), at = (r, g, b, c) => v[((b * n3 + g) * n3 + r) * 3 + c];
      const f = (i) => (n === n3 ? i : (i / (n - 1)) * (n3 - 1));
      for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
        const fr = f(r), fg = f(g), fb = f(b), r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb), r1 = Math.min(r0 + 1, n3 - 1), g1 = Math.min(g0 + 1, n3 - 1), b1 = Math.min(b0 + 1, n3 - 1), tr = fr - r0, tg = fg - g0, tb = fb - b0;
        for (let c = 0; c < 3; c++) {
          const c00 = at(r0, g0, b0, c) * (1 - tr) + at(r1, g0, b0, c) * tr, c10 = at(r0, g1, b0, c) * (1 - tr) + at(r1, g1, b0, c) * tr;
          const c01 = at(r0, g0, b1, c) * (1 - tr) + at(r1, g0, b1, c) * tr, c11 = at(r0, g1, b1, c) * (1 - tr) + at(r1, g1, b1, c) * tr;
          out[((b * n + g) * n + r) * 3 + c] = b8((c00 * (1 - tg) + c10 * tg) * (1 - tb) + (c01 * (1 - tg) + c11 * tg) * tb);
        }
      }
      return { name, n, data: bytesB64(out.subarray(0, n * n * n * 3)) };
    }
    if (n1 >= 2) {
      if (v.length !== n1 * 3) throw new Error(`expected ${n1} rows for a ${n1}-point 1D LUT, found ${v.length / 3}`);
      const curve = (x, c) => { const p = x * (n1 - 1), i = Math.min(Math.floor(p), n1 - 2), t = p - i; return v[i * 3 + c] * (1 - t) + v[(i + 1) * 3 + c] * t; };
      for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) { const o = ((b * N + g) * N + r) * 3; out[o] = b8(curve(r / (N - 1), 0)); out[o + 1] = b8(curve(g / (N - 1), 1)); out[o + 2] = b8(curve(b / (N - 1), 2)); }
      return { name, n: N, data: bytesB64(out) };
    }
    throw new Error('this does not look like a .cube LUT (no LUT_3D_SIZE or LUT_1D_SIZE)');
  }
  function bytesB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
  async function importLut(file) {
    try {
      const lut = parseCube(await file.text(), file.name);
      G.vals.lut = lut; if (G.vals.lutAmount === undefined) G.vals.lutAmount = 1;
      gradeChanged(); renderGrade(); gvToast(`LUT “${lut.name}” imported (${lut.n}³). Adjust its strength under Colour LUT.`);
      document.querySelector('[data-itab=grade]').click();
    } catch (err) { gvToast('Could not read that LUT: ' + err.message, true); }
  }
  $g('gvLutIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importLut(f); });

  // your own looks, shared by every project in this browser
  const LOOKS_KEY = 'clockwork.looks.v1';
  function readLooks() { try { return JSON.parse(localStorage.getItem(LOOKS_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function writeLooks(l) { try { localStorage.setItem(LOOKS_KEY, JSON.stringify(l)); return true; } catch (e) { gvToast('Could not store the look (browser storage is full or blocked)', true); return false; } }
  async function saveLook() {
    const name = await gvAsk({ title: 'Save this grade as a look', text: 'It joins “My looks” for every project in this browser. Shot grades are not included.', value: 'My look', ok: 'Save look' });
    if (name === null || !name.trim()) return;
    const v = clone(G.vals); delete v.shots; const l = readLooks(); l[name.trim()] = v; if (writeLooks(l)) { renderGrade(); gvToast(`Saved look “${name.trim()}”`); }
  }

  // undo and redo over cameras, grade and notes
  hist = { stack: [], at: -1, busy: false };
  function histPush() {
    if (hist.busy) return; const j = JSON.stringify(snapshot());
    if (hist.stack[hist.at] === j) return;
    hist.stack.length = hist.at + 1; hist.stack.push(j); if (hist.stack.length > 60) hist.stack.shift(); hist.at = hist.stack.length - 1; histButtons();
  }
  function histButtons() { $g('gvUndo').disabled = hist.at <= 0; $g('gvRedo').disabled = hist.at >= hist.stack.length - 1; }
  function refreshAll() { renderShotRows(); renderInspector(); renderGrade(); renderExport(); rebuildEdit(); renderProjectBar(); gv.dirty = true; pv.dirty = true; }
  async function histGo(d) {
    if (ptimer) persistNow(); // a change still waiting to be recorded counts as the latest step
    const n = hist.at + d; if (hist.hold || n < 0 || n >= hist.stack.length) return;
    hist.busy = true; hist.hold = true;
    try {
      const before = clone(gv.ov), w = JSON.parse(hist.stack[n]), keep = { editOn: gv.editOn, pinned: gv.pinned, selKey: gv.selKey }, scope = G.scope;
      hist.at = n; applyWork(w, PFROM); Object.assign(gv, keep); G.scope = scope;
      persistNow();
      const changed = new Set([...Object.keys(before), ...Object.keys(gv.ov)].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(gv.ov[k])));
      for (const t0 of changed) { const i = SHOTS.findIndex((x) => x.t0 === +t0); if (i >= 0) resampleShot(i); }
      const ov = gv.ov[SHOTS[gv.sel].t0]; gv.selKey = clamp(gv.selKey, 0, ov ? ov.keys.length - 1 : 0); if (!ov) gv.editOn = false;
      refreshAll(); histButtons();
    } finally { hist.busy = false; hist.hold = false; }
  }
  $g('gvUndo').onclick = () => histGo(-1); $g('gvRedo').onclick = () => histGo(1);

  // copy and paste cameras and grades between shots
  function copyCam() { const ov = gv.ov[SHOTS[gv.sel].t0]; if (!ov) return gvToast('This shot has no edited camera yet. Press Edit camera first.', true); gv.clip.cam = clone(ov); renderInspector(); gvToast(`Copied the camera of S${gv.sel + 1}`); }
  function pasteCam() {
    if (!gv.clip.cam) return gvToast('Copy a shot camera first (Ctrl+C)', true);
    const i = gv.sel, t0 = SHOTS[i].t0; gv.ov[t0] = clone(gv.clip.cam); applyOv(i); saveEdits(); resampleShot(i); renderShotRows(); renderInspector(); renderExport(); rebuildEdit(); gvToast(`Pasted the camera into S${i + 1}`);
  }
  function copyGrade() { const o = shotGrade(false); if (!o || !Object.keys(o).length) { gv.clip.grade = null; return gvToast('This shot has no grade of its own to copy', true); } gv.clip.grade = clone(o); renderGrade(); gvToast(`Copied the grade of S${gv.sel + 1}`); }
  function pasteGrade(chapter) {
    if (!gv.clip.grade) return gvToast('Copy a shot grade first (Ctrl+Shift+C)', true);
    const targets = chapter ? SHOTS.map((x, i) => i).filter((i) => chapterAt(SHOTS[i].t0 + 0.01) === chapterAt(SHOTS[gv.sel].t0 + 0.01)) : [gv.sel];
    if (!G.vals.shots) G.vals.shots = {}; targets.forEach((i) => { G.vals.shots[SHOTS[i].t0] = clone(gv.clip.grade); });
    gradeChanged(); renderGrade(); renderShotRows(); gvToast(chapter ? `Pasted into ${targets.length} shots of this chapter` : `Pasted the grade into S${gv.sel + 1}`);
  }

  // find a shot
  let shotFilter = 'all';
  function applyShotFilter() {
    const q = ($g('gvShotQ')?.value || '').trim().toLowerCase(), box = $g('gvLShots'); if (!box) return; let head = null, headShown = false;
    box.querySelectorAll('.chead, .srow').forEach((el) => {
      if (el.classList.contains('chead')) { if (head) head.classList.toggle('nomatch', !headShown); head = el; headShown = false; return; }
      const i = +el.dataset.shot, t0 = SHOTS[i].t0;
      const okChip = shotFilter === 'all' || (shotFilter === 'cam' && gv.ov[t0]) || (shotFilter === 'grade' && G.vals.shots && G.vals.shots[t0]) || (shotFilter === 'note' && gv.notes[t0]);
      const ok = okChip && (!q || el.textContent.toLowerCase().includes(q) || ('s' + (i + 1)) === q);
      el.classList.toggle('nomatch', !ok); if (ok) headShown = true;
    });
    if (head) head.classList.toggle('nomatch', !headShown);
  }
  $g('gvShotQ').addEventListener('input', applyShotFilter);
  $g('gvShotQ').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); applyShotFilter(); } else if (e.key === 'Enter') { const r = $g('gvLShots').querySelector('.srow:not(.nomatch)'); if (r) { gv.pinned = false; gv.editOn = false; selectShot(+r.dataset.shot, true); } } });
  $g('gvShotChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; shotFilter = b.dataset.f; $g('gvShotChips').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); applyShotFilter(); });

  // save the monitor frame
  $g('gvStill').onclick = () => {
    try {
      const a = document.createElement('a'); a.download = `clockwork-S${gv.sel + 1}-${Math.floor(st.T / 60)}m${String(Math.floor(st.T % 60)).padStart(2, '0')}s.png`; a.href = $g('gvMon').toDataURL('image/png'); document.body.appendChild(a); a.click(); a.remove(); gvToast('Saved the monitor frame');
    } catch (e) { gvToast('Could not save the frame', true); }
  };

  // drop a .cube or a project file anywhere
  { let depth = 0; const drop = $g('gvDrop'), isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    addEventListener('dragenter', (e) => { if (isFiles(e)) { depth++; drop.classList.remove('hidden'); } });
    addEventListener('dragleave', (e) => { if (isFiles(e) && --depth <= 0) { depth = 0; drop.classList.add('hidden'); } });
    addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
    addEventListener('drop', async (e) => { if (!isFiles(e)) return; e.preventDefault(); depth = 0; drop.classList.add('hidden');
      for (const f of e.dataTransfer.files) { if (/\.cube$/i.test(f.name)) await importLut(f); else if (/\.json$/i.test(f.name)) await importFile(f); else gvToast(`Not sure what to do with ${f.name}`, true); } }); }

  /* ---------- project actions, menu and dialog ---------- */
  function gvAsk({ title, text = '', value = null, ok = 'OK', danger = false }) {
    return new Promise((res) => {
      const dlg = $g('gvDlg'), inp = $g('gvDlgInput'), yes = $g('gvDlgYes'), form = $g('gvDlgForm');
      $g('gvDlgTitle').textContent = title; $g('gvDlgText').textContent = text; $g('gvDlgText').classList.toggle('hidden', !text);
      inp.classList.toggle('hidden', value === null); inp.value = value ?? ''; yes.textContent = ok; yes.classList.toggle('warn', danger); yes.classList.toggle('pri', !danger);
      dlg.classList.remove('hidden'); if (value === null) yes.focus(); else { inp.focus(); inp.select(); }
      const done = (v) => { dlg.classList.add('hidden'); form.onsubmit = null; $g('gvDlgNo').onclick = null; dlg.onkeydown = null; res(v); };
      form.onsubmit = (e) => { e.preventDefault(); done(value === null ? true : inp.value); };
      $g('gvDlgNo').onclick = () => done(null);
      dlg.onkeydown = (e) => { if (e.key === 'Escape') done(null); };
    });
  }
  function applyWork(w, from) {
    for (const t0 of Object.keys(gv.ov)) { delete gv.ov[t0]; applyShotOverride(+t0, null); }
    for (const [t0, ov] of Object.entries(clone(w.overrides || {}))) if (applyShotOverride(+t0, ov)) gv.ov[t0] = ov;
    gv.notes = clone(w.notes || {}); gv.markers = clone(w.markers || []); if (gv.renderMarkers) gv.renderMarkers();
    const gs = w.grade; G.bypass = false;
    if (gs && gs.vals) { Object.assign(G, { base: gs.base || G_BASE0, applyGod: !!gs.applyGod, touched: gs.touched !== false }); G.vals = legacyVals(gs); }
    else { G.base = G_BASE0; G.vals = gradeDefaults(); G.applyGod = false; G.touched = false; }
    G.scope = 'film'; GRADE_PRESETS.gvcustom = G.vals; pv.dirty = true; PFROM = from; gv.editOn = false; gv.pinned = false; gv.selKey = 0;
  }
  async function loadWork(w, from) { applyWork(w, from); persistNow(); await resampleAll(); renderGrade(); renderProjectMenu(); }
  const ago = (t) => { const d = (Date.now() - t) / 1000; return d < 60 ? 'just now' : d < 3600 ? `${Math.floor(d / 60)} min ago` : d < 86400 ? `${Math.floor(d / 3600)} h ago` : new Date(t).toLocaleDateString(); };
  const gvId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nextName = () => { let n = Object.keys(PS.projects).length + 1; const names = Object.values(PS.projects).map((p) => p.name); while (names.includes('Project ' + n)) n++; return 'Project ' + n; };
  const unsaved = () => { const st = projState(); return st === 'dirty' || st === 'draft'; };
  async function saveProject(asNew = false) {
    persistNow(); let p = asNew ? null : curProject();
    if (!p) {
      const name = await gvAsk({ title: 'Save as a project', text: 'It will appear under Custom projects on the start page, next to the original film.', value: asNew && curProject() ? curProject().name + ' copy' : nextName(), ok: 'Save project' });
      if (name === null) return; const id = gvId(); p = PS.projects[id] = { id, name: name.trim() || nextName(), created: Date.now() }; PFROM = id;
    }
    Object.assign(p, snapshot(), { updated: Date.now() }); persistNow(); renderProjectMenu(); flashSaved();
  }
  function flashSaved() { const el = $g('gvSave'); el.textContent = 'Saved ✓'; setTimeout(renderProjectBar, 1200); }
  async function openProject(id) {
    if (!PS.projects[id] || id === PFROM) return;
    if (unsaved() && !(await gvAsk({ title: 'Leave unsaved changes?', text: 'The work you have open has changes that are not saved as a project.', ok: 'Open anyway', danger: true }))) return;
    await loadWork(PS.projects[id], id);
  }
  async function newProject() {
    if (unsaved() && !(await gvAsk({ title: 'Start a blank draft?', text: 'The work you have open has changes that are not saved as a project.', ok: 'Start blank', danger: true }))) return;
    await loadWork(baseline(), null);
  }
  async function renameProject() { const p = curProject(); if (!p) return; const n = await gvAsk({ title: 'Rename project', value: p.name, ok: 'Rename' }); if (n === null) return; p.name = n.trim() || p.name; p.updated = Date.now(); persistNow(); renderProjectMenu(); }
  async function deleteProject() {
    const p = curProject(); if (!p) return;
    if (!(await gvAsk({ title: `Delete "${p.name}"?`, text: 'The saved project is removed. The work stays open as a draft until you leave it.', ok: 'Delete project', danger: true }))) return;
    delete PS.projects[p.id]; PFROM = null; persistNow(); renderProjectMenu();
  }
  const downloadJSON = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  const fileSlug = (n) => (n || 'clockwork-edits').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'clockwork-edits';
  async function importFile(file) {
    try {
      const d = JSON.parse(await file.text()); if (!d.overrides) throw new Error('no cameras in this file');
      const grade = d.grade ? (d.grade.vals ? d.grade : { base: G_BASE0, vals: d.grade, touched: true }) : null;
      const id = gvId(), name = (d.name || file.name.replace(/\.json$/i, '')).slice(0, 60) || nextName();
      PS.projects[id] = { id, name, created: Date.now(), updated: Date.now(), overrides: d.overrides, grade, notes: d.notes || {}, markers: d.markers || [] };
      await loadWork(PS.projects[id], id);
    } catch (err) { await gvAsk({ title: 'Could not import', text: String(err.message || err), ok: 'OK' }); }
  }
  function renderProjectMenu() {
    renderProjectBar();
    const list = Object.values(PS.projects).sort((a, b) => b.updated - a.updated), p = curProject();
    let h = '<h4>Custom projects</h4>';
    h += list.length ? list.map((q) => `<button class="prow ${q.id === PFROM ? 'on' : ''}" data-open="${q.id}"><div class="tx"><div class="nm">${gvEsc(q.name)}</div><div class="sb">${Object.keys(q.overrides || {}).length} shot edit${Object.keys(q.overrides || {}).length === 1 ? '' : 's'}${q.grade ? ' · colour grade' : ''} · ${ago(q.updated)}</div></div>${q.id === PFROM ? '<span class="ck">open</span>' : ''}</button>`).join('') : '<div class="note">Nothing saved yet. Edit some cameras or the colour grade, then press Save project. It will show up here and on the start page.</div>';
    h += `<hr><div class="btns"><button class="btn" data-pa="new">New blank draft</button>${p ? '<button class="btn" data-pa="saveas">Save as copy…</button><button class="btn" data-pa="rename">Rename</button><button class="btn warn" data-pa="delete">Delete</button>' : ''}</div>`;
    h += '<div class="btns"><button class="btn" data-pa="download">Download file</button><button class="btn" data-pa="import">Import file…</button></div>';
    h += '<div class="note">Projects are kept in this browser. Download a file to back one up or to move it to another device.</div>';
    $g('gvProjMenu').innerHTML = h;
  }
  const projMenu = $g('gvProjMenu');
  const closeProjMenu = () => projMenu.classList.add('hidden');
  $g('gvProjBtn').onclick = (e) => { e.stopPropagation(); renderProjectMenu(); projMenu.classList.toggle('hidden'); };
  addEventListener('pointerdown', (e) => { if (!projMenu.classList.contains('hidden') && !e.target.closest('#gvProj')) closeProjMenu(); }, true);
  projMenu.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.open) { closeProjMenu(); return openProject(t.dataset.open); }
    const a = t.dataset.pa; if (!a) return;
    if (a === 'import') return $g('gvFileIn').click();
    closeProjMenu();
    if (a === 'new') await newProject(); else if (a === 'saveas') await saveProject(true); else if (a === 'rename') await renameProject(); else if (a === 'delete') await deleteProject();
    else if (a === 'download') downloadJSON(fileSlug(curProject()?.name) + '.json', editsJSON());
  });
  $g('gvFileIn').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  $g('gvSaveBtn').onclick = () => saveProject(false);
  $g('gvPlayFilm').onclick = () => {
    persistNow(); const id = PFROM && projState() === 'clean' ? PFROM : 'draft';
    window.open(location.pathname.replace(/[^/]*$/, '') + 'Clockwork_Firefly_fullfilm.html?project=' + encodeURIComponent(id), '_blank');
  };

  /*__GV_STUDIO__*/

  /* ---------- 9. restore saved work, build panels, start ---------- */
  try {
    const ps = readStore();
    if (ps) { PS = ps; PS.projects = PS.projects || {}; }
    else {
      const le = JSON.parse(localStorage.getItem(GV_LS.edits) || 'null'), lg = JSON.parse(localStorage.getItem(GV_LS.grade) || 'null');
      if (le || lg) PS.draft = { overrides: le || clone(SHOT_OVERRIDES), grade: lg && lg.touched ? lg : null, from: null, updated: Date.now() };
    }
    const openId = new URLSearchParams(location.search).get('open');
    if (openId && PS.projects[openId]) applyWork(PS.projects[openId], openId);
    else if (PS.draft) applyWork(PS.draft, PS.draft.from && PS.projects[PS.draft.from] ? PS.draft.from : null);
    else applyWork(baseline(), null);
  } catch (e) { applyWork(baseline(), null); }
  if (Object.keys(gv.ov).length) { for (const t0 of Object.keys(gv.ov)) applyShotOverride(+t0, gv.ov[t0]); sampleRange(0, FILM); computeBounds(); SHOTS.forEach((_, i) => buildShotGlyph(i)); for (const set of Object.keys(GV_RANGES)) buildCamPath(set); }
  gv.tl = gvTimeline(gv);
  renderShotRows(); renderBeatRows(); renderInspector(); renderGrade(); renderExport(); syncChecks();
  gv.tl.fillTrackMenu();
  for (const id of ['start', 'loader']) $g(id)?.classList.add('gone', 'hidden');
  st.started = true; seekTo(GV_SET_TIME.atrium); setPlaying(false);
  $g('gvLTabs').querySelector('button').click();
  setSet('atrium', false); setView('aerial'); selectShot(director.shotAt(st.T), false);
  $g('gvBoot').classList.add('hidden');
  fitStage();
  Object.assign(gv, { setView, setSet, openMap, frameSet, frameShot, startCapture, shotOfSet, keyWorld, rebuildEdit, renderShotRows, state, layers, sm, bounds, cap });
  gv.history = { go: histGo, state: () => ({ at: hist.at, n: hist.stack.length }) }; gv.parseCube = parseCube; gv.importLut = importLut; gv.toast = gvToast; gv.copyCam = copyCam; gv.pasteCam = pasteCam;
  gv.projects = { save: saveProject, open: openProject, create: newProject, state: projState, store: () => PS, from: () => PFROM, persist: persistNow, bar: renderProjectBar };
  renderProjectBar(); persistNow(); histPush(); histButtons();
  gv.dbg = { proxyPos, proxyTgt, camera, renderer, THREE };
  window.__godview = gv;
}
