  /* ---------- 8b. studio tools: loop and shuttle, frame guides, preview quality, versions, and range export ----------
     Spliced into godViewInstall() by tools/build-godview.cjs, so it shares the desk's closure (st, pv, snapshot, applyWork, ...). */

  /* --- playback range, loop and J/K/L shuttle --- */
  const rng = gv.range = { a: null, b: null, loop: false };
  const sh = { rate: 0 };
  const hasRange = () => rng.a != null && rng.b != null && rng.b - rng.a > 0.05;
  const spanNow = gv.spanNow = () => (hasRange() ? { a: rng.a, b: rng.b, kind: 'range' } : { a: SHOTS[gv.sel].t0, b: SHOTS[gv.sel].t1, kind: 'shot' });
  const fmtSpan = (s) => `${gvFmtF(s.a)} – ${gvFmtF(s.b)} · ${(s.b - s.a).toFixed(1)} s`;
  function rangeUI() {
    const info = $g('gvRangeInfo'), sp = spanNow();
    info.textContent = hasRange() ? fmtSpan(sp) : rng.a != null ? `In ${gvFmtF(rng.a)} · set Out (O)` : rng.b != null ? `Out ${gvFmtF(rng.b)} · set In (I)` : 'No range · uses the selected shot';
    info.classList.toggle('on', hasRange());
    $g('gvRangeClr').disabled = rng.a == null && rng.b == null;
    for (const id of ['gvLoopBtn']) { $g(id).classList.toggle('on', rng.loop); $g(id).setAttribute('aria-pressed', String(rng.loop)); }
    gv.dirty = true;
  }
  function markIn() { rng.a = st.T; if (rng.b != null && rng.b <= rng.a + 0.05) rng.b = null; rangeUI(); gvToast(`In point ${gvFmtF(rng.a)}`); }
  function markOut() { rng.b = st.T; if (rng.a != null && rng.a >= rng.b - 0.05) rng.a = null; rangeUI(); gvToast(`Out point ${gvFmtF(rng.b)}`); }
  function clearRange() { rng.a = rng.b = null; rangeUI(); }
  function rangeFromShot() { const s = SHOTS[gv.sel]; rng.a = s.t0; rng.b = s.t1; rangeUI(); gvToast(`Range set to shot ${gv.sel + 1}`); }
  function toggleLoop() { rng.loop = !rng.loop; rangeUI(); const sp = spanNow(); gvToast(rng.loop ? `Looping ${sp.kind === 'range' ? 'the range' : 'shot ' + (gv.sel + 1)}` : 'Loop off'); }
  $g('gvIn').onclick = markIn; $g('gvOut').onclick = markOut; $g('gvRangeClr').onclick = clearRange; $g('gvRangeShot').onclick = rangeFromShot; $g('gvLoopBtn').onclick = toggleLoop;

  const syncSpeedSel = () => { const sel = $g('gvSpeed'), v = String(st.speed); if ([...sel.options].some((o) => o.value === v)) sel.value = v; };
  function shuttleBadge() { const b = $g('gvShuttle'); b.textContent = sh.rate === 0 || sh.rate === 1 ? '' : (sh.rate < 0 ? '◀◀ ' : '▶▶ ') + Math.abs(sh.rate) + '×'; b.classList.toggle('hidden', !b.textContent); }
  function shuttle(dir) {
    const r = sh.rate;
    if (dir > 0) { sh.rate = r <= 0 ? 1 : Math.min(4, r * 2); st.speed = sh.rate; setPlaying(true); }
    else { sh.rate = r >= 0 ? -1 : Math.max(-4, r * 2); st.speed = 1; setPlaying(false); }
    gv.pinned = false; syncSpeedSel(); shuttleBadge();
  }
  function shuttleStop() { sh.rate = 0; st.speed = 1; setPlaying(false); syncSpeedSel(); shuttleBadge(); }
  $g('gvSpeed').addEventListener('change', () => { sh.rate = 0; shuttleBadge(); });
  { let last = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick); const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (xp.active || document.hidden) return;
      if ((sh.rate > 0 && !st.playing) || (sh.rate < 0 && st.playing)) { sh.rate = 0; st.speed = 1; syncSpeedSel(); shuttleBadge(); } // Space or a click took over
      const sp = spanNow();
      if (sh.rate < 0) {
        let T = st.T + sh.rate * dt;
        if (rng.loop && T <= sp.a) T = sp.b - 0.05;
        if (T <= 0) { T = 0; sh.rate = 0; shuttleBadge(); }
        seekTo(T);
      } else if (rng.loop && st.playing && st.T >= sp.b - 0.03) seekTo(sp.a + 0.001);
    };
    requestAnimationFrame(tick); }
  gv.shuttle = shuttle; gv.shuttleState = sh; gv.toggleLoop = toggleLoop;

  gv.studioKey = (k) => {
    if (k === 'j') { shuttle(-1); return true; }
    if (k === 'l') { shuttle(1); return true; }
    if (k === 'k') { if (gv.editOn) return false; shuttleStop(); return true; } // while editing a camera, K still adds a keyframe
    if (k === 'r') { toggleLoop(); return true; }
    if (k === 'i') { markIn(); return true; }
    if (k === 'o') { markOut(); return true; }
    if (k === 'x') { clearRange(); return true; }
    if (k === '\\') { flip(); return true; }
    return false;
  };

  /* --- frame guides: aspect crop, thirds, safe areas, centre --- */
  const GUIDE_ASPECTS = [['off', 'Full frame'], ['16:9', '16:9 · film, YouTube'], ['2.39:1', '2.39:1 · cinemascope'], ['4:5', '4:5 · feed post'], ['1:1', '1:1 · square'], ['9:16', '9:16 · vertical, reels']];
  const guide = gv.guide = Object.assign({ aspect: 'off', thirds: false, safe: false, center: false }, lay.guide || {});
  const aspectVal = (a) => { if (a === 'off') return 16 / 9; const [w, h] = a.split(':').map(parseFloat); return w / h; };
  const cropFor = (a) => { const A = 16 / 9, v = aspectVal(a); return v >= A ? { w: 1, h: A / v } : { w: v / A, h: 1 }; }; // fractions of the 16:9 monitor frame
  function renderGuides() {
    const c = cropFor(guide.aspect), any = guide.aspect !== 'off' || guide.thirds || guide.safe || guide.center, pct = (v) => (v * 100).toFixed(3) + '%';
    $g('gvGuides').classList.toggle('on', any); $g('gvGuideBtn').classList.toggle('on', any);
    let h = `<div class="gcrop${guide.aspect !== 'off' ? ' mask' : ''}" style="left:${pct((1 - c.w) / 2)};top:${pct((1 - c.h) / 2)};width:${pct(c.w)};height:${pct(c.h)}">`;
    if (guide.thirds) h += '<i style="left:33.333%;top:0;bottom:0;width:1px"></i><i style="left:66.667%;top:0;bottom:0;width:1px"></i><i style="top:33.333%;left:0;right:0;height:1px"></i><i style="top:66.667%;left:0;right:0;height:1px"></i>';
    if (guide.safe) h += '<div class="box" style="inset:5%"><span>action safe</span></div><div class="box" style="inset:10%"><span>title safe</span></div>';
    if (guide.center) h += '<i style="left:50%;top:44%;bottom:44%;width:1px"></i><i style="top:50%;left:46%;right:46%;height:1px"></i>';
    if (guide.aspect !== 'off') h += `<em>${guide.aspect}</em>`;
    $g('gvGuides').innerHTML = h + '</div>';
    const xa = $g('xpAspect'); if (xa) xa.value = guide.aspect;
    lay.guide = { ...guide }; saveLay();
  }
  const pop = $g('gvPop');
  const closePop = gv.closePop = () => pop.classList.add('hidden');
  function openGuidePop() {
    if (!pop.classList.contains('hidden')) return closePop();
    pop.innerHTML = `<h4>Frame guides</h4>
      <label class="pl">Crop to<select id="gGAspect" class="sel">${GUIDE_ASPECTS.map(([v, l]) => `<option value="${v}"${v === guide.aspect ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="gGThirds"${guide.thirds ? ' checked' : ''}> Rule of thirds</label>
      <label class="chk"><input type="checkbox" id="gGSafe"${guide.safe ? ' checked' : ''}> Safe areas <span class="hint">action 90% · title 80%</span></label>
      <label class="chk"><input type="checkbox" id="gGCenter"${guide.center ? ' checked' : ''}> Centre mark</label>
      <div class="note">Guides show on the monitor only. Pick a shape here and Export can crop the finished frames to it.</div>`;
    const r = $g('gvGuideBtn').getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.right - 280, innerWidth - 292)) + 'px'; pop.classList.remove('hidden');
    $g('gGAspect').onchange = (e) => { guide.aspect = e.target.value; renderGuides(); };
    $g('gGThirds').onchange = (e) => { guide.thirds = e.target.checked; renderGuides(); };
    $g('gGSafe').onchange = (e) => { guide.safe = e.target.checked; renderGuides(); };
    $g('gGCenter').onchange = (e) => { guide.center = e.target.checked; renderGuides(); };
  }
  $g('gvGuideBtn').onclick = (e) => { e.stopPropagation(); openGuidePop(); };
  addEventListener('pointerdown', (e) => { if (!pop.classList.contains('hidden') && !e.target.closest('#gvPop,#gvGuideBtn')) closePop(); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); }, true);

  /* --- preview quality: a lower-resolution viewport and a slower monitor keep the desk smooth on slow machines --- */
  const QUAL = { auto: { s: 1 }, full: { s: 1, rate: 1 }, balanced: { s: 0.75, rate: 2 }, light: { s: 0.5, rate: 4 } };
  function setQuality(k, save = true) {
    if (!QUAL[k]) k = 'auto';
    gv.qscale = QUAL[k].s; gv.quality = k;
    const rs = $g('gvMonRate'); rs.value = k === 'auto' ? 'auto' : String(QUAL[k].rate); rs.dispatchEvent(new Event('change'));
    $g('gvQuality').value = k; fitStage(); pv.dirty = true;
    if (save) { lay.q = k; saveLay(); }
  }
  $g('gvQuality').onchange = (e) => { setQuality(e.target.value); gvToast({ auto: 'Preview quality: Auto, full detail unless playback struggles', full: 'Preview quality: Full', balanced: 'Preview quality: Balanced, lighter on slower machines', light: 'Preview quality: Light, for the slowest machines' }[e.target.value]); };

  /* --- versions: named snapshots of the whole cut, with an A/B flip --- */
  const VKEY = 'clockwork.versions.v1';
  const VS = { list: [], a: null, b: null };
  try { const x = JSON.parse(localStorage.getItem(VKEY) || 'null'); if (x && Array.isArray(x.list)) Object.assign(VS, { list: x.list, a: x.a || null, b: x.b || null }); } catch (e) { /* no storage */ }
  const cmp = { showing: null, label: '' };
  const saveVS = () => { try { localStorage.setItem(VKEY, JSON.stringify(VS)); return true; } catch (e) { gvToast('Could not store versions: browser storage is full or blocked', true); return false; } };
  const vById = (id) => VS.list.find((v) => v.id === id);
  const stamp = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const workSummary = (w) => { const n = Object.keys(w.overrides || {}).length, nn = Object.keys(w.notes || {}).filter((k) => w.notes[k]).length; return `${n} camera edit${n === 1 ? '' : 's'}${w.grade ? ' · graded' : ''}${nn ? ` · ${nn} note${nn === 1 ? '' : 's'}` : ''}`; };
  function diffWorks(a, b) {
    const ao = a.overrides || {}, bo = b.overrides || {}, J = JSON.stringify, cams = [], grades = [];
    for (const t0 of new Set([...Object.keys(ao), ...Object.keys(bo)])) if (J(ao[t0]) !== J(bo[t0])) cams.push(+t0);
    const ag = (a.grade && a.grade.vals) || {}, bg = (b.grade && b.grade.vals) || {}, as = ag.shots || {}, bs = bg.shots || {};
    const filmKeys = [...new Set([...Object.keys(ag), ...Object.keys(bg)])].filter((k) => k !== 'shots' && J(ag[k]) !== J(bg[k]));
    for (const t0 of new Set([...Object.keys(as), ...Object.keys(bs)])) if (J(as[t0]) !== J(bs[t0])) grades.push(+t0);
    const an = a.notes || {}, bn = b.notes || {}; let notes = 0; for (const k of new Set([...Object.keys(an), ...Object.keys(bn)])) if ((an[k] || '') !== (bn[k] || '')) notes++;
    return { cams, grades, filmKeys, notes };
  }
  const shotIdx = (t0) => SHOTS.findIndex((s) => s.t0 === t0);
  async function loadFast(w) { // switch the whole cut, re-sampling only the shots whose cameras changed
    const before = clone(gv.ov), after = w.overrides || {};
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((t0) => JSON.stringify(before[t0]) !== JSON.stringify(after[t0])).map((t0) => shotIdx(+t0)).filter((i) => i >= 0);
    applyWork(w, PFROM); persistNow();
    if (changed.length > 6) await resampleAll(); else { changed.forEach((i) => resampleShot(i)); }
    renderGrade(); renderShotRows(); renderInspector(); renderExport(); renderProjectBar(); rebuildEdit(); pv.dirty = true; gv.dirty = true;
  }
  function stashIfNeeded() { // flipping must never lose unsaved work
    const w = snapshot(), p = curProject();
    if (VS.list.some((v) => sameWork(v.work, w)) || sameWork(w, baseline()) || (p && sameWork(w, p))) return false;
    VS.list.unshift({ id: gvId(), name: 'Before comparing · ' + stamp(Date.now()), created: Date.now(), auto: true, work: w });
    const autos = VS.list.filter((v) => v.auto); if (autos.length > 5) for (const v of autos.slice(5)) VS.list.splice(VS.list.indexOf(v), 1);
    saveVS(); gvToast('Your open work was kept as a version before switching'); return true;
  }
  async function openVersion(id, label = '') {
    const v = vById(id); if (!v) return;
    stashIfNeeded(); await loadFast(clone(v.work)); cmp.showing = id; cmp.label = label; viewingBadge(); renderVersions();
    gvToast(label ? `Showing ${label}: ${v.name}` : `Opened ${v.name}`);
  }
  async function flip() {
    const a = vById(VS.a), b = vById(VS.b);
    if (!a || !b || a.id === b.id) { gvToast('Pick two different versions for A and B first', true); document.querySelector('#gvITabs [data-itab=versions]').click(); $g('gv').classList.add('openR'); return; }
    return openVersion(cmp.showing === a.id ? b.id : a.id, cmp.showing === a.id ? 'B' : 'A');
  }
  function viewingBadge() {
    const el = $g('gvViewing'), v = cmp.showing && vById(cmp.showing);
    if (!v) { el.classList.add('hidden'); return; }
    const edited = !sameWork(snapshot(), v.work);
    el.textContent = `${cmp.label ? cmp.label + ' · ' : ''}${v.name}${edited ? ' (edited)' : ''}`; el.title = 'Version on screen. Press \\ to flip between A and B.'; el.classList.remove('hidden'); el.classList.toggle('edited', edited);
  }
  setInterval(viewingBadge, 700);
  async function saveVersion() {
    const name = await gvAsk({ title: 'Save a version', text: 'A snapshot of every camera, the colour grade and your notes. Come back to it any time, or compare it with another.', value: `Version ${VS.list.filter((v) => !v.auto).length + 1}`, ok: 'Save version' });
    if (name === null) return;
    persistNow(); const v = { id: gvId(), name: name.trim() || 'Version', created: Date.now(), work: snapshot() };
    VS.list.unshift(v); if (!VS.a) VS.a = v.id; else if (!VS.b && VS.a !== v.id) VS.b = v.id;
    if (saveVS()) { cmp.showing = null; viewingBadge(); renderVersions(); gvToast(`Saved “${v.name}”`); }
  }
  function renderVersions() {
    const el = $g('gvIVers'), opts = (sel) => '<option value="">Choose a version…</option>' + VS.list.map((v) => `<option value="${v.id}"${v.id === sel ? ' selected' : ''}>${gvEsc(v.name)}</option>`).join('');
    const now = snapshot();
    let h = `<div class="note">Save a snapshot of the whole cut (cameras, grade, notes) before you try something bold. Pick any two and flip between them to judge the change.</div>
      <div class="btns"><button class="btn pri" id="vSave">Save current as a version…</button></div>
      <div class="sect">Compare A and B <span class="hint">press <kbd>\\</kbd> to flip</span></div>
      <div class="ab"><label>A</label><select id="vA" class="sel">${opts(VS.a)}</select><label>B</label><select id="vB" class="sel">${opts(VS.b)}</select></div>
      <button class="btn flip" id="vFlip" ${vById(VS.a) && vById(VS.b) && VS.a !== VS.b ? '' : 'disabled'}>${cmp.showing && cmp.showing === VS.a ? 'Showing A · flip to B' : cmp.showing && cmp.showing === VS.b ? 'Showing B · flip to A' : 'Flip A ⇄ B'}</button>`;
    const A = vById(VS.a), B = vById(VS.b);
    if (A && B && A.id !== B.id) {
      const d = diffWorks(A.work, B.work), bits = [];
      if (d.cams.length) bits.push(`cameras in ${d.cams.length} shot${d.cams.length === 1 ? '' : 's'}`);
      if (d.filmKeys.length) bits.push(`${d.filmKeys.length} film-wide grade value${d.filmKeys.length === 1 ? '' : 's'}`);
      if (d.grades.length) bits.push(`grade in ${d.grades.length} shot${d.grades.length === 1 ? '' : 's'}`);
      if (d.notes) bits.push(`${d.notes} note${d.notes === 1 ? '' : 's'}`);
      const jump = [...new Set([...d.cams, ...d.grades])].sort((p, q) => p - q).slice(0, 24);
      h += `<div class="note">${bits.length ? 'They differ in ' + bits.join(', ') + '.' : 'These two are identical.'}${jump.length ? `<div class="chips jump">${jump.map((t0) => `<button data-jump="${shotIdx(t0)}">S${shotIdx(t0) + 1}</button>`).join('')}</div>` : ''}</div>`;
    }
    h += `<div class="sect">Saved versions <span class="hint">${VS.list.length}</span></div>`;
    h += VS.list.length ? VS.list.map((v) => {
      const cur = sameWork(now, v.work);
      return `<div class="vrow${cur ? ' cur' : ''}" data-v="${v.id}"><div class="vh"><b>${gvEsc(v.name)}</b>${cur ? '<span class="tag">open now</span>' : ''}${v.id === VS.a ? '<span class="tag a">A</span>' : ''}${v.id === VS.b ? '<span class="tag b">B</span>' : ''}${v.auto ? '<span class="tag">auto</span>' : ''}</div><div class="sb">${workSummary(v.work)} · ${ago(v.created)}</div>
        <div class="va"><button class="btn sm" data-va="open">Open</button><button class="btn sm" data-va="a">Set as A</button><button class="btn sm" data-va="b">Set as B</button><button class="btn sm" data-va="update" title="Replace this version with the work you have open">Update</button><button class="btn sm" data-va="rename">Rename</button><button class="btn sm warn" data-va="delete">Delete</button></div></div>`;
    }).join('') : '<div class="note">No versions yet. Press “Save current as a version…” to keep the cut as it is now.</div>';
    el.innerHTML = h;
  }
  gv.renderVersions = renderVersions;
  $g('gvIVers').addEventListener('click', async (e) => {
    const jb = e.target.closest('[data-jump]'); if (jb) { gv.pinned = false; selectShot(+jb.dataset.jump, true); return; }
    if (e.target.id === 'vSave') return saveVersion();
    if (e.target.id === 'vFlip') return flip();
    const b = e.target.closest('[data-va]'), row = e.target.closest('.vrow'); if (!b || !row) return;
    const v = vById(row.dataset.v); if (!v) return; const a = b.dataset.va;
    if (a === 'open') return openVersion(v.id);
    if (a === 'a') { VS.a = v.id; saveVS(); renderVersions(); return; }
    if (a === 'b') { VS.b = v.id; saveVS(); renderVersions(); return; }
    if (a === 'update') { if (!(await gvAsk({ title: `Update “${v.name}”?`, text: 'This version will be replaced by the work you have open now.', ok: 'Update version' }))) return; persistNow(); v.work = snapshot(); v.created = Date.now(); v.auto = false; saveVS(); renderVersions(); gvToast('Version updated'); return; }
    if (a === 'rename') { const n = await gvAsk({ title: 'Rename version', value: v.name, ok: 'Rename' }); if (n === null) return; v.name = n.trim() || v.name; saveVS(); renderVersions(); return; }
    if (a === 'delete') { if (!(await gvAsk({ title: `Delete “${v.name}”?`, text: 'This removes the saved version. Your open work is not affected.', ok: 'Delete version', danger: true }))) return; VS.list.splice(VS.list.indexOf(v), 1); if (VS.a === v.id) VS.a = null; if (VS.b === v.id) VS.b = null; if (cmp.showing === v.id) cmp.showing = null; saveVS(); renderVersions(); viewingBadge(); }
  });
  $g('gvIVers').addEventListener('change', (e) => { if (e.target.id === 'vA') VS.a = e.target.value || null; else if (e.target.id === 'vB') VS.b = e.target.value || null; else return; saveVS(); renderVersions(); });
  gv.versions = { save: saveVersion, flip, open: openVersion, list: () => VS.list, set: (a, b) => { VS.a = a; VS.b = b; saveVS(); renderVersions(); }, store: VS };

  /* --- export: any range, size, frame rate and format, rendered frame by frame and streamed to disk --- */
  const XP_MAX_FILM = FILM - 0.06;
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zipWriter() { // store-only zip: PNG, JPEG and WebP are already compressed
    const parts = [], central = [], te = new TextEncoder(), now = new Date(); let off = 0;
    const dosT = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    return {
      get bytes() { return off; }, get count() { return central.length; },
      add(name, u8) {
        const nm = te.encode(name), crc = crc32(u8), h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dosT, true); h.setUint16(12, dosD, true);
        h.setUint32(14, crc, true); h.setUint32(18, u8.length, true); h.setUint32(22, u8.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
        parts.push(new Uint8Array(h.buffer), nm, u8); central.push({ nm, crc, size: u8.length, off }); off += 30 + nm.length + u8.length;
      },
      finish() {
        const cd = []; let cdSize = 0;
        for (const e of central) {
          const h = new DataView(new ArrayBuffer(46));
          h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x0800, true); h.setUint16(10, 0, true); h.setUint16(12, dosT, true); h.setUint16(14, dosD, true);
          h.setUint32(16, e.crc, true); h.setUint32(20, e.size, true); h.setUint32(24, e.size, true); h.setUint16(28, e.nm.length, true); h.setUint32(42, e.off, true);
          cd.push(new Uint8Array(h.buffer), e.nm); cdSize += 46 + e.nm.length;
        }
        const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, central.length, true); end.setUint16(10, central.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
        return new Blob([...parts, ...cd, new Uint8Array(end.buffer)], { type: 'application/zip' });
      },
    };
  }
  /* A streaming WebM (Matroska) writer. The header is written first with fixed-width size fields and patched at the end,
     so the file can go straight to disk and a clip can be any length. */
  const cat = (arr) => { let n = 0; for (const a of arr) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arr) { out.set(a, o); o += a.length; } return out; };
  const mkId = (id) => { const b = []; let v = id; while (v > 0) { b.unshift(v % 256); v = Math.floor(v / 256); } return Uint8Array.from(b); };
  const mkSize = (n) => { const b = new Uint8Array(8); b[0] = 1; let v = n; for (let i = 7; i >= 1; i--) { b[i] = v % 256; v = Math.floor(v / 256); } return b; };
  const mkEl = (id, ...kids) => { const body = cat(kids); return cat([mkId(id), mkSize(body.length), body]); };
  const mkUint = (id, v) => { const b = []; let x = v; do { b.unshift(x % 256); x = Math.floor(x / 256); } while (x > 0); return mkEl(id, Uint8Array.from(b)); };
  const mkStr = (id, s) => mkEl(id, new TextEncoder().encode(s));
  const mkF64 = (id, v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v); return mkEl(id, b); };
  const memorySink = () => { const chunks = []; return { async write(u8) { chunks.push(u8); }, async patch(pos, u8) { chunks[0].set(u8, pos); }, async close() { return new Blob(chunks, { type: 'video/webm' }); } }; };
  const fileSink = (w) => ({ write: (u8) => w.write(u8), patch: (pos, u8) => w.write({ type: 'write', position: pos, data: u8 }), close: async () => { await w.close(); return null; } });
  function webmStream(w, h, codecId, sink) {
    const ebml = mkEl(0x1A45DFA3, mkUint(0x4286, 1), mkUint(0x42F7, 1), mkUint(0x42F2, 4), mkUint(0x42F3, 8), mkStr(0x4282, 'webm'), mkUint(0x4287, 4), mkUint(0x4285, 2));
    const ts = mkUint(0x2AD7B1, 1000000), dur = mkF64(0x4489, 0), app = cat([mkStr(0x4D80, 'Sculptor'), mkStr(0x5741, 'Sculptor')]);
    const infoBody = cat([ts, dur, app]), info = cat([mkId(0x1549A966), mkSize(infoBody.length), infoBody]);
    const tracks = mkEl(0x1654AE6B, mkEl(0xAE, mkUint(0xD7, 1), mkUint(0x73C5, 1), mkUint(0x83, 1), mkStr(0x86, codecId), mkEl(0xE0, mkUint(0xB0, w), mkUint(0xBA, h))));
    const segHdr = cat([mkId(0x18538067), mkSize(0)]), head = cat([ebml, segHdr, info, tracks]);
    const segSizePos = ebml.length + 4, durPos = ebml.length + segHdr.length + 12 + ts.length + 2 + 8;
    let cur = null, total = 0, lastMs = 0, started = false;
    async function flushCluster() { if (!cur) return; const c = mkEl(0x1F43B675, mkUint(0xE7, cur.t0), ...cur.blocks); await sink.write(c); total += c.length; cur = null; }
    let chain = Promise.resolve(); // encoder output arrives in order but not awaited, so writes are queued
    const doAdd = async (data, ms, key) => {
      if (!started) { await sink.write(head); started = true; }
      if (!cur || key) { await flushCluster(); cur = { t0: ms, blocks: [] }; }
      const rel = ms - cur.t0; cur.blocks.push(mkEl(0xA3, Uint8Array.from([0x81, (rel >> 8) & 255, rel & 255, key ? 0x80 : 0]), data)); lastMs = ms;
    };
    return {
      add(data, ms, key) { chain = chain.then(() => doAdd(data, ms, key)); return chain; },
      async finish(durMs) {
        await chain;
        if (!started) { await sink.write(head); started = true; }
        await flushCluster();
        await sink.patch(segSizePos, mkSize(head.length - ebml.length - segHdr.length + total));
        const d = new Uint8Array(8); new DataView(d.buffer).setFloat64(0, durMs); await sink.patch(durPos, d);
        return sink.close();
      },
    };
  }

  const xpEl = $g('gvXp'), xpv = (id) => $g(id).value;
  const XP_FORMATS = { vp8: { video: true, codec: 'vp8', id: 'V_VP8', ext: 'webm', label: 'WebM · VP8' }, vp9: { video: true, codec: 'vp09.00.10.08', id: 'V_VP9', ext: 'webm', label: 'WebM · VP9' }, png: { ext: 'png', mime: 'image/png', label: 'PNG frames' }, jpg: { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG frames' }, webp: { ext: 'webp', mime: 'image/webp', label: 'WebP frames' } };
  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const fmtDur = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 120 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
  function xpSetRange(kind) {
    let a, b; const sel = SHOTS[gv.sel];
    if (kind === 'shot') { a = sel.t0; b = sel.t1; } else if (kind === 'range' && hasRange()) { a = rng.a; b = rng.b; } else if (kind === 'film') { a = 0; b = FILM; } else return;
    $g('xpFrom').value = a.toFixed(2); $g('xpTo').value = Math.min(b, XP_MAX_FILM).toFixed(2);
  }
  function xpOpts() {
    let a = parseFloat(xpv('xpFrom')), b = parseFloat(xpv('xpTo')); if (!(a >= 0)) a = 0; if (!(b > a)) b = a + 0.05;
    a = clamp(a, 0, XP_MAX_FILM - 0.05); b = clamp(b, a + 0.05, XP_MAX_FILM);
    const fps = clamp(Math.round(parseFloat(xpv('xpFps')) || 24), 1, 240), fmt = xpv('xpFmt'), asp = xpv('xpAspect'), c = cropFor(asp);
    const H = Math.max(2, Math.round((xpv('xpSize') === 'custom' ? clamp(parseInt(xpv('xpH'), 10) || 1080, 64, 16384) : +xpv('xpSize')) / 2) * 2), W = Math.round((H * 16) / 9 / 2) * 2;
    const cw = Math.max(2, Math.round((W * c.w) / 2) * 2), ch = Math.max(2, Math.round((H * c.h) / 2) * 2), frames = Math.max(1, Math.round((b - a) * fps));
    const mbps = parseFloat(xpv('xpMbps')), q = clamp((parseInt(xpv('xpQ'), 10) || 92) / 100, 0.05, 1);
    return { a, b, fps, fmt, W, H, cw, ch, sx: Math.round((W - cw) / 2), sy: Math.round((H - ch) / 2), frames, aspect: asp, bitrate: mbps > 0 ? Math.round(mbps * 1e6) : 0, quality: q, name: xpv('xpName').trim() };
  }
  function xpRefresh() {
    const sel = SHOTS[gv.sel], r = $g('xpRange'), optRange = r.querySelector('[value=range]');
    r.querySelector('[value=shot]').textContent = `Selected shot · S${gv.sel + 1} ${gvShotTitle(sel.t0, gv.sel)}`;
    optRange.disabled = !hasRange(); optRange.textContent = hasRange() ? `In to Out · ${fmtSpan({ a: rng.a, b: rng.b })}` : 'In to Out · set In (I) and Out (O) first';
    const o = xpOpts(), f = XP_FORMATS[o.fmt];
    $g('xpRowQ').classList.toggle('hidden', !(o.fmt === 'jpg' || o.fmt === 'webp')); $g('xpQ').parentElement.classList.toggle('hidden', !(o.fmt === 'jpg' || o.fmt === 'webp')); $g('xpRowMbps').classList.toggle('hidden', !f.video); $g('xpMbps').parentElement.classList.toggle('hidden', !f.video); $g('xpRowH').classList.toggle('hidden', xpv('xpSize') !== 'custom'); $g('xpRowH2').classList.toggle('hidden', xpv('xpSize') !== 'custom');
    $g('xpQV').textContent = Math.round(o.quality * 100);
    const secs = o.b - o.a, bps = o.bitrate || o.cw * o.ch * o.fps * (o.fmt === 'vp9' ? 0.07 : 0.1);
    const mb = f.video ? (bps * secs) / 8e6 : o.frames * (o.fmt === 'png' ? (o.cw * o.ch * 1.1) / 1e6 : o.fmt === 'jpg' ? (o.cw * o.ch * 0.2 * o.quality) / 1e6 : (o.cw * o.ch * 0.12 * o.quality) / 1e6);
    const gb = mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : (mb < 1 ? '<1' : Math.round(mb)) + ' MB';
    const where = f.video ? (FS.file ? 'You choose the file; it is written as it renders.' : 'Held in memory, then downloaded.') : (FS.dir ? 'You choose a folder; frames are written as they render.' : 'Packed into zip parts of about 400 MB, downloaded as they fill.');
    const tooBig = Math.max(o.W, o.H) > renderer.capabilities.maxTextureSize;
    $g('xpSummary').innerHTML = `<b>${o.frames.toLocaleString()} frames</b> · ${fmtTime(o.a)} to ${fmtTime(o.b)} (${secs.toFixed(1)} s) at ${o.fps} fps · ${o.cw} × ${o.ch}${f.video ? '' : ' per frame'} · about ${gb}<br><span class="dim">${where}</span>${tooBig ? `<br><b class="bad">This graphics card cannot make frames this large (limit ${renderer.capabilities.maxTextureSize}).</b>` : ''}`;
    $g('xpWarn').classList.toggle('hidden', !(f.video && !window.VideoEncoder));
    $g('xpGo').disabled = xp.active || tooBig || (f.video && !window.VideoEncoder);
    return o;
  }
  const openExport = () => { xpEl.classList.remove('hidden'); if (!xp.active) { $g('xpProg').classList.add('hidden'); if (!$g('xpFrom').value) xpSetRange('shot'); } xpRefresh(); $g('xpGo').focus(); };
  const closeExport = () => { if (!xp.active) xpEl.classList.add('hidden'); };
  $g('gvExportBtn').onclick = openExport; $g('xpCancel').onclick = closeExport;
  $g('xpRange').addEventListener('change', (e) => { xpSetRange(e.target.value); xpRefresh(); });
  for (const id of ['xpFrom', 'xpTo']) $g(id).addEventListener('input', () => { $g('xpRange').value = 'custom'; xpRefresh(); });
  xpEl.addEventListener('change', (e) => { if (e.target.id === 'xpAspect') { guide.aspect = e.target.value; renderGuides(); } xpRefresh(); });
  xpEl.addEventListener('input', (e) => { if (/^xp(Q|Fps|Mbps|H|Name)$/.test(e.target.id)) xpRefresh(); });
  xpEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') closeExport(); });
  xpEl.addEventListener('pointerdown', (e) => { if (e.target === xpEl) closeExport(); });
  const nextFrames = (n) => new Promise((res) => { const go = () => (--n <= 0 ? res() : requestAnimationFrame(go)); requestAnimationFrame(go); });
  const xpStem = (o) => o.name ? o.name.replace(/[\\/:*?"<>|]+/g, '-') : `clockwork-${fmtTime(o.a).replace(':', 'm')}s-to-${fmtTime(o.b).replace(':', 'm')}s-${o.cw}x${o.ch}`;
  function saveBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000); }
  const grabFrame = (step) => new Promise((res) => { xp.ready = res; xp.want = true; if (step) setPlaying(true); else pv.dirty = true; });
  const FS = { dir: typeof window.showDirectoryPicker === 'function', file: typeof window.showSaveFilePicker === 'function' };

  async function runExport() {
    const o = xpRefresh(); if ($g('xpGo').disabled) return; const f = XP_FORMATS[o.fmt], stem = xpStem(o);
    // the file or folder is chosen first, while the click still counts as a user action
    let sink = null, dir = null, picked = '';
    try {
      if (f.video && FS.file) { const h = await window.showSaveFilePicker({ suggestedName: `${stem}.webm`, types: [{ description: 'WebM video', accept: { 'video/webm': ['.webm'] } }] }); sink = fileSink(await h.createWritable()); picked = h.name; }
      else if (!f.video && FS.dir) { const d = await window.showDirectoryPicker({ mode: 'readwrite' }); dir = await d.getDirectoryHandle(stem, { create: true }); picked = `${d.name}/${stem}`; }
    } catch (err) { if (err && err.name === 'AbortError') { gvToast('Export cancelled'); return; } sink = null; dir = null; }
    if (f.video && !sink) sink = memorySink();
    const prev = { T: st.T, on: pv.on, lock: st.lockScale, speed: st.speed, mw: monitor.width, mh: monitor.height };
    const prog = $g('xpProg'), bar = prog.querySelector('i'), ptxt = $g('xpProgText'), t0 = performance.now();
    xp.active = true; xp.cancel = false; xp.paused = false; prog.classList.remove('hidden'); xpEl.classList.add('busy'); bar.style.width = '0%';
    for (const x of xpEl.querySelectorAll('select,input')) x.disabled = true; $g('xpGo').classList.add('hidden'); $g('xpCancel').classList.add('hidden'); $g('xpPause').classList.remove('hidden'); $g('xpStop').classList.remove('hidden'); $g('xpPause').textContent = 'Pause';
    let enc = null, mux = null, zip = null, partNo = 0, done = 0, failure = null, wake = null, encErr = null, partBytes = 0;
    const flushZip = () => { if (zip && zip.count) { partNo++; saveBlob(zip.finish(), `${stem}-part${String(partNo).padStart(2, '0')}.zip`); zip = zipWriter(); } };
    try {
      try { wake = navigator.wakeLock && (await navigator.wakeLock.request('screen')); } catch (e) { wake = null; }
      sh.rate = 0; shuttleBadge(); pv.on = true; st.lockScale = true; st.speed = 1; setPlaying(false); closePop();
      const pr = renderer.getPixelRatio(); xp.view = { w: Math.ceil(o.W / pr), h: Math.ceil(o.H / pr) }; monitor.width = o.W; monitor.height = o.H; fitStage();
      await nextFrames(3);
      const fcv = document.createElement('canvas'); fcv.width = o.cw; fcv.height = o.ch; const fctx = fcv.getContext('2d', { alpha: false });
      if (f.video) {
        mux = webmStream(o.cw, o.ch, f.id, sink);
        enc = new VideoEncoder({ output: (chunk) => { const u = new Uint8Array(chunk.byteLength); chunk.copyTo(u); mux.add(u, Math.round(chunk.timestamp / 1000), chunk.type === 'key').catch((e) => { encErr = e; }); }, error: (err) => { encErr = err; } });
        const cfg = { codec: f.codec, width: o.cw, height: o.ch, bitrate: o.bitrate || Math.round(o.cw * o.ch * o.fps * (o.fmt === 'vp9' ? 0.07 : 0.1)), framerate: o.fps };
        const sup = await VideoEncoder.isConfigSupported(cfg); if (!sup.supported) throw new Error(`This browser cannot encode ${f.label} at ${o.cw} × ${o.ch}. Try a smaller size or another format.`);
        enc.configure(cfg);
      } else if (!dir) zip = zipWriter();
      seekTo(o.a); st.fixedDt = 1 / o.fps;
      for (let n = 0; n < o.frames; n++) {
        while (xp.paused && !xp.cancel) { ptxt.textContent = `Paused at frame ${done.toLocaleString()} of ${o.frames.toLocaleString()}`; await new Promise((r) => setTimeout(r, 150)); }
        if (xp.cancel) break;
        await grabFrame(n > 0);
        if (xp.cancel) break; if (encErr) throw encErr;
        fctx.drawImage(monitor, o.sx, o.sy, o.cw, o.ch, 0, 0, o.cw, o.ch);
        if (enc) {
          const vf = new VideoFrame(fcv, { timestamp: Math.round((n * 1e6) / o.fps) }); enc.encode(vf, { keyFrame: n % Math.max(1, Math.round(o.fps * 2)) === 0 }); vf.close();
          while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
        } else {
          const blob = await new Promise((r) => fcv.toBlob(r, f.mime, o.quality)), u8 = new Uint8Array(await blob.arrayBuffer()), fname = `frame_${String(n + 1).padStart(String(o.frames).length > 4 ? 6 : 4, '0')}.${f.ext}`;
          if (dir) { const fh = await dir.getFileHandle(fname, { create: true }), w = await fh.createWritable(); await w.write(u8); await w.close(); }
          else { zip.add(fname, u8); partBytes = zip.bytes; if (partBytes > 400 * 1048576) flushZip(); }
        }
        done = n + 1; const el = (performance.now() - t0) / 1000, left = (el / done) * (o.frames - done);
        bar.style.width = ((done / o.frames) * 100).toFixed(2) + '%';
        ptxt.textContent = `Frame ${done.toLocaleString()} of ${o.frames.toLocaleString()} · ${(done / el).toFixed(1)} frames/s · ${fmtDur(left)} left`;
      }
      ptxt.textContent = 'Finishing the file…';
      if (enc) { await enc.flush(); if (encErr) throw encErr; }
    } catch (err) { failure = err; gvToast('Export stopped: ' + (err && err.message ? err.message : err), true); }
    // whatever was rendered is kept, whether it finished, was stopped, or failed part-way
    let result = null;
    try {
      if (mux) { if (done > 0) result = await mux.finish((done * 1000) / o.fps); else if (sink && sink.close) await sink.close(); }
      else if (zip) flushZip();
    } catch (err) { gvToast('Could not finish the file: ' + err.message, true); }
    try { enc && enc.state !== 'closed' && enc.close(); } catch (e) { /* closed */ }
    try { wake && wake.release(); } catch (e) { /* released */ }
    st.fixedDt = 0; setPlaying(false); xp.active = false; xp.view = null; xp.want = false; monitor.width = prev.mw; monitor.height = prev.mh;
    pv.on = prev.on; st.lockScale = prev.lock; st.speed = prev.speed; fitStage(); seekTo(prev.T); pv.dirty = true; gv.dirty = true;
    for (const x of xpEl.querySelectorAll('select,input')) x.disabled = false;
    xpEl.classList.remove('busy'); xpEl.classList.add('hidden'); $g('xpGo').classList.remove('hidden'); $g('xpCancel').classList.remove('hidden'); $g('xpPause').classList.add('hidden'); $g('xpStop').classList.add('hidden'); $g('xpStop').textContent = 'Stop and save';
    const stopped = xp.cancel && done < o.frames;
    if (result) saveBlob(result, `${stem}.webm`);
    if (done > 0) gvToast(`${stopped || failure ? 'Saved the first ' : 'Exported '}${done.toLocaleString()} frame${done === 1 ? '' : 's'}${picked ? ' to ' + picked : ''}${partNo > 1 ? ` in ${partNo} zip parts` : ''}`);
    else if (!failure) gvToast('Nothing was rendered');
    gv.lastExport = { frames: done, size: result ? result.size : 0, name: `${stem}.${f.video ? 'webm' : 'frames'}`, blob: result, parts: partNo, failure: failure && String(failure.message || failure) };
  }
  $g('xpGo').onclick = runExport;
  $g('xpPause').onclick = () => { xp.paused = !xp.paused; $g('xpPause').textContent = xp.paused ? 'Resume' : 'Pause'; };
  $g('xpStop').onclick = () => { xp.cancel = true; xp.paused = false; $g('xpStop').textContent = 'Stopping…'; };
  gv.exporter = { open: openExport, run: runExport, opts: xpRefresh, setRange: xpSetRange, zipWriter, crc32, webmStream, memorySink, FS };

  /* --- precise controls: click a value to type it (even beyond the slider), double-click a grade label to reset it --- */
  $g('gv').addEventListener('click', (e) => {
    const out = e.target.closest('.rg output'); if (!out || out.querySelector('input')) return;
    const range = out.closest('.rg').querySelector('input[type=range]'); if (!range || range.disabled) return;
    const old = out.textContent, inp = document.createElement('input'); inp.type = 'number'; inp.step = 'any'; inp.className = 'outedit'; inp.value = range.value; inp.setAttribute('aria-label', 'Type a value');
    out.textContent = ''; out.appendChild(inp); inp.focus(); inp.select(); let done = false;
    const finish = (apply) => {
      if (done) return; done = true; const v = parseFloat(inp.value);
      if (apply && Number.isFinite(v)) { if (v > +range.max) range.max = v; if (v < +range.min) range.min = v; range.value = v; range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true })); }
      else out.textContent = old;
    };
    inp.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); else if (ev.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
  });
  $g('gvIGrade').addEventListener('dblclick', (e) => {
    const lab = e.target.closest('.rg label'); if (!lab) return; const r = lab.parentElement.querySelector('[data-gv]'); if (!r) return; const k = r.dataset.gv;
    if (G.scope !== 'film') { gDrop(k); gradeChanged(); renderGrade(); renderShotRows(); return; }
    const def = gradeDefaults()[k] ?? (GRADE_DEFS[k] ? GRADE_DEFS[k][5] : undefined); if (def === undefined) return;
    G.vals[k] = def; gradeChanged(); renderGrade(); gvToast(`${GRADE_DEFS[k][1]} reset`);
  });

  /* --- several shots at once: ctrl-click or shift-click in the list, then batch edit --- */
  function markMulti() {
    $g('gvLShots').querySelectorAll('.srow').forEach((r) => r.classList.toggle('multi', gv.multi.has(+r.dataset.shot)));
    renderBatch(); if (G.scope !== 'film') renderGrade();
  }
  gv.markMulti = markMulti;
  const batchIdx = () => [...gv.multi].sort((a, b) => a - b);
  function renderBatch() {
    const el = $g('gvBatch'), n = gv.multi.size; el.classList.toggle('hidden', n < 2); if (n < 2) return;
    el.innerHTML = `<div class="bh"><b>${n} shots selected</b><button class="btn sm" data-b="none">Select none</button></div>
      <div class="bb"><button class="btn sm" data-b="pcam" ${gv.clip.cam ? '' : 'disabled'} title="Copy a shot's camera first (Ctrl+C)">Paste camera</button><button class="btn sm" data-b="pgrade" ${gv.clip.grade ? '' : 'disabled'} title="Copy a shot's grade first (Ctrl+Shift+C)">Paste grade</button>
      <select class="sel sm" id="bEase" title="Set the motion of every selected shot that has an edited camera"><option value="">Set motion…</option>${['smooth', 'linear', 'in', 'out', 'slow'].map((v) => `<option value="${v}">${{ smooth: 'Smooth', linear: 'Linear', in: 'Ease in', out: 'Ease out', slow: 'Slow, fast, slow' }[v]}</option>`).join('')}</select>
      <button class="btn sm warn" data-b="rcam">Reset cameras</button><button class="btn sm warn" data-b="cgrade">Clear grades</button></div>
      <div class="bn">Colour sliders in the Grade tab (S only / → end) now change all ${n} together.</div>`;
  }
  async function batchDo(what, val) {
    const idx = batchIdx(); if (idx.length < 2) return; let touched = [];
    if (what === 'none') { gv.multi.clear(); return markMulti(); }
    if (what === 'pgrade') { if (!gv.clip.grade) return; if (!G.vals.shots) G.vals.shots = {}; idx.forEach((i) => { G.vals.shots[SHOTS[i].t0] = clone(gv.clip.grade); }); gradeChanged(); renderGrade(); renderShotRows(); markMulti(); return gvToast(`Pasted the grade into ${idx.length} shots`); }
    if (what === 'cgrade') { if (G.vals.shots) idx.forEach((i) => { delete G.vals.shots[SHOTS[i].t0]; }); gradeChanged(); renderGrade(); renderShotRows(); markMulti(); return gvToast(`Cleared the grade of ${idx.length} shots`); }
    if (what === 'pcam') { if (!gv.clip.cam) return; idx.forEach((i) => { gv.ov[SHOTS[i].t0] = clone(gv.clip.cam); applyOv(i); touched.push(i); }); }
    else if (what === 'rcam') idx.forEach((i) => { if (gv.ov[SHOTS[i].t0]) { delete gv.ov[SHOTS[i].t0]; applyOv(i); touched.push(i); } });
    else if (what === 'ease') idx.forEach((i) => { const o = gv.ov[SHOTS[i].t0]; if (o) { if (val === 'smooth') delete o.ease; else o.ease = val; applyOv(i); touched.push(i); } });
    if (!touched.length) return gvToast('None of the selected shots has an edited camera yet', true);
    saveEdits(); gv.editOn = false; gv.pinned = false;
    if (touched.length > 6) await resampleAll(); else touched.forEach((i) => resampleShot(i));
    renderShotRows(); renderInspector(); renderExport(); rebuildEdit(); markMulti(); gvToast(`Updated ${touched.length} shot${touched.length === 1 ? '' : 's'}`);
  }
  $g('gvBatch').addEventListener('click', (e) => { const b = e.target.closest('[data-b]'); if (b) batchDo(b.dataset.b); });
  $g('gvBatch').addEventListener('change', (e) => { if (e.target.id === 'bEase' && e.target.value) { batchDo('ease', e.target.value); e.target.value = ''; } });
  gv.onEscape = () => { closePop(); if (gv.multi.size) { gv.multi.clear(); markMulti(); } };

  /* --- scopes: histogram, waveform, RGB parade and vectorscope of the monitor picture --- */
  const SC = { mode: lay.scope || 'off', off: document.createElement('canvas') }; SC.off.width = 160; SC.off.height = 68; const sctx = SC.off.getContext('2d', { willReadFrequently: true });
  function scopeUI() {
    const on = SC.mode !== 'off'; $g('gvScope').classList.toggle('hidden', !on); $g('gvScopeMode').classList.toggle('hidden', !on); $g('gvScopeBtn').textContent = on ? 'Scopes ▾' : 'Scopes ▸'; $g('gvScopeBtn').setAttribute('aria-expanded', String(on));
    $g('gvScopeMode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sc === SC.mode));
    if (on) drawScope();
  }
  function drawScope() {
    if (SC.mode === 'off' || !pv.on || xp.active) return;
    const cv = $g('gvScope'), g = cv.getContext('2d'), W = cv.width, H = cv.height, mw = monitor.width, mh = monitor.height;
    sctx.drawImage(monitor, 0, mh * 0.125, mw, mh * 0.75, 0, 0, 160, 68); // the letterbox bars would only swamp the blacks
    const d = sctx.getImageData(0, 0, 160, 68).data, n = d.length / 4;
    g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H); g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.08)';
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, (H * k) / 4 + 0.5); g.lineTo(W, (H * k) / 4 + 0.5); g.stroke(); }
    if (SC.mode === 'hist') {
      const bins = [new Float32Array(64), new Float32Array(64), new Float32Array(64)];
      for (let p = 0; p < n; p++) { bins[0][d[p * 4] >> 2]++; bins[1][d[p * 4 + 1] >> 2]++; bins[2][d[p * 4 + 2] >> 2]++; }
      let mx = 1; for (const b of bins) for (let k = 1; k < 63; k++) mx = Math.max(mx, b[k]);
      g.globalCompositeOperation = 'lighter';
      ['rgba(255,70,70,.7)', 'rgba(70,255,90,.7)', 'rgba(70,120,255,.7)'].forEach((col, c) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, H); for (let k = 0; k < 64; k++) g.lineTo((k / 63) * W, H - Math.min(1, Math.sqrt(bins[c][k] / mx)) * (H - 4)); g.lineTo(W, H); g.fill(); });
      g.globalCompositeOperation = 'source-over';
    } else if (SC.mode === 'wave' || SC.mode === 'parade') {
      const par = SC.mode === 'parade', cols = par ? 3 : 1, cw = W / cols; g.globalCompositeOperation = 'lighter';
      for (let c = 0; c < cols; c++) {
        const cnt = new Uint16Array(160 * 64);
        for (let y = 0; y < 68; y++) for (let x = 0; x < 160; x++) { const q = (y * 160 + x) * 4, v = par ? d[q + c] : d[q] * 0.2126 + d[q + 1] * 0.7152 + d[q + 2] * 0.0722; cnt[x * 64 + Math.min(63, (v / 256 * 64) | 0)]++; }
        g.fillStyle = par ? ['rgba(255,70,70,.32)', 'rgba(70,255,90,.32)', 'rgba(70,120,255,.32)'][c] : 'rgba(120,255,160,.32)';
        for (let x = 0; x < 160; x++) for (let b = 0; b < 64; b++) { const k = cnt[x * 64 + b]; if (k) { g.globalAlpha = Math.min(1, 0.25 + k * 0.18); g.fillRect(c * cw + (x / 160) * cw, H - 3 - (b / 63) * (H - 6), Math.max(1, cw / 160 + 0.5), 3); } }
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    } else {
      const R = Math.min(W, H) / 2 - 6, cx = W / 2, cy = H / 2; g.strokeStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      g.strokeStyle = 'rgba(255,200,150,.35)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R * 0.62, cy - R * 0.78); g.stroke(); // the skin-tone line
      g.fillStyle = 'rgba(180,230,255,.5)';
      for (let p = 0; p < n; p += 2) { const r = d[p * 4], gg = d[p * 4 + 1], b = d[p * 4 + 2], u = (-0.169 * r - 0.331 * gg + 0.5 * b) / 128, v = (0.5 * r - 0.419 * gg - 0.081 * b) / 128; g.fillRect(cx + u * R * 1.6, cy - v * R * 1.6, 1.5, 1.5); }
    }
  }
  $g('gvScopeBtn').onclick = () => { SC.mode = SC.mode === 'off' ? (lay.scopeLast || 'hist') : 'off'; lay.scope = SC.mode; saveLay(); scopeUI(); };
  $g('gvScopeMode').addEventListener('click', (e) => { const b = e.target.closest('[data-sc]'); if (!b) return; SC.mode = b.dataset.sc; lay.scope = SC.mode; lay.scopeLast = SC.mode; saveLay(); scopeUI(); });
  setInterval(() => { if (SC.mode !== 'off' && !document.hidden) drawScope(); }, 250);
  gv.scopes = { draw: drawScope, mode: () => SC.mode };

  /* --- compare wipe and the full-screen monitor --- */
  const wipeEl = $g('gvWipeLine');
  function wipeUI() { wipeEl.classList.toggle('hidden', !gv.wipe.on); wipeEl.style.left = gv.wipe.x * 100 + '%'; $g('gvWipeBtn').classList.toggle('on', gv.wipe.on); pv.dirty = true; gv.dirty = true; }
  function toggleWipe() { if (G.bypass && !gv.wipe.on) return gvToast('Turn off Bypass in the Grade tab first', true); if (!pv.on && !gv.wipe.on) return gvToast('Turn the monitor on first (View tab)', true); gv.wipe.on = !gv.wipe.on; wipeUI(); }
  $g('gvWipeBtn').onclick = toggleWipe;
  { let on = false; const wrap = () => document.querySelector('#gvMonCard .monwrap');
    wipeEl.addEventListener('pointerdown', (e) => { if (!e.target.closest('i')) return; on = true; wipeEl.setPointerCapture(e.pointerId); e.preventDefault(); });
    wipeEl.addEventListener('pointermove', (e) => { if (!on) return; const r = wrap().getBoundingClientRect(); gv.wipe.x = clamp((e.clientX - r.left) / r.width, 0.02, 0.98); wipeUI(); });
    const end = () => { on = false; }; wipeEl.addEventListener('pointerup', end); wipeEl.addEventListener('pointercancel', end); }
  const toggleFs = () => { const w = document.querySelector('#gvMonCard .monwrap'); if (document.fullscreenElement) document.exitFullscreen(); else if (w.requestFullscreen) w.requestFullscreen().catch(() => gvToast('This browser would not go full screen', true)); };
  $g('gvFsBtn').onclick = toggleFs;
  document.addEventListener('fullscreenchange', () => { pv.dirty = true; fitStage(); });

  /* --- workspace pages (like the pages of a grading suite): each rearranges the desk for one job --- */
  const PAGES = {
    cut: { itab: 'shot', ltab: 'shots', hint: 'Overview of the whole cut' },
    camera: { lw: 250, rw: 420, tlh: 290, monw: 56, itab: 'shot', ltab: 'shots', scope: 'off', hint: 'Place cameras, set keys and speed curves' },
    color: { rwf: 0.56, tlh: 150, monw: 100, itab: 'grade', scope: 'hist', hint: 'Grade with wheels, scopes and compare (W)' },
    review: { lw: 240, rwf: 0.6, tlh: 150, monw: 100, itab: 'versions', ltab: 'markers', scope: 'off', hint: 'Watch the cut, compare versions, leave markers' },
  };
  function pageUI() { const cur = lay.page || 'cut'; $g('gv').dataset.page = cur; $g('gvPages').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.page === cur)); $g('gvPageHint').textContent = (PAGES[cur] || {}).hint || ''; }
  function setPage(name) {
    if (name === 'deliver') { openExport(); return; }
    const P = PAGES[name]; if (!P) return;
    for (const k of ['lw', 'rw', 'monw', 'tlh']) { delete lay[k]; $g('gv').style.removeProperty('--gv-' + k); }
    if (P.lw) lay.lw = P.lw; if (P.rw) lay.rw = P.rw; if (P.rwf) lay.rw = clamp(Math.round(innerWidth * P.rwf), 280, Math.max(640, Math.round(innerWidth * 0.72))); if (P.monw) lay.monw = P.monw; if (P.tlh) lay.tlh = P.tlh;
    lay.page = name; applyLay(); saveLay(); pageUI();
    const it = P.itab && document.querySelector(`#gvITabs [data-itab=${P.itab}]`); if (it) it.click();
    const lt = P.ltab && document.querySelector(`#gvLTabs [data-ltab=${P.ltab}]`); if (lt) lt.click();
    if (P.scope) { SC.mode = P.scope === 'off' ? 'off' : (lay.scopeLast || P.scope); lay.scope = SC.mode; saveLay(); scopeUI(); }
    fitStage(); pv.dirty = true; gv.dirty = true;
  }
  $g('gvPages').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) setPage(b.dataset.page); });
  gv.pages = { set: setPage, now: () => lay.page || 'cut' };

  /* --- markers: director's bookmarks on the timeline --- */
  function renderMarkers() {
    const box = $g('gvLMarkers'); if (!box) return; const list = gv.markers.map((m, i) => ({ m, i })).sort((a, b) => a.m.t - b.m.t);
    box.innerHTML = `<div class="btns"><button class="btn sm pri" id="mkAdd" title="B">+ Marker at playhead</button></div>` + (list.length ? list.map(({ m, i }) => `<div class="mrow" data-mk="${i}"><button class="mt" data-go="${i}" title="Jump here">${gvFmtF(m.t)}</button><input class="mtx" data-mtx="${i}" value="${gvEsc(m.text)}" placeholder="Note…" spellcheck="true"><button class="gundo" data-del="${i}" title="Delete this marker">✕</button></div>`).join('') : '<div class="note">Markers are bookmarks for the cut: "fix the stutter here", "try a slower push-in". Press <kbd>B</kbd> to drop one at the playhead, <kbd>[</kbd> and <kbd>]</kbd> jump between them.</div>');
    gv.dirty = true;
  }
  gv.renderMarkers = renderMarkers;
  function addMarker() { const t = Math.round(clamp(st.T, 0, FILM) * 100) / 100; gv.markers.push({ t, text: '' }); saveEdits(); renderMarkers(); document.querySelector('#gvLTabs [data-ltab=markers]').click(); $g('gv').classList.add('openL'); const el = $g('gvLMarkers').querySelector(`[data-mtx="${gv.markers.length - 1}"]`); if (el) el.focus(); gvToast(`Marker at ${gvFmtF(t)}`); }
  function jumpMarker(dir) { const ts = gv.markers.map((m) => m.t).sort((a, b) => a - b), T = st.T; const t = dir > 0 ? ts.find((x) => x > T + 0.05) : [...ts].reverse().find((x) => x < T - 0.05); if (t === undefined) return gvToast(dir > 0 ? 'No marker after this' : 'No marker before this', true); gv.pinned = false; seekTo(t); setPlaying(false); }
  $g('gvLMarkers').addEventListener('click', (e) => {
    if (e.target.id === 'mkAdd') return addMarker();
    const go = e.target.closest('[data-go]'); if (go) { const m = gv.markers[+go.dataset.go]; if (m) { gv.pinned = false; seekTo(m.t); setPlaying(false); } return; }
    const del = e.target.closest('[data-del]'); if (del) { gv.markers.splice(+del.dataset.del, 1); saveEdits(); renderMarkers(); }
  });
  $g('gvLMarkers').addEventListener('input', (e) => { const i = e.target.dataset.mtx; if (i !== undefined && gv.markers[+i]) { gv.markers[+i].text = e.target.value; saveEdits(); gv.dirty = true; } });
  $g('gvLMarkers').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); });
  const prevStudioKey = gv.studioKey;
  gv.studioKey = (k, e) => { if (e.shiftKey && /^Digit[1-5]$/.test(e.code)) { setPage(['cut', 'camera', 'color', 'review', 'deliver'][+e.code.slice(5) - 1]); return true; } if (e.shiftKey && k === 'f') { toggleFs(); return true; } if (k === 'w' && !e.shiftKey) { toggleWipe(); return true; } if (k === 'b') { addMarker(); return true; } if (k === '[') { jumpMarker(-1); return true; } if (k === ']') { jumpMarker(1); return true; } return prevStudioKey(k, e); };
  gv.markerApi = { add: addMarker, jump: jumpMarker };

  /* --- start-up for the studio tools --- */
  setQuality(lay.q || 'auto', false); renderGuides(); rangeUI(); renderVersions(); renderMarkers(); renderBatch(); scopeUI(); pageUI(); wipeUI();
  { const w = $g('gvWelcome'); let seen = false; try { seen = !!localStorage.getItem('clockwork.sculptor.welcome.v1'); } catch (e) { /* storage blocked */ }
    const dismiss = () => { w.classList.add('hidden'); try { localStorage.setItem('clockwork.sculptor.welcome.v1', '1'); } catch (e) { /* storage blocked */ } };
    if (!seen) w.classList.remove('hidden');
    $g('gvWelcomeGo').onclick = () => { dismiss(); $g('gvHelp').classList.remove('hidden'); }; $g('gvWelcomeX').onclick = dismiss; }
