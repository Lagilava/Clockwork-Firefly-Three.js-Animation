  /* ---------- environment: move, turn, resize and recolour the map's trees, houses and landmarks ----------
     Spliced into godViewInstall() by tools/build-godview.cjs, so it shares the desk's closure (state, camera, controls,
     saveEdits, gvToast, ...). The film does the work (film.env, class EnvMap); this is the panel, the picking and the gizmo. */
  const env = film.env;
  const EV = { sel: null, hover: null, mode: 'translate', q: '', filter: 'all', open: { house: true, tree: true }, active: false, keep: true, snap: false, moveToo: false, listSet: '', t: 0, many: [], plant: null, pRot: true, pSize: true, pGap: 3 };
  const cvs = renderer.domElement;
  let cmpS = null;                                                        // while the original map is being shown (hold V)
  const eBox = $g('gvIEnv');
  const eHex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#888888');
  const eNum = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? +v.toFixed(d) : 0);
  const eKind = (el) => ENV_KINDS[el.kind];
  const eDims = (el) => el.st.s.map((v, i) => eNum(v * el.size0[i], 1));
  const eSetName = (s) => GV_SET_NAMES[s] || s;

  /* --- viewport overlay: selection box, hover box and the gizmo --- */
  const envG = new THREE.Group(); envG.name = 'envEdit'; scene.add(envG);
  const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const mkBox = (col, op) => { const l = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false, toneMapped: false })); l.renderOrder = 22; l.frustumCulled = false; l.visible = false; envG.add(l); return l; };
  const selBox = mkBox(0x6cc4ff, 1), hovBox = mkBox(0xffffff, 0.55), grpBoxes = [];
  const grp = () => (EV.many.length > 1 ? EV.many : null);              // the elements of a multi-selection, or null
  const isSel = (e) => (EV.many.length > 1 ? EV.many.includes(e) : EV.sel === e);
  const movable = (l) => l.filter((e) => !e.locked && !e.st.hide);
  const plantRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 40), new THREE.MeshBasicMaterial({ color: 0x8fe3a0, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
  plantRing.rotation.x = -Math.PI / 2; plantRing.renderOrder = 22; plantRing.visible = false; plantRing.frustumCulled = false; envG.add(plantRing);
  function fitGroup() {
    const g = grp() || [], others = g.filter((e) => e !== EV.sel).slice(0, 120);
    while (grpBoxes.length < others.length) grpBoxes.push(mkBox(0x6cc4ff, 0.6));
    grpBoxes.forEach((b, i) => { if (i < others.length) fitBox(b, others[i], true); else b.visible = false; });
  }
  const proxyEnv = new THREE.Object3D(); scene.add(proxyEnv);
  const tcEnv = new TransformControls(camera, renderer.domElement); tcEnv.setSize(0.85); tcEnv.setSpace('world');
  const helperEnv = tcEnv.getHelper(); scene.add(helperEnv); helperEnv.visible = false; tcEnv.enabled = false;
  const _eb = new THREE.Vector3(), _ec = new THREE.Vector3();
  function fitBox(l, el, noGroup) {
    if (l === selBox && !noGroup) fitGroup();
    const b = el && env.boundsOf(el); if (!b) { l.visible = false; return; }
    b.getCenter(_ec); b.getSize(_eb); l.position.copy(_ec); l.scale.set(_eb.x + 0.12, _eb.y + 0.12, _eb.z + 0.12); l.visible = true;
  }
  function placeProxy() {
    const el = EV.sel, b = el && env.boundsOf(el), g = grp();
    if (cmpS || EV.plant || !el || !EV.active) { tcEnv.detach(); helperEnv.visible = false; tcEnv.enabled = false; return; }
    if (g) { // several elements: one gizmo at their middle, move or turn them together
      const mv = movable(g); if (!mv.length) { tcEnv.detach(); helperEnv.visible = false; tcEnv.enabled = false; return; }
      let cx = 0, cz = 0, cy = 0; for (const e of mv) { const bb = env.boundsOf(e); cx += e.st.p[0]; cz += e.st.p[2]; cy += bb ? bb.getCenter(_ec).y : e.st.p[1]; }
      proxyEnv.position.set(cx / mv.length, cy / mv.length, cz / mv.length); proxyEnv.rotation.set(0, 0, 0); proxyEnv.scale.set(1, 1, 1);
      if (EV.mode === 'scale') EV.mode = 'translate';
      tcEnv.setMode(EV.mode); tcEnv.showX = tcEnv.showZ = EV.mode !== 'rotate'; tcEnv.showY = true;
      tcEnv.setTranslationSnap(EV.snap ? 0.5 : null); tcEnv.setRotationSnap(EV.snap ? THREE.MathUtils.degToRad(15) : null);
      tcEnv.attach(proxyEnv); helperEnv.visible = true; tcEnv.enabled = true; return;
    }
    if (!b || el.locked) { tcEnv.detach(); helperEnv.visible = false; tcEnv.enabled = false; return; }
    proxyEnv.position.set(el.st.p[0], b.getCenter(_ec).y, el.st.p[2]); proxyEnv.rotation.set(0, 0, 0); proxyEnv.scale.set(1, 1, 1);
    tcEnv.setMode(EV.mode); tcEnv.showX = tcEnv.showZ = EV.mode !== 'rotate'; tcEnv.showY = true;
    tcEnv.setTranslationSnap(EV.snap ? 0.5 : null); tcEnv.setRotationSnap(EV.snap ? THREE.MathUtils.degToRad(15) : null); tcEnv.setScaleSnap(EV.snap ? 0.1 : null);
    tcEnv.attach(proxyEnv); helperEnv.visible = true; tcEnv.enabled = true;
  }
  let drag = null;
  tcEnv.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value;
    if (e.value && EV.sel) drag = { st: JSON.parse(JSON.stringify(EV.sel.st)), p0: proxyEnv.position.clone(), grp: grp() ? movable(grp()).map((x) => ({ el: x, st: JSON.parse(JSON.stringify(x.st)) })) : null };
    else if (!e.value) { drag = null; placeProxy(); saveEdits(); renderEnvSel(true); renderEnvList(); }
  });
  tcEnv.addEventListener('objectChange', () => {
    const el = EV.sel; if (!el || !drag) return; const o = drag.st;
    if (drag.grp) {
      const dx = proxyEnv.position.x - drag.p0.x, dy = proxyEnv.position.y - drag.p0.y, dz = proxyEnv.position.z - drag.p0.z, th = proxyEnv.rotation.y, cs = Math.cos(th), sn = Math.sin(th);
      for (const { el: e, st: q } of drag.grp) {
        if (EV.mode === 'rotate') { const rx = q.p[0] - drag.p0.x, rz = q.p[2] - drag.p0.z; env.set(e, { p: [drag.p0.x + rx * cs + rz * sn, q.p[1], drag.p0.z - rx * sn + rz * cs], r: q.r + THREE.MathUtils.radToDeg(th) }); }
        else env.set(e, { p: [q.p[0] + dx, q.p[1] + dy, q.p[2] + dz] });
      }
      fitBox(selBox, EV.sel); envTouched(); return;
    }
    if (EV.mode === 'translate') envChange(el, { p: [o.p[0] + proxyEnv.position.x - drag.p0.x, o.p[1] + proxyEnv.position.y - drag.p0.y, o.p[2] + proxyEnv.position.z - drag.p0.z] }, true);
    else if (EV.mode === 'rotate') envChange(el, { r: o.r + THREE.MathUtils.radToDeg(proxyEnv.rotation.y) }, true);
    else envChange(el, { s: o.s.map((v, i) => clamp(v * [proxyEnv.scale.x, proxyEnv.scale.y, proxyEnv.scale.z][i], 0.02, 60)) }, true);
  });

  /* --- changing things: every change goes through here, so the viewport, monitor, saving and undo all follow --- */
  function envTouched() { gv.dirty = true; pv.dirty = true; saveEdits(); envBadge(); }
  function envChange(el, patch, dragging) {
    if (cmpS) return;
    env.set(el, patch); fitBox(selBox, EV.sel); envTouched();
    if (!dragging) placeProxy();
    syncEnvFields();
  }
  function envBadge() { const n = env.count(), b = document.querySelector('[data-itab=env]'); if (b) b.textContent = n ? `Environment · ${n}` : 'Environment'; }

  /* --- selecting --- */
  function frameEl(el) {
    const b = env.boundsOf(el); if (!b) return; b.getCenter(_ec); b.getSize(_eb);
    const span = Math.max(_eb.x, _eb.y, _eb.z, 3), d = (span * 1.9) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dir = camera.position.clone().sub(controls.target); if (dir.lengthSq() < 1e-6) dir.set(0.55, 0.62, 0.78); dir.normalize();
    controls.target.copy(_ec); camera.position.copy(_ec).addScaledVector(dir, Math.max(d, 8)); controls.update(); gv.dirty = true;
  }
  function envSelect(el, opt = {}) {
    if (el && el.set !== state.set) { state.auto = false; $g('gvAuto').checked = false; setSet(el.set); }
    EV.many = [];
    if (EV.plant) { if (el && el.canAdd) EV.plant = el; else { EV.plant = null; plantRing.visible = false; } renderPlant(); }
    EV.sel = el || null;
    if (el) { EV.open[el.kind] = true; if (opt.frame) frameEl(el); }
    fitBox(selBox, el); placeProxy(); renderEnvList(); renderEnvSel(); renderPlant(); gv.dirty = true; if (opt.top) eBox.scrollTop = 0;
    if (el && opt.scroll !== false) { const row = eBox.querySelector(`[data-eid="${CSS.escape(el.id)}"]`); if (row) row.scrollIntoView({ block: 'nearest' }); }
  }

  function envSelectMany(list) {
    list = [...new Set(list.filter(Boolean))];
    if (list.length < 2) return envSelect(list[0] || null, { scroll: false });
    EV.many = list; EV.sel = list[list.length - 1]; EV.open[EV.sel.kind] = true;
    if (EV.plant) { EV.plant = null; plantRing.visible = false; }
    fitBox(selBox, EV.sel); placeProxy(); renderEnvList(); renderEnvSel(); renderPlant(); gv.dirty = true;
  }
  function envToggle(el) { // Shift-click: add to the selection, or take out of it
    const cur = (grp() || (EV.sel ? [EV.sel] : [])).slice(), i = cur.indexOf(el);
    if (i >= 0) cur.splice(i, 1); else cur.push(el);
    envSelectMany(cur);
  }

  /* --- the outliner --- */
  const eRowMeta = (el) => { const d = eDims(el); return el.kind === 'house' ? `${d[0]} × ${d[2]} m, ${d[1]} m tall` : el.kind === 'landmark' ? `${d[0]} × ${d[2]} m` : `${d[1]} m tall`; };
  function renderEnvList() {
    const box = $g('eList'); if (!box) return; EV.listSet = state.set;
    const els = env.list(state.set), q = EV.q.trim().toLowerCase(), edited = EV.filter === 'edited';
    if (!els.length) { box.innerHTML = state.set === 'atrium' ? '' : '<div class="note">Nothing here.</div>'; $g('eSetNote').innerHTML = state.set === 'atrium' ? `<div class="note edit">The Atrium is all moving clockwork, so it can't be rearranged here. Pick <b>Rooftops</b> or <b>The Glade</b> to edit trees, houses and landmarks.<div class="btns"><button class="btn sm" data-eset="roof">Rooftops</button><button class="btn sm" data-eset="forest">The Glade</button></div></div>` : ''; return; }
    $g('eSetNote').innerHTML = '';
    let h = '';
    for (const kind of env.kinds(state.set)) {
      let list = els.filter((e) => e.kind === kind), total = list.length; if (!total) continue;
      const nEd = list.filter((e) => env.isEdited(e) || e.st.hide).length;
      if (edited) list = list.filter((e) => env.isEdited(e) || e.st.hide);
      if (q) list = list.filter((e) => (e.label + ' ' + eKind(e).title).toLowerCase().includes(q));
      if ((q || edited) && !list.length) continue;
      const open = q || edited ? true : !!EV.open[kind] || (EV.sel && EV.sel.kind === kind);
      h += `<details class="envgrp" data-k="${kind}" ${open ? 'open' : ''}><summary class="sect">${eKind({ kind }).title}<span class="hint">${q || edited ? list.length + ' of ' : ''}${total}${nEd ? ` · ${nEd} changed` : ''}</span></summary>`;
      if (open) {
        h += list.slice(0, 160).map((e) => `<div class="srow envrow${isSel(e) ? ' on' : ''}${e.st.hide ? ' dim' : ''}" data-eid="${gvEsc(e.id)}"><div class="tx"><div class="nm">${gvEsc(e.label)}</div><div class="sb">${gvEsc(eRowMeta(e))}</div></div>${e.st.hide ? '<span class="ed">hidden</span>' : env.isEdited(e) ? '<span class="ed">changed</span>' : ''}</div>`).join('');
        if (list.length > 160) h += `<div class="note">…and ${list.length - 160} more. Type in the search box to narrow it down, or click in the viewport.</div>`;
      }
      h += '</details>';
    }
    const hint = $g('eListHint'); if (hint) hint.textContent = `${eSetName(state.set)} · ${els.length}`;
    box.innerHTML = h || `<div class="note">${edited ? 'Nothing has been changed in this set yet.' : 'Nothing matches that.'}</div>`;
  }

  /* --- the selected element's panel --- */
  const swatch = (el, key) => { const s = el.slots[key]; if (!s) return ''; const cur = el.st[key] || s.base; return `<div class="rg mo"><label for="eC_${key}">${gvEsc(s.label)}</label><span class="ecol"><input type="color" id="eC_${key}" data-ec="${key}" value="${eHex(cur)}"><button class="btn sm" data-ecr="${key}" ${el.st[key] ? '' : 'disabled'} title="Back to the original colour">Original</button></span></div>`; };
  function renderEnvSel(keepCode) {
    const box = $g('eSel'); if (!box) return; const el = EV.sel;
    if (el && grp()) return renderGroup(box);
    if (!el) { box.innerHTML = state.set === 'atrium' ? '' : `<div class="note">Rearrange the map. <b>Click</b> any tree, house or landmark in the viewport, or pick one from the list below. Then drag the gizmo, type exact numbers, or copy its code and paste it onto another element. The film and the monitor change live, and it all saves with your project.</div>`; return; }
    const st = el.st, d = eDims(el), dis = el.locked ? 'disabled' : '';
    let h = `<div class="shead"><h3>${gvEsc(el.label)}</h3><span class="m">${gvEsc(eKind(el).one)}${el.added ? ' · added' : env.isEdited(el) ? ' · changed' : ''}${st.hide ? ' · hidden' : ''}</span></div>`;
    if (el.note) h += `<div class="note edit">${gvEsc(el.note)}</div>`;
    h += `<div class="btns"><button class="btn sm" data-ea="frame" title="Look at it">Frame</button><button class="btn sm" data-ea="dup" ${el.canAdd ? '' : 'disabled'} title="Make a copy (D)">Duplicate</button><button class="btn sm" data-ea="hide" ${dis} title="Hide or show it (H)">${st.hide ? 'Show' : 'Hide'}</button><button class="btn sm warn" data-ea="${el.added ? 'del' : 'reset'}" title="${el.added ? 'Delete this copy (Delete)' : 'Back to how it was authored'}">${el.added ? 'Delete' : 'Reset'}</button></div>`;
    h += `<div class="btns"><button class="btn sm" data-ea="drop" ${dis} title="Sit it back on the ground, after moving it sideways">Drop to ground</button><button class="btn sm" data-ea="similar" title="Select every ${gvEsc(eKind(el).one.toLowerCase())} in this scene, to move, recolour or hide them together">Select all like this</button><button class="btn sm" data-ea="plant" ${el.canAdd ? '' : 'disabled'} title="Click the ground to plant copies of it (P)">Plant copies…</button></div>`;
    h += `<div class="seg mini" id="eModes"><button data-em="translate" class="${EV.mode === 'translate' ? 'on' : ''}" ${dis} title="Drag the arrows to move it">Move</button><button data-em="rotate" class="${EV.mode === 'rotate' ? 'on' : ''}" ${dis} title="Drag the ring to turn it">Turn</button><button data-em="scale" class="${EV.mode === 'scale' ? 'on' : ''}" ${dis} title="Drag the handles to resize it">Size</button></div><label class="chk"><input type="checkbox" id="eSnap" ${EV.snap ? 'checked' : ''}> Snap to a grid</label>`;
    h += `<div class="sect">Position <span class="hint">metres</span></div><div class="xyz"><label title="Across the map">X</label>${['x', 'y', 'z'].map((a, n) => `<input class="num" id="eP${a}" data-ef="p${n}" type="number" step="0.25" value="${eNum(st.p[n])}" ${dis}>`).join('')}</div>`;
    h += `<div class="rg"><label for="eR">Turn</label><input type="range" id="eRs" data-ef="rs" min="-180" max="180" step="1" value="${eNum(((st.r + 540) % 360) - 180, 0)}" ${dis}><output id="eR">${eNum(((st.r % 360) + 360) % 360, 0)}°</output></div>`;
    h += `<div class="sect">Size <span class="hint">metres</span></div><div class="xyz"><label title="Width, height, depth">W H D</label>${['w', 'h', 'd'].map((a, n) => `<input class="num" id="eS${a}" data-ef="s${n}" type="number" min="0.1" step="0.25" value="${d[n]}" ${dis}>`).join('')}</div><label class="chk"><input type="checkbox" id="eKeep" ${EV.keep ? 'checked' : ''} ${dis}> Keep the proportions</label>`;
    if (Object.keys(el.slots).length) h += `<div class="sect">Colour</div>${Object.keys(el.slots).map((k) => swatch(el, k)).join('')}`;
    h += `<div class="sect">Code <span class="hint">copy it, edit it or paste another element's</span></div><textarea class="num ecode" id="eCode" spellcheck="false" autocomplete="off" rows="9"></textarea><div class="envmsg" id="eMsg" role="status"></div>`;
    h += `<div class="btns"><button class="btn sm pri" data-ea="copy" title="Ctrl+C">Copy code</button><button class="btn sm" data-ea="paste" title="Ctrl+V">Paste</button><button class="btn sm" data-ea="addnew" title="Place the code in the box as a new element">Add as new</button></div><label class="chk"><input type="checkbox" id="eMove" ${EV.moveToo ? 'checked' : ''}> Paste also moves it to the copied position</label>`;
    h += `<div class="note">Paste on a different element copies the look: its size and colours. Edit the code above and the map changes as you type. Esc deselects.</div>`;
    box.innerHTML = h; if (!keepCode) fillCode(); else syncEnvFields();
  }
  /* --- several elements selected at once --- */
  const gswatch = (g, key) => { const e0 = g[0], s0 = e0.slots[key]; if (!s0) return ''; const cur = e0.st[key] || s0.base; return `<div class="rg mo"><label for="eG_${key}">${gvEsc(s0.label)}</label><span class="ecol"><input type="color" id="eG_${key}" data-gc="${key}" value="${eHex(cur)}"><button class="btn sm" data-gcr="${key}" title="Back to the original colours">Original</button></span></div>`; };
  function renderGroup(box) {
    const g = grp(), mv = movable(g), dis = mv.length ? '' : 'disabled', kinds = [...new Set(g.map((e) => e.kind))];
    const names = kinds.map((k) => `${g.filter((e) => e.kind === k).length} ${eKind({ kind: k }).title.toLowerCase()}`).join(', '), allAdded = g.every((e) => e.added), anyAdded = g.some((e) => e.added);
    let h = `<div class="shead"><h3>${g.length} selected</h3><span class="m">${gvEsc(names)}</span></div>`;
    h += `<div class="btns"><button class="btn sm" data-ga="dup" ${g.every((e) => e.canAdd) ? '' : 'disabled'} title="Make a copy of each (D)">Duplicate all</button><button class="btn sm" data-ga="hide" title="Hide or show them all (H)">${g.every((e) => e.st.hide) ? 'Show all' : 'Hide all'}</button><button class="btn sm" data-ga="drop" ${dis} title="Sit them back on the ground">Drop to ground</button><button class="btn sm warn" data-ga="reset" title="${anyAdded ? 'Copies are deleted, the others go back to how they were authored' : 'Back to how they were authored'}">${allAdded ? 'Delete all' : anyAdded ? 'Reset or delete' : 'Reset all'}</button></div>`;
    h += `<div class="seg mini" id="eModes"><button data-em="translate" class="${EV.mode !== 'rotate' ? 'on' : ''}" ${dis} title="Drag the arrows to move them together">Move</button><button data-em="rotate" class="${EV.mode === 'rotate' ? 'on' : ''}" ${dis} title="Drag the ring to turn them around their middle">Turn</button></div><label class="chk"><input type="checkbox" id="eSnap" ${EV.snap ? 'checked' : ''}> Snap to a grid</label>`;
    h += `<div class="sect">Line them up</div><div class="btns"><button class="btn sm" data-ga="row" ${mv.length > 1 ? '' : 'disabled'} title="Put them in a straight row, left to right">In a row</button><button class="btn sm" data-ga="col" ${mv.length > 1 ? '' : 'disabled'} title="Put them in a straight line, front to back">In a line</button><button class="btn sm" data-ga="even" ${mv.length > 2 ? '' : 'disabled'} title="Space them evenly between the two furthest apart">Space evenly</button></div>`;
    const keys = kinds.length === 1 ? Object.keys(g[0].slots) : [];
    if (keys.length) h += `<div class="sect">Colour <span class="hint">all ${g.length}</span></div>${keys.map((k) => gswatch(g, k)).join('')}`;
    else if (kinds.length > 1) h += `<div class="note">Pick the same kind of thing to recolour them together.</div>`;
    h += `<div class="note">Shift-click in the viewport, or Ctrl-click in the list, adds or removes one. Esc lets go of all of them.${mv.length < g.length ? ' Locked or hidden ones stay where they are.' : ''}</div>`;
    box.innerHTML = h;
  }
  function groupAction(a) {
    const g = grp(); if (!g) return;
    if (a === 'dup') { const c = g.map((e) => env.duplicate(e)).filter(Boolean); if (!c.length) return gvToast('There is no room for more copies of those.', true); envTouched(); envSelectMany(c); gvToast(`Added ${c.length} copies, next to the originals`); }
    else if (a === 'hide') { const on = !g.every((e) => e.st.hide); g.forEach((e) => { if (!e.locked) env.set(e, { hide: on }); }); envTouched(); fitBox(selBox, EV.sel); placeProxy(); renderEnvSel(); renderEnvList(); }
    else if (a === 'drop') { movable(g).forEach((e) => dropEl(e)); envTouched(); fitBox(selBox, EV.sel); placeProxy(); renderEnvList(); gvToast('Back on the ground'); }
    else if (a === 'reset') { const keep = g.filter((e) => !e.added); g.forEach((e) => { if (e.added) env.remove(e); else env.resetEl(e); }); envTouched(); envSelectMany(keep); gvToast(keep.length < g.length ? 'Copies deleted, the rest are back as authored' : 'Back as authored'); }
    else { // row, col, even
      const mv = movable(g); if (mv.length < 2) return;
      const xs = mv.map((e) => e.st.p[0]), zs = mv.map((e) => e.st.p[2]), avg = (a2) => a2.reduce((x, y) => x + y, 0) / a2.length;
      if (a === 'row') { const z = avg(zs); mv.forEach((e) => env.set(e, { p: [e.st.p[0], e.st.p[1], z] })); }
      else if (a === 'col') { const x = avg(xs); mv.forEach((e) => env.set(e, { p: [x, e.st.p[1], e.st.p[2]] })); }
      else { const ax = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs) ? 0 : 2, srt = mv.slice().sort((p1, p2) => p1.st.p[ax] - p2.st.p[ax]), lo = srt[0].st.p[ax], hi = srt[srt.length - 1].st.p[ax]; srt.forEach((e, i) => { const p = e.st.p.slice(); p[ax] = lo + ((hi - lo) * i) / (srt.length - 1); env.set(e, { p }); }); }
      mv.forEach((e) => dropEl(e)); envTouched(); fitBox(selBox, EV.sel); placeProxy(); renderEnvList();
    }
  }

  /* --- sitting things on the ground --- */
  const groundAt = (set, x, z) => (set === 'forest' ? env.world.forest.heightAt(x, z) : -20);
  function dropEl(el) { // keeps how it stood on the ground when authored, at the new spot
    const t0 = (el.added && env.get(el.tpl)) || el; if (!t0.base) return false;
    const y = t0.base.p[1] + groundAt(el.set, el.st.p[0], el.st.p[2]) - groundAt(el.set, t0.base.p[0], t0.base.p[2]);
    env.set(el, { p: [el.st.p[0], y, el.st.p[2]] }); return true;
  }
  const eCodeText = (el) => JSON.stringify(env.snippet(el), null, 2);
  function fillCode() { const t = $g('eCode'); if (t && EV.sel && document.activeElement !== t) t.value = eCodeText(EV.sel); }
  function syncEnvFields() {
    const el = EV.sel; if (!el) return; const st = el.st, d = eDims(el), set = (id, v) => { const i = $g(id); if (i && document.activeElement !== i) i.value = v; };
    ['x', 'y', 'z'].forEach((a, n) => set('eP' + a, eNum(st.p[n]))); ['w', 'h', 'd'].forEach((a, n) => set('eS' + a, d[n]));
    set('eRs', eNum(((st.r + 540) % 360) - 180, 0)); const o = $g('eR'); if (o) o.textContent = eNum(((st.r % 360) + 360) % 360, 0) + '°';
    for (const k of Object.keys(el.slots)) { set('eC_' + k, eHex(st[k] || el.slots[k].base)); const b = eBox.querySelector(`[data-ecr="${k}"]`); if (b) b.disabled = !st[k]; }
    const m = eBox.querySelector('.shead .m'); if (m) m.textContent = `${eKind(el).one}${el.added ? ' · added' : env.isEdited(el) ? ' · changed' : ''}${st.hide ? ' · hidden' : ''}`;
    const hb = eBox.querySelector('[data-ea=hide]'); if (hb) hb.textContent = st.hide ? 'Show' : 'Hide';
    fillCode();
  }
  const eMsg = (text, kind = '') => { const m = $g('eMsg'); if (m) { m.className = 'envmsg ' + kind; m.innerHTML = text; } };

  /* --- the code snippet: copy, live edit, paste --- */
  const eList = (a) => a.map((x) => gvEsc(x)).join('<br>');
  function applyCode(text, opt = {}) { // text -> the selected element; returns true if applied
    const el = EV.sel; if (!el) { gvToast('Select an element first, or use Add as new.', true); return false; }
    const r = env.parse(text); if (!r.ok) { eMsg(gvEsc(r.error), 'err'); return false; }
    const same = !r.data.id || r.data.id === el.id, look = !opt.full && !same && !EV.moveToo;
    const c = env.check(el, r.data, { look });
    if (c.errors.length) { eMsg(eList(c.errors), 'err'); return false; }
    envChange(el, c.patch);
    const msg = `Applied${look ? ': the size and colours from ' + gvEsc(r.data.what || 'the code') + ' (this one stayed where it is)' : ''} ✓${c.notes.length ? '<br>' + eList(c.notes) : ''}`;
    if (!opt.live) renderEnvSel(true); eMsg(msg, 'ok'); renderEnvList(); return true;
  }
  function addFromCode(text) {
    const r = env.parse(text); if (!r.ok) { gvToast(r.error, true); return false; }
    const d = r.data, want = Object.keys(ENV_KINDS).find((k) => ENV_KINDS[k].one === d.what) || (EV.sel && EV.sel.kind);
    let tpl = d.id && env.get(d.id); if (tpl && tpl.added) tpl = env.get(tpl.tpl);
    if (!tpl || !tpl.canAdd) tpl = EV.sel && EV.sel.kind === want ? EV.sel : env.list(state.set).find((e) => e.kind === want && e.canAdd) || env.els.find((e) => e.kind === want && e.canAdd);
    if (!tpl || !tpl.canAdd) { gvToast('This code is for something that cannot be added (landmarks stay as they are).', true); return false; }
    const el = env.duplicate(tpl); if (!el) { gvToast('There is no room for more copies of that.', true); return false; }
    const c = env.check(el, d, {});
    if (c.errors.length) { env.remove(el); gvToast(c.errors[0], true); envTouched(); return false; }
    env.set(el, c.patch); envTouched(); envSelect(el, { frame: true }); gvToast(`Added ${el.label}`); return true;
  }
  async function copyEl(el) {
    const t = eCodeText(el);
    try { await navigator.clipboard.writeText(t); gvToast(`Copied the code for ${el.label}. Paste it onto another element, or into a message.`); }
    catch (e) { const c = $g('eCode'); if (c) { c.value = t; c.select(); } gvToast('Your browser blocked the clipboard. The code is selected: press Ctrl+C.', true); }
  }
  async function pasteEl() {
    let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { gvToast('Your browser blocked reading the clipboard. Click in the code box and press Ctrl+V.', true); const c = $g('eCode'); if (c) c.focus(); return; }
    if (!t.trim()) return gvToast('The clipboard is empty. Copy an element first.', true);
    if (EV.sel) applyCode(t, {}); else addFromCode(t);
  }
  // Ctrl+C / Ctrl+V with the map open work on the selected element, through the browser's own copy and paste events
  addEventListener('copy', (e) => {
    if (!EV.active || !EV.sel) return; const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.selectionStart !== a.selectionEnd) return;
    e.clipboardData.setData('text/plain', eCodeText(EV.sel)); e.preventDefault(); gvToast(`Copied the code for ${EV.sel.label}`);
  });
  addEventListener('paste', (e) => {
    if (!EV.active) return; const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'range' && a.type !== 'checkbox'))) return;
    const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (!t || !t.trim()) return; e.preventDefault();
    if (EV.sel) applyCode(t, {}); else addFromCode(t);
  });
  let codeTimer = 0;
  eBox.addEventListener('input', (e) => {
    const t = e.target, el = EV.sel;
    if (t.id === 'eCode') { clearTimeout(codeTimer); codeTimer = setTimeout(() => applyCode(t.value, { live: true, full: true }), 280); return; }
    if (t.id === 'eFind') { EV.q = t.value; renderEnvList(); return; }
    if (t.dataset.gc && grp()) { for (const x of grp()) { const sl = x.slots[t.dataset.gc]; if (sl) env.set(x, { [t.dataset.gc]: t.value.toLowerCase() === sl.base ? null : t.value.toLowerCase() }); } envTouched(); renderEnvList(); return; }
    if (t.id === 'ePGap') { EV.pGap = +t.value; const o = $g('ePGapV'); if (o) o.textContent = EV.pGap + ' m'; return; }
    if (!el || el.locked && !t.dataset.ec) return;
    if (t.dataset.ec) { envChange(el, { [t.dataset.ec]: t.value.toLowerCase() === el.slots[t.dataset.ec].base ? null : t.value.toLowerCase() }); renderEnvList(); return; }
    const f = t.dataset.ef; if (!f) return; const v = parseFloat(t.value); if (!isFinite(v)) return;
    if (f[0] === 'p') { const p = el.st.p.slice(); p[+f[1]] = clamp(v, -2000, 2000); envChange(el, { p }); }
    else if (f === 'rs') envChange(el, { r: v });
    else if (f[0] === 's') {
      const n = +f[1]; if (v <= 0) return; let ratio = v / (el.size0[n] * el.st.s[n]); const s = el.st.s.slice();
      if (EV.keep) for (let i = 0; i < 3; i++) s[i] = clamp(s[i] * ratio, 0.02, 60); else s[n] = clamp(s[n] * ratio, 0.02, 60);
      envChange(el, { s });
    }
    renderEnvList(); fillCode();
  });
  eBox.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'ePRot') EV.pRot = t.checked; else if (t.id === 'ePSize') EV.pSize = t.checked; else if (t.id === 'eSnap') { EV.snap = t.checked; placeProxy(); } else if (t.id === 'eKeep') EV.keep = t.checked; else if (t.id === 'eMove') EV.moveToo = t.checked;
  });
  eBox.addEventListener('toggle', (e) => { const d = e.target; if (d.classList && d.classList.contains('envgrp')) { const k = d.dataset.k; if (EV.open[k] !== d.open && !EV.q && EV.filter === 'all') { EV.open[k] = d.open; renderEnvList(); } } }, true);
  eBox.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.target.blur(); return; } });
  eBox.addEventListener('dblclick', (e) => { const row = e.target.closest('[data-eid]'); const el = row && env.get(row.dataset.eid); if (el) { envSelect(el, { frame: true }); } });
  eBox.addEventListener('click', async (e) => {
    const t = e.target.closest('button'), row = e.target.closest('[data-eid]');
    if (t && t.dataset.eset) { state.auto = false; $g('gvAuto').checked = false; setSet(t.dataset.eset); renderEnvList(); renderEnvSel(); return; }
    if (t && t.dataset.ef !== undefined && t.closest('#eChips')) { EV.filter = t.dataset.ef; eBox.querySelectorAll('#eChips button').forEach((b) => b.classList.toggle('on', b === t)); renderEnvList(); return; }
    if (t && t.dataset.em) { EV.mode = t.dataset.em; eBox.querySelectorAll('#eModes button').forEach((b) => b.classList.toggle('on', b === t)); placeProxy(); return; }
    if (t && t.dataset.ecr && EV.sel) { envChange(EV.sel, { [t.dataset.ecr]: null }); renderEnvSel(true); renderEnvList(); return; }
    if (t && t.dataset.ga) return groupAction(t.dataset.ga);
    if (t && t.dataset.gcr && grp()) { grp().forEach((x) => { if (x.slots[t.dataset.gcr]) env.set(x, { [t.dataset.gcr]: null }); }); envTouched(); renderEnvSel(); renderEnvList(); return; }
    if (t && t.dataset.ea && EV.sel) return envAction(t.dataset.ea);
    if (t && t.id === 'ePlant') return EV.plant ? plantStop() : EV.sel && EV.sel.canAdd && !grp() ? plantStart(EV.sel) : gvToast('Select one tree, pine, rock or fern first, then press Plant.', true);
    if (t && t.id === 'ePlantStop') return plantStop();
    if (t && t.dataset.look) return applyLook(t.dataset.look);
    if (t && t.id === 'eCopyAll') return copyAll();
    if (t && t.id === 'eApplyAll') return applyAll();
    if (t && t.id === 'eResetAll') return resetAll();
    if (row && !t) { const el = env.get(row.dataset.eid); if (el) { if (e.shiftKey || e.ctrlKey || e.metaKey) envToggle(el); else envSelect(el, { scroll: false }); } }
  });
  function envAction(a) {
    const el = EV.sel; if (!el) return false;
    if (a === 'frame') frameEl(el);
    else if (a === 'dup') { const c = env.duplicate(el); if (!c) { gvToast('There is no room for more copies of that.', true); return true; } envTouched(); envSelect(c, { frame: false }); gvToast(`Added ${c.label}, next to the original`); }
    else if (a === 'hide') { envChange(el, { hide: !el.st.hide }); renderEnvSel(true); renderEnvList(); }
    else if (a === 'reset') { env.resetEl(el); envTouched(); fitBox(selBox, el); placeProxy(); renderEnvSel(); renderEnvList(); gvToast(`${el.label} is back as authored`); }
    else if (a === 'del') { env.remove(el); envTouched(); envSelect(null); gvToast('Deleted the copy'); }
    else if (a === 'drop') { dropEl(el); envTouched(); fitBox(selBox, el); placeProxy(); syncEnvFields(); renderEnvList(); gvToast(`${el.label} is back on the ground`); }
    else if (a === 'similar') { const all = env.list(state.set).filter((e) => e.kind === el.kind && !e.st.hide); envSelectMany(all); gvToast(`Selected ${all.length} ${eKind(el).title.toLowerCase()}`); }
    else if (a === 'plant') plantStart(el);
    else if (a === 'copy') copyEl(el);
    else if (a === 'paste') pasteEl();
    else if (a === 'addnew') { const c = $g('eCode'); addFromCode(c ? c.value : ''); }
    return true;
  }
  /* --- everything at once --- */
  const allWrap = (d) => JSON.stringify({ clockwork: 'map-changes', env: d }, null, 1);
  async function copyAll() {
    const d = env.serialize(); if (!d) return gvToast('Nothing has been changed yet.', true); const t = allWrap(d);
    try { await navigator.clipboard.writeText(t); gvToast(`Copied all ${env.count()} map changes`); } catch (e) { const a = $g('eAllText'); a.value = t; a.select(); gvToast('Your browser blocked the clipboard. The code is selected: press Ctrl+C.', true); }
  }
  function applyAll() {
    const r = env.parse($g('eAllText').value); if (!r.ok) return gvToast(r.error, true);
    const d = r.data.env || (r.data.edits || r.data.added ? r.data : null); if (!d || typeof d !== 'object') return gvToast('That is not a list of map changes. Use "Copy all changes" to get one.', true);
    const t = (x) => (x && typeof x === 'object' ? x : {}), bad = Object.keys(t(d.edits)).filter((k) => !env.get(k));
    env.load(d); envTouched(); EV.sel = null; fitBox(selBox, null); placeProxy(); renderEnvList(); renderEnvSel();
    gvToast(`Applied ${env.count()} changes${bad.length ? ` (${bad.length} did not match anything in this film and were skipped)` : ''}`, bad.length > 0);
  }
  async function resetAll() {
    if (!env.count()) return gvToast('Nothing to reset.');
    if (!(await gvAsk({ title: 'Put the whole map back?', text: `All ${env.count()} changed or added elements go back to how the film was authored. You can undo this with Ctrl+Z.`, ok: 'Reset the map', danger: true }))) return;
    env.load(null); EV.sel = null; fitBox(selBox, null); placeProxy(); envTouched(); renderEnvList(); renderEnvSel();
  }

  /* --- see the original: hold V, or hold the Compare button. The edits are only set aside, never lost. --- */
  const cmpEl = document.createElement('div'); cmpEl.id = 'envCmp'; cmpEl.className = 'hidden'; cmpEl.innerHTML = '<b>Original map</b> · let go to bring your changes back'; $g('gvStage').appendChild(cmpEl);
  function cmpStart() {
    if (cmpS || !EV.active) return; if (!env.count()) { gvToast('Nothing has been changed yet, so there is nothing to compare.'); return; }
    const d = JSON.parse(JSON.stringify(env.serialize())), ids = EV.many.map((x) => x.id), sid = EV.sel && EV.sel.id;
    cmpS = { d, ids, sid }; env.serialize = () => d; // saving or exporting meanwhile still sees the real changes
    env.load(null); tcEnv.detach(); helperEnv.visible = false; tcEnv.enabled = false; selBox.visible = false; grpBoxes.forEach((b) => { b.visible = false; });
    cmpEl.classList.remove('hidden'); const b = $g('eCmp'); if (b) b.classList.add('on'); gv.dirty = true; pv.dirty = true;
  }
  function cmpEnd() {
    if (!cmpS) return; const c = cmpS; cmpS = null; delete env.serialize; env.load(JSON.parse(JSON.stringify(c.d)));
    EV.sel = c.sid ? env.get(c.sid) : null; EV.many = c.ids.map((i) => env.get(i)).filter(Boolean); if (EV.many.length < 2) EV.many = [];
    cmpEl.classList.add('hidden'); const b = $g('eCmp'); if (b) b.classList.remove('on');
    fitBox(selBox, EV.sel); placeProxy(); renderEnvList(); renderEnvSel(); gv.dirty = true; pv.dirty = true;
  }
  addEventListener('keyup', (e) => { if (cmpS && e.key.toLowerCase() === 'v') cmpEnd(); });
  addEventListener('blur', () => cmpEnd());

  /* --- planting: click the ground (or drag along it) to place copies of the selected element --- */
  function plantStart(el) {
    if (!el || !el.canAdd) return gvToast('That kind of element cannot be copied.', true);
    EV.plant = el; EV.many = []; placeProxy(); renderPlant(); renderEnvSel(); eBox.scrollTop = 0; cvs.style.cursor = 'crosshair'; gv.dirty = true;
  }
  function plantStop() { EV.plant = null; plantRing.visible = false; cvs.style.cursor = ''; placeProxy(); renderPlant(); gv.dirty = true; }
  function renderPlant() {
    const box = $g('ePlantBox'), b = $g('ePlant'); if (b) b.classList.toggle('on', !!EV.plant); if (!box) return;
    if (!EV.plant) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="note edit plantnote"><b>Planting ${gvEsc(eKind(EV.plant).title.toLowerCase())}</b> like ${gvEsc(EV.plant.label)}. <b>Click the ground</b> to plant one, or <b>drag</b> along it to paint several. Dragging the view turns off while you plant: use the right mouse button to look around. Esc or Stop to finish.
      <div class="rg"><label for="ePGap">Spacing</label><input type="range" id="ePGap" min="1" max="12" step="0.5" value="${EV.pGap}"><output id="ePGapV">${EV.pGap} m</output></div>
      <label class="chk"><input type="checkbox" id="ePRot" ${EV.pRot ? 'checked' : ''}> Turn each one a different way</label><label class="chk"><input type="checkbox" id="ePSize" ${EV.pSize ? 'checked' : ''}> Vary the sizes a little</label>
      <div class="btns"><button class="btn sm pri" id="ePlantStop">Stop planting</button></div></div>`;
  }
  const _gr = new THREE.Raycaster(), _gn = new THREE.Vector2(), _nm = new THREE.Vector3();
  function groundPick(cx, cy) { // the ground under the pointer: not a tree, house or grass blade
    const r = renderer.domElement.getBoundingClientRect(), grpObj = env.world.sets[state.set] && env.world.sets[state.set].group; if (!grpObj) return null;
    _gn.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); _gr.setFromCamera(_gn, camera);
    for (const h of _gr.intersectObject(grpObj, true)) {
      if (h.object.isInstancedMesh || h.object.isPoints || h.object.isLine) continue;
      let own = false; for (let o = h.object; o && o !== grpObj; o = o.parent) if (env.objIdx.get(o)) { own = true; break; } if (own) continue;
      if (!h.face) continue; _nm.copy(h.face.normal).transformDirection(h.object.matrixWorld); if (_nm.y < 0.4) continue;
      if (Math.abs(h.point.y - groundAt(state.set, h.point.x, h.point.z)) > (state.set === 'forest' ? 2 : 0.8)) continue;
      return h.point;
    }
    return null;
  }
  function plantOne(pt) {
    const tpl = EV.plant, t0 = (tpl.added && env.get(tpl.tpl)) || tpl, el = env.duplicate(t0); if (!el) return null;
    const js = EV.pSize ? 0.8 + Math.random() * 0.4 : 1, y = t0.base.p[1] + groundAt(tpl.set, pt.x, pt.z) - groundAt(tpl.set, t0.base.p[0], t0.base.p[2]);
    env.set(el, { p: [pt.x, y, pt.z], r: tpl.st.r + (EV.pRot ? Math.random() * 360 : 0), s: tpl.st.s.map((v) => clamp(v * js, 0.02, 60)), c: tpl.st.c, c2: tpl.st.c2 }); return el;
  }
  let stroke = null;
  function plantAt(e) {
    const pt = groundPick(e.clientX, e.clientY); if (!pt) { if (!stroke.warned) { stroke.warned = true; gvToast('Aim at the ground to plant.', true); } return; }
    if (stroke.last && Math.hypot(pt.x - stroke.last.x, pt.z - stroke.last.z) < EV.pGap) return;
    const el = plantOne(pt); if (!el) { if (!stroke.full) { stroke.full = true; gvToast('That is the most copies of this kind that fit. Delete some to plant more.', true); } return; }
    stroke.last = pt.clone(); stroke.n++; gv.dirty = true; pv.dirty = true; envBadge();
  }
  cvs.addEventListener('pointerdown', (e) => {
    if (!EV.plant || !EV.active || e.button !== 0) return; e.stopImmediatePropagation(); e.preventDefault();
    try { cvs.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
    stroke = { n: 0, last: null }; plantAt(e);
  }, true);
  cvs.addEventListener('pointermove', (e) => { if (stroke && EV.plant && (e.buttons & 1)) plantAt(e); }, true);
  const plantEnd = () => { if (!stroke) return; const n = stroke.n; stroke = null; if (n) { envTouched(); renderEnvList(); gvToast(`Planted ${n}`); } };
  cvs.addEventListener('pointerup', plantEnd, true); cvs.addEventListener('pointercancel', plantEnd, true);

  /* --- quick looks: autumn, frost, or back to the original colours, for every tree, fern and rock in this scene --- */
  const LOOKS = {
    autumn: { tree: ['#b8521c', '#d28a1f', '#9c2f17', '#c9a227', '#7a4a1a'], fern: ['#8a6a2c', '#a07a2a', '#7c5a24'], pine: null, rock: null },
    frost: { tree: ['#d5e3e8', '#c3d6dc', '#e6eef0'], fern: ['#aebfc2', '#c0d0d4'], pine: ['#b9ccd2', '#a9bfc6', '#c8d8dc'], rock: ['#aab3b8', '#9aa4aa'] },
  };
  function applyLook(name) {
    const L = LOOKS[name]; let n = 0;
    for (const e of env.list(state.set)) {
      if (e.st.hide) continue;
      if (name === 'original') { if (e.st.c || e.st.c2) { if (e.locked && !Object.keys(e.slots).length) continue; env.set(e, { c: null, c2: null }); n++; } continue; }
      const pal = L[e.kind]; if (!pal || !e.slots.c) continue;
      const idx = (parseInt((e.id.match(/(\d+)$/) || [0, 0])[1], 10) * 7 + 3) % pal.length; env.set(e, { c: pal[idx] }); n++;
    }
    if (!n) return gvToast(name === 'original' ? 'No colours have been changed here.' : 'Nothing in this scene takes that look. Try The Glade.', true);
    envTouched(); renderEnvList(); renderEnvSel(); gvToast(name === 'original' ? 'Colours are back as authored' : `Gave ${n} elements the ${name} look. Ctrl+Z undoes it.`);
  }

  /* --- the tab itself --- */
  eBox.innerHTML = `<div class="envbar" id="eBar"><button class="btn sm" id="eCmp" title="Press and hold to see the original map. Let go to bring your changes back. (Hold V)">Hold to see the original</button><button class="btn sm" id="ePlant" title="Click the ground to plant copies of the selected tree, pine, rock or fern (P)">Plant</button></div><div id="ePlantBox"></div><div id="eSetNote"></div>
    <div id="eSel"></div>
    <details class="fold" id="eListBox" open><summary class="sect">All elements <span class="hint" id="eListHint"></span></summary>
      <input type="search" id="eFind" class="num" placeholder="Find a house, tree, lamp…" autocomplete="off" spellcheck="false"><div class="chips" id="eChips" style="margin:6px 0"><button data-ef="all" class="on">All</button><button data-ef="edited">Changed</button></div>
      <div class="envlist" id="eList"></div></details>
    <details class="fold" id="eLookBox"><summary class="sect">Quick looks <span class="hint">recolour a whole scene</span></summary>
      <div class="btns"><button class="btn sm" data-look="autumn">Autumn</button><button class="btn sm" data-look="frost">Frost</button><button class="btn sm" data-look="original">Original colours</button></div>
      <div class="note">Gives every tree, fern, pine and rock in this scene a new colour in one go. Undo with Ctrl+Z.</div></details>
    <details class="fold" id="eAllBox"><summary class="sect">Everything at once <span class="hint">copy or paste all changes</span></summary>
      <textarea class="num" id="eAllText" rows="5" spellcheck="false" placeholder="Paste a list of map changes here, then press Apply"></textarea>
      <div class="btns"><button class="btn sm pri" id="eCopyAll">Copy all changes</button><button class="btn sm" id="eApplyAll">Apply pasted changes</button><button class="btn sm warn" id="eResetAll">Reset the whole map</button></div></details>`;
  function envSetActive(on) {
    EV.active = on; if (on && gv.pages && gv.pages.now() === 'cut') gv.pages.set('map');
    if (on) { if (gv.editOn) { gv.editOn = false; gv.pinned = false; rebuildEdit(); renderInspector(); } state.auto = false; $g('gvAuto').checked = false; renderEnvList(); renderEnvSel(); }
    else { hovBox.visible = false; $g('gvTip').classList.add('hidden'); }
    selBox.visible = on && !!EV.sel; placeProxy(); gv.dirty = true;
  }
  { const cb = $g('eCmp'); const up = () => cmpEnd(); cb.addEventListener('pointerdown', (e) => { e.preventDefault(); cmpStart(); try { cb.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } }); cb.addEventListener('pointerup', up); cb.addEventListener('pointercancel', up); cb.addEventListener('lostpointercapture', up); cb.addEventListener('click', (e) => e.stopPropagation()); }
  gv.envTab = envSetActive;
  Object.defineProperty(gv, 'envMode', { get: () => EV.active });
  gv.envRefresh = () => { if (cmpS) cmpEnd(); EV.sel = EV.sel ? env.get(EV.sel.id) : null; EV.many = EV.many.map((x) => env.get(x.id)).filter(Boolean); if (EV.many.length < 2) EV.many = []; if (EV.plant && !env.get(EV.plant.id)) EV.plant = null; fitBox(selBox, EV.sel); envBadge(); if (EV.active) { renderEnvList(); renderEnvSel(); placeProxy(); } gv.dirty = true; };
  gv.envSummary = () => { const n = env.count(); return `<div class="sect">Map <span class="hint">${n}</span></div>` + (n ? `<div class="srow"><div class="tx"><div class="nm">${n} element${n === 1 ? '' : 's'} moved, resized, recoloured or added</div><div class="sb">Trees, houses and landmarks. Open the Environment tab to see them.</div></div><button class="btn sm warn" id="xEnvReset">Reset</button></div>` : '<div class="note">The map is as authored. Open the Environment tab to move trees, houses and landmarks.</div>'); };
  gv.envApi = { env, EV, tc: tcEnv, proxy: proxyEnv, select: envSelect, change: envChange, applyCode, addFromCode, frame: frameEl, setActive: envSetActive, pick: (x, y) => pickAt(x, y), action: envAction, selectMany: envSelectMany, toggle: envToggle, group: groupAction, drop: dropEl, compare: (on) => (on ? cmpStart() : cmpEnd()), plantStart, plantStop, plantAt: (pt) => { stroke = { n: 0, last: null }; const el = EV.plant && plantOne(pt); if (el) { envTouched(); } stroke = null; return el; }, ground: (x, y) => groundPick(x, y), look: applyLook };

  /* --- picking in the viewport --- */
  const rc = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); rc.setFromCamera(ndc, camera);
    return env.pick(rc, state.set, state.clipOn ? (h) => h.point.y <= state.clipY : null);
  }
  let downAt2 = null, hoverBusy = 0;
  cvs.addEventListener('pointerdown', (e) => { downAt2 = e.button === 0 ? { x: e.clientX, y: e.clientY, gizmo: !!tcEnv.axis } : null; });
  cvs.addEventListener('pointerup', (e) => {
    if (!EV.active || !downAt2) return; const d = downAt2; downAt2 = null;
    if (d.gizmo || tcEnv.dragging || EV.plant || cmpS || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const hit = pickAt(e.clientX, e.clientY);
    if (hit && (e.shiftKey || e.ctrlKey || e.metaKey)) envToggle(hit.el);
    else if (hit) envSelect(hit.el, { top: true }); else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) envSelect(null);
  });
  cvs.addEventListener('pointermove', (e) => {
    if (!EV.active || e.buttons || tcEnv.dragging || tcEnv.axis || performance.now() - hoverBusy < 70) return; hoverBusy = performance.now();
    if (EV.plant) { const pt = groundPick(e.clientX, e.clientY); if (pt) { plantRing.position.set(pt.x, pt.y + 0.08, pt.z); plantRing.scale.setScalar(Math.max(0.5, EV.pGap / 2)); plantRing.visible = true; cvs.style.cursor = 'crosshair'; } else { plantRing.visible = false; cvs.style.cursor = 'not-allowed'; } hovBox.visible = false; $g('gvTip').classList.add('hidden'); gv.dirty = true; return; }
    const hit = pickAt(e.clientX, e.clientY), tip = $g('gvTip');
    if (hit) cvs.style.cursor = 'pointer';
    if (hit && hit.el !== EV.sel) { EV.hover = hit.el; fitBox(hovBox, hit.el); tip.innerHTML = `<b>${gvEsc(hit.el.label)}</b><br>${gvEsc(eKind(hit.el).one)}${env.isEdited(hit.el) ? ' · changed' : ''}`; tip.style.left = Math.min(innerWidth - 190, e.clientX + 14) + 'px'; tip.style.top = Math.min(innerHeight - 90, e.clientY + 14) + 'px'; tip.classList.remove('hidden'); }
    else { EV.hover = null; hovBox.visible = false; cvs.style.cursor = ''; tip.classList.add('hidden'); }
    gv.dirty = true;
  });
  cvs.addEventListener('pointerleave', () => { hovBox.visible = false; EV.hover = null; gv.dirty = true; });

  /* --- keys: D duplicates, H hides, Delete removes, Esc lets go (only while the Environment tab is open and something is selected) --- */
  const prevKeyEnv = gv.studioKey;
  gv.studioKey = (k, e) => {
    if (EV.active && !e.shiftKey && k === 'v' && !e.repeat) { cmpStart(); return true; }
    if (EV.active && !e.shiftKey && k === 'v') return true;
    if (EV.active && EV.sel && !e.shiftKey) {
      if (k === 'p') { if (EV.plant) plantStop(); else if (!grp() && EV.sel.canAdd) plantStart(EV.sel); else gvToast('Select one tree, pine, rock or fern first, then press P.', true); return true; }
      if (grp()) {
        if (k === 'd') { groupAction('dup'); return true; }
        if (k === 'h') { groupAction('hide'); return true; }
        if (k === 'delete' || k === 'backspace') { const g = grp(); g.forEach((x) => { if (x.added) env.remove(x); else if (!x.locked) env.set(x, { hide: true }); }); envTouched(); envSelectMany(g.filter((x) => !x.added)); return true; }
      } else {
        if (k === 'd') return envAction('dup');
        if (k === 'h') return envAction('hide');
        if (k === 'delete' || k === 'backspace') return envAction(EV.sel.added ? 'del' : 'hide');
      }
    }
    return prevKeyEnv ? prevKeyEnv(k, e) : false;
  };
  const prevEscEnv = gv.onEscape; gv.onEscape = () => { if (prevEscEnv) prevEscEnv(); if (EV.plant) plantStop(); else if (EV.active && EV.sel) envSelect(null); };
  setInterval(() => { if (EV.active && EV.listSet !== state.set) { if (EV.sel && EV.sel.set !== state.set) { EV.sel = null; fitBox(selBox, null); placeProxy(); } renderEnvList(); renderEnvSel(); } }, 400);
  document.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => setTimeout(() => { if (EV.active) { renderEnvList(); renderEnvSel(); } }, 0)));
  envBadge();
