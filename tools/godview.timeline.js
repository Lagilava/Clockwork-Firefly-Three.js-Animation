/* ==========================================================================
   DIRECTOR'S DESK: TIMELINE  (injected after godview.inject.js, same module scope)
   One canvas: overview strip, ruler, then tracks for chapters, beats, shots (with captured
   thumbnails), camera keyframes, light flashes, events and curves of any animation channel.
   ========================================================================== */
function gvTimeline(gv) {
  const { st, seekTo, setPlaying } = gv.film;
  const sm = gv.sm, $t = (id) => document.getElementById(id);
  const cv = $t('gvTLCanvas'), ctx = cv.getContext('2d');
  const HW = 122, OV_H = 14, RULER_H = 22, TOP = OV_H + RULER_H;
  const COL = { bg: '#0f1218', row: '#12161e', line: '#242a38', text: '#dde2ee', dim: '#8b94a9', faint: '#5d667b', gold: '#f1d9a6', cyan: '#6cc4ff', edit: '#ffb347', hero: '#ff7a5c', ember: '#c8f060', head: '#ff4d6d' };
  const tl = { pps: 10, t0: 0, scrollY: 0, w: 0, h: 0, lastT: -1, dpr: 1, follow: true, userView: 0 };
  let tracks = [];
  const curveDefs = new Map();   // id -> { name, fn(t), min, max, keys(): [t...] , fmt }
  const heightArr = new Float32Array(sm.n), speedArr = new Float32Array(sm.n);
  const smoothSeries = () => {
    for (let i = 0; i < sm.n; i++) heightArr[i] = sm.root[i * 3 + 1];
    const raw = new Float32Array(sm.n);
    for (let i = 1; i < sm.n; i++) raw[i] = Math.hypot(sm.root[i * 3] - sm.root[(i - 1) * 3], sm.root[i * 3 + 1] - sm.root[(i - 1) * 3 + 1], sm.root[i * 3 + 2] - sm.root[(i - 1) * 3 + 2]) / (1 / 20);
    for (let i = 0; i < sm.n; i++) { let a = 0, c = 0; for (let k = -3; k <= 3; k++) { const j = i + k; if (j >= 0 && j < sm.n) { a += raw[j]; c++; } } speedArr[i] = a / c; }
    // a hard cut between sets teleports the robot; keep those spikes out of the scale
    for (let i = 1; i < sm.n; i++) if (speedArr[i] > 60) speedArr[i] = speedArr[i - 1];
  };
  smoothSeries();
  const seriesRange = (arr) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < arr.length; i++) { lo = Math.min(lo, arr[i]); hi = Math.max(hi, arr[i]); } return [lo, hi]; };
  const [hLo, hHi] = seriesRange(heightArr), [sLo, sHi] = seriesRange(speedArr);
  curveDefs.set('height', { name: 'Robot height', fn: (t) => heightArr[gv.sampleAt(t)], min: Math.min(0, hLo), max: hHi, keys: () => [], fmt: (v) => `${v.toFixed(1)} m` });
  curveDefs.set('speed', { name: 'Robot speed', fn: (t) => speedArr[gv.sampleAt(t)], min: 0, max: Math.max(1, sHi), keys: () => [], fmt: (v) => `${v.toFixed(1)} m/s` });
  const chanRange = new Map();
  function chanDef(name) {
    const id = 'ch:' + name; if (curveDefs.has(id)) return id;
    const ch = CH[name]; let lo = Infinity, hi = -Infinity;
    for (let t = 0; t <= FILM; t += 0.25) { const v = ch.sample(t); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (const k of ch.k) { lo = Math.min(lo, k.v); hi = Math.max(hi, k.v); }
    if (hi - lo < 1e-6) { hi = lo + 1; }
    curveDefs.set(id, { name: name, fn: (t) => ch.sample(t), min: lo, max: hi, keys: () => ch.k.map((k) => k.t), fmt: (v) => v.toFixed(2), channel: true });
    return id;
  }
  const BASE = [
    { id: 'chap', name: 'Chapters', h: 20 }, { id: 'beat', name: 'Beats', h: 20 }, { id: 'shot', name: 'Shots', h: 50 },
    { id: 'keys', name: 'Camera keys', h: 22 }, { id: 'light', name: 'Flashes', h: 28 }, { id: 'ev', name: 'Events', h: 18 },
  ];
  const userCurves = ['height', 'speed'];
  const rebuildTracks = () => { tracks = [...BASE, ...userCurves.map((id) => ({ id: 'c:' + id, curve: id, name: curveDefs.get(id).name, h: 46, removable: true }))]; let y = TOP; for (const t of tracks) { t.y = y; y += t.h + 2; } tl.contentH = y - TOP; };
  chanDef('fly'); chanDef('power'); userCurves.push('ch:fly', 'ch:power'); rebuildTracks();

  function fillTrackMenu() {
    const sel = $t('gvTrackAdd'); const names = Object.keys(CH).sort();
    sel.innerHTML = '<option value="">+ Add curve track…</option>' + names.map((n) => `<option value="${n}">${n}</option>`).join('');
    sel.onchange = () => { if (!sel.value) return; const id = chanDef(sel.value); if (!userCurves.includes(id)) userCurves.push(id); rebuildTracks(); sel.value = ''; gv.dirty = true; };
  }

  /* geometry helpers */
  const tx = (t) => HW + (t - tl.t0) * tl.pps;
  const tAt = (x) => tl.t0 + (x - HW) / tl.pps;
  const viewW = () => Math.max(40, tl.w - HW);
  const minPps = () => viewW() / FILM;
  function clampView() { tl.pps = clamp(tl.pps, minPps(), 220); tl.t0 = clamp(tl.t0, 0, Math.max(0, FILM - viewW() / tl.pps)); const maxS = Math.max(0, tl.contentH - (tl.h - TOP)); tl.scrollY = clamp(tl.scrollY, 0, maxS); }
  function zoomAt(factor, t) { const x = tx(t); tl.pps = clamp(tl.pps * factor, minPps(), 220); tl.t0 = t - (x - HW) / tl.pps; clampView(); gv.dirty = true; }
  const zoomBy = (f) => zoomAt(f, st.T);
  function fit() { tl.pps = minPps(); tl.t0 = 0; clampView(); gv.dirty = true; }
  function zoomShot() { const i = gv.sel, a = SHOTS[i].t0, b = SHOTS[i].t1; tl.pps = clamp(viewW() * 0.62 / (b - a), minPps(), 220); tl.t0 = (a + b) / 2 - viewW() / tl.pps / 2; clampView(); gv.dirty = true; }
  $t('gvZoomIn').onclick = () => zoomBy(1.5); $t('gvZoomOut').onclick = () => zoomBy(1 / 1.5); $t('gvZoomFit').onclick = fit; $t('gvZoomShot').onclick = zoomShot;
  $t('gvTLFollow').onchange = (e) => { tl.follow = e.target.checked; };

  function resize() {
    const r = cv.parentElement.getBoundingClientRect(); tl.dpr = Math.min(devicePixelRatio || 1, 2);
    tl.w = Math.max(100, Math.floor(r.width)); tl.h = Math.max(60, Math.floor(r.height));
    cv.width = Math.floor(tl.w * tl.dpr); cv.height = Math.floor(tl.h * tl.dpr);
    if (!tl.inited) { tl.inited = true; tl.pps = 12; tl.t0 = 0; } clampView(); gv.dirty = true;
  }
  new ResizeObserver(resize).observe(cv.parentElement); resize();

  /* drawing */
  const rr = (x, y, w, h, r = 3) => { ctx.beginPath(); ctx.roundRect(x, y, Math.max(0, w), h, r); };
  const shade = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  function text(s, x, y, color = COL.text, font = '11.5px system-ui,sans-serif', align = 'left') { ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); }
  function fitText(s, maxW) { if (ctx.measureText(s).width <= maxW) return s; let n = s.length; while (n > 1 && ctx.measureText(s.slice(0, n) + '…').width > maxW) n--; return n > 1 ? s.slice(0, n) + '…' : ''; }

  function draw(T) {
    tl.lastT = T; const W = tl.w, H = tl.h;
    if (tl.follow && st.playing && !tl.dragView) { const vis = viewW() / tl.pps; if (T < tl.t0 + vis * 0.08 || T > tl.t0 + vis * 0.9) { tl.t0 = clamp(T - vis * 0.25, 0, Math.max(0, FILM - vis)); } }
    clampView();
    ctx.setTransform(tl.dpr, 0, 0, tl.dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
    const vis = viewW() / tl.pps, ta = tl.t0 - 1, tb = tl.t0 + vis + 1;
    const selI = gv.sel, selShot = SHOTS[selI], ov = gv.ov[selShot.t0];

    // tracks (clipped below the ruler, scrolled)
    ctx.save(); ctx.beginPath(); ctx.rect(0, TOP, W, H - TOP); ctx.clip(); ctx.translate(0, -tl.scrollY);
    for (const tr of tracks) {
      const y = tr.y, h = tr.h;
      if (y - tl.scrollY > H || y + h - tl.scrollY < TOP) continue;
      ctx.fillStyle = COL.row; ctx.fillRect(HW, y, W - HW, h);
      ctx.save(); ctx.beginPath(); ctx.rect(HW, y, W - HW, h); ctx.clip();
      if (tr.id === 'chap') {
        CHAPTERS.forEach((c, i) => { const x0 = tx(c.t0), x1 = tx(c.t1); if (x1 < HW || x0 > W) return; ctx.fillStyle = shade(GV_CHAP_COL[i], 0.28); rr(x0 + 1, y + 2, x1 - x0 - 2, h - 8, 4); ctx.fill(); ctx.fillStyle = GV_CHAP_COL[i]; ctx.fillRect(x0 + 1, y + 2, 3, h - 8); text(fitText(`${c.num}  ${c.name}`, x1 - x0 - 14), Math.max(x0, HW) + 9, y + h / 2 - 2, COL.text, '600 11.5px system-ui'); });
        for (const [t0, set] of SET_SCHEDULE) { const idx = SET_SCHEDULE.findIndex((a) => a[0] === t0), t1 = SET_SCHEDULE[idx + 1] ? SET_SCHEDULE[idx + 1][0] : FILM; ctx.fillStyle = GV_SET_COL[set]; ctx.fillRect(tx(t0) + 1, y + h - 5, Math.max(1, tx(t1) - tx(t0) - 2), 3); }
      } else if (tr.id === 'beat') {
        BEATS.forEach((b, i) => { const x0 = tx(b.t0), x1 = tx(b.t1); if (x1 < HW || x0 > W) return; const ci = chapterAt(b.t0 + 0.01); ctx.fillStyle = shade(GV_CHAP_COL[ci], i % 2 ? 0.2 : 0.3); rr(x0 + 1, y + 2, x1 - x0 - 2, h - 4, 4); ctx.fill(); if (x1 - x0 > 30) text(fitText(b.name, x1 - x0 - 10), Math.max(x0, HW) + 6, y + h / 2, COL.text, '11px system-ui'); });
      } else if (tr.id === 'shot') {
        SHOTS.forEach((s, i) => {
          const x0 = tx(s.t0), x1 = tx(s.t1); if (x1 < HW || x0 > W) return; const w = x1 - x0 - 1, ci = chapterAt(s.t0 + 0.01), sel = i === selI, edited = !!gv.ov[s.t0];
          ctx.fillStyle = shade(GV_CHAP_COL[ci], 0.2); rr(x0, y + 2, w, h - 4, 4); ctx.fill();
          const th = gv.thumbs[i]; if (th && w > 22) { ctx.save(); rr(x0, y + 2, w, h - 4, 4); ctx.clip(); const hh = h - 4, ww = hh * (192 / 108); for (let k = 0; k * ww < w; k++) ctx.drawImage(th, x0 + k * ww, y + 2, ww, hh); ctx.fillStyle = 'rgba(8,10,14,.35)'; ctx.fillRect(x0, y + 2, w, hh); ctx.restore(); }
          ctx.strokeStyle = sel ? COL.cyan : shade(GV_CHAP_COL[ci], 0.75); ctx.lineWidth = sel ? 2 : 1; rr(x0 + 0.5, y + 2.5, w - 1, h - 5, 4); ctx.stroke();
          if (edited) { ctx.fillStyle = COL.edit; ctx.fillRect(x0 + 1, y + 2, w - 2, 3); }
          if (w > 26) { ctx.font = '600 11px system-ui'; const label = fitText(`S${i + 1} ${gvShotTitle(s.t0, i)}`, w - 8); if (label) { ctx.fillStyle = 'rgba(8,10,14,.7)'; const tw = ctx.measureText(label).width; ctx.fillRect(Math.max(x0, HW) + 3, y + h - 20, tw + 8, 15); text(label, Math.max(x0, HW) + 7, y + h - 12.5, sel ? COL.cyan : COL.text, '600 11px system-ui'); } }
        });
      } else if (tr.id === 'keys') {
        // edited shots are marked everywhere; the selected shot shows its keyframes
        for (const t0 of Object.keys(gv.ov)) { const i = SHOTS.findIndex((s) => s.t0 === +t0), s = SHOTS[i]; const x0 = tx(s.t0), x1 = tx(s.t1); if (x1 < HW || x0 > W) continue; ctx.fillStyle = shade(COL.edit, i === selI ? 0.2 : 0.1); rr(x0, y + 2, x1 - x0 - 1, h - 4, 4); ctx.fill(); }
        if (ov) {
          const x0 = tx(selShot.t0), x1 = tx(selShot.t1); ctx.strokeStyle = shade(COL.edit, 0.6); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y + h / 2); ctx.lineTo(x1, y + h / 2); ctx.stroke();
          ov.keys.forEach((k, n) => { const x = tx(gv.shotT(selI, k.u)), cy = y + h / 2, on = n === gv.selKey; ctx.save(); ctx.translate(x, cy); ctx.rotate(Math.PI / 4); ctx.fillStyle = on ? COL.edit : '#7a5a24'; ctx.strokeStyle = on ? '#fff' : '#1a1408'; ctx.lineWidth = 1.5; ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10); ctx.restore(); });
        } else { const x0 = tx(selShot.t0), x1 = tx(selShot.t1); ctx.setLineDash([4, 3]); ctx.strokeStyle = COL.faint; ctx.lineWidth = 1; rr(x0 + 0.5, y + 3.5, x1 - x0 - 1, h - 7, 4); ctx.stroke(); ctx.setLineDash([]); if (x1 - x0 > 90) text('Press E to key this shot', Math.max(x0, HW) + 8, y + h / 2, COL.faint, '11px system-ui'); }
      } else if (tr.id === 'light') {
        const sa = Math.max(SYNC_T0, ta), sb = Math.min(213.6, tb);
        if (sb > sa) { if (tl.pps > 6) { ctx.strokeStyle = 'rgba(200,240,96,.14)'; ctx.lineWidth = 1; ctx.beginPath(); for (let t = SYNC_T0 + Math.ceil((sa - SYNC_T0) / SYNC_P) * SYNC_P; t < sb; t += SYNC_P) { ctx.moveTo(tx(t) + 0.5, y + 2); ctx.lineTo(tx(t) + 0.5, y + h - 2); } ctx.stroke(); } else { ctx.fillStyle = 'rgba(200,240,96,.07)'; ctx.fillRect(tx(sa), y + 2, tx(sb) - tx(sa), h - 4); } }
        ctx.lineWidth = 2; ctx.strokeStyle = COL.ember; ctx.beginPath(); for (const t of EMBER_FLASHES) if (t > ta && t < tb) { ctx.moveTo(tx(t), y + h - 3); ctx.lineTo(tx(t), y + h / 2 + 2); } ctx.stroke();
        ctx.strokeStyle = COL.hero; ctx.beginPath(); for (const [t, a] of HERO_FLASHES) if (t > ta && t < tb) { ctx.moveTo(tx(t), y + h / 2 - 1); ctx.lineTo(tx(t), y + h / 2 - 1 - Math.min(1, a) * (h / 2 - 5)); } ctx.stroke();
        text('Robot', HW + 4 + 0, y + 7, shade(COL.hero, 0.7), '9.5px system-ui'); text('Ember', HW + 4, y + h - 7, shade(COL.ember, 0.7), '9.5px system-ui');
      } else if (tr.id === 'ev') {
        for (const e of EVENTS) { if (e.t < ta || e.t > tb) continue; const x = tx(e.t); ctx.fillStyle = COL.dim; ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x + 4, y + 11); ctx.lineTo(x - 4, y + 11); ctx.fill(); if (tl.pps > 13) text(e.name, x + 6, y + 14, COL.dim, '10px system-ui'); }
      } else if (tr.curve) {
        const def = curveDefs.get(tr.curve), pad = 4, ih = h - pad * 2, span = def.max - def.min || 1;
        ctx.strokeStyle = COL.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(HW, y + h - pad - ((0 - def.min) / span) * ih + 0.5); ctx.lineTo(W, y + h - pad - ((0 - def.min) / span) * ih + 0.5); ctx.stroke();
        const col = def.channel ? COL.cyan : COL.gold; ctx.beginPath(); let first = true;
        const pts = [];
        for (let x = HW; x <= W; x += 1.5) { const t = tAt(x); if (t < 0 || t > FILM) continue; const v = def.fn(t), yy = y + h - pad - ((v - def.min) / span) * ih; pts.push([x, yy]); }
        if (pts.length) { ctx.beginPath(); ctx.moveTo(pts[0][0], y + h - pad); pts.forEach(([x, yy]) => ctx.lineTo(x, yy)); ctx.lineTo(pts[pts.length - 1][0], y + h - pad); ctx.closePath(); ctx.fillStyle = shade(col, 0.12); ctx.fill(); ctx.beginPath(); pts.forEach(([x, yy], n) => (n ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy))); ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke(); }
        if (def.channel && tl.pps > 3) { ctx.fillStyle = '#fff'; for (const kt of def.keys()) { if (kt < ta || kt > tb) continue; const yy = y + h - pad - ((def.fn(kt) - def.min) / span) * ih, x = tx(kt); ctx.save(); ctx.translate(x, yy); ctx.rotate(Math.PI / 4); ctx.fillStyle = COL.cyan; ctx.fillRect(-2.5, -2.5, 5, 5); ctx.restore(); } }
      }
      ctx.restore();
    }
    ctx.restore();

    // header column
    ctx.fillStyle = '#0d1016'; ctx.fillRect(0, TOP, HW, H - TOP);
    ctx.save(); ctx.beginPath(); ctx.rect(0, TOP, HW, H - TOP); ctx.clip(); ctx.translate(0, -tl.scrollY);
    for (const tr of tracks) {
      const y = tr.y; ctx.fillStyle = '#12161e'; ctx.fillRect(0, y, HW - 2, tr.h);
      text(tr.name, 10, y + (tr.curve ? 12 : tr.h / 2), COL.dim, '600 11.5px system-ui');
      if (tr.curve) { const def = curveDefs.get(tr.curve); text(def.fmt(def.fn(T)), 10, y + 28, def.channel ? COL.cyan : COL.gold, '11px ui-monospace,monospace'); if (tr.removable) text('×', HW - 14, y + 11, COL.faint, '15px system-ui', 'center'); }
      if (tr.id === 'shot') text(`S${selI + 1} selected`, 10, y + tr.h / 2 + 14, COL.cyan, '10.5px system-ui');
    }
    ctx.restore();

    // ruler and overview
    ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, W, TOP);
    // overview: the whole film with the visible window
    const ovx0 = HW, ovw = W - HW - 6;
    CHAPTERS.forEach((c, i) => { ctx.fillStyle = shade(GV_CHAP_COL[i], 0.5); ctx.fillRect(ovx0 + (c.t0 / FILM) * ovw, 3, ((c.t1 - c.t0) / FILM) * ovw - 1, OV_H - 6); });
    ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; const wx = ovx0 + (tl.t0 / FILM) * ovw, ww = Math.max(6, (vis / FILM) * ovw); ctx.fillRect(wx, 1, ww, OV_H - 2); ctx.strokeRect(wx + 0.5, 1.5, ww - 1, OV_H - 3);
    ctx.fillStyle = COL.head; ctx.fillRect(ovx0 + (T / FILM) * ovw - 1, 0, 2, OV_H);
    text(`${gvFmt(T)}`, 10, OV_H / 2 + 1, COL.dim, '10px ui-monospace,monospace');
    // ruler ticks
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]; let major = steps.find((s) => s * tl.pps >= 70) || 60; const minor = major / (major >= 5 ? 5 : major >= 1 ? 4 : 5);
    ctx.save(); ctx.beginPath(); ctx.rect(HW, OV_H, W - HW, RULER_H); ctx.clip();
    ctx.strokeStyle = COL.faint; ctx.lineWidth = 1; ctx.beginPath();
    for (let t = Math.floor(ta / minor) * minor; t < tb; t += minor) { const x = Math.round(tx(t)) + 0.5, isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6; ctx.moveTo(x, OV_H + RULER_H - (isMajor ? 10 : 5)); ctx.lineTo(x, OV_H + RULER_H); }
    ctx.stroke();
    for (let t = Math.floor(ta / major) * major; t < tb; t += major) if (t >= 0) text(major < 1 ? gvFmtF(t) : gvFmt(t), tx(t) + 4, OV_H + 8, COL.dim, '10.5px ui-monospace,monospace');
    ctx.restore();
    ctx.strokeStyle = COL.line; ctx.beginPath(); ctx.moveTo(0, TOP - 0.5); ctx.lineTo(W, TOP - 0.5); ctx.moveTo(HW - 0.5, 0); ctx.lineTo(HW - 0.5, H); ctx.stroke();

    // vertical scrollbar when the tracks overflow
    const maxS = Math.max(0, tl.contentH - (H - TOP));
    if (maxS > 0) { const th = Math.max(24, (H - TOP) * ((H - TOP) / tl.contentH)), ty = TOP + (tl.scrollY / maxS) * (H - TOP - th); ctx.fillStyle = 'rgba(255,255,255,.22)'; rr(W - 7, ty, 4, th, 2); ctx.fill(); }

    // playhead
    const px = tx(T); if (px >= HW - 1 && px <= W) { ctx.strokeStyle = COL.head; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px, OV_H); ctx.lineTo(px, H); ctx.stroke(); ctx.fillStyle = COL.head; ctx.beginPath(); ctx.moveTo(px - 6, OV_H); ctx.lineTo(px + 6, OV_H); ctx.lineTo(px, OV_H + 9); ctx.fill(); }
  }

  /* interaction */
  const trackAtY = (y) => { const yy = y + tl.scrollY; return tracks.find((t) => yy >= t.y && yy < t.y + t.h); };
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let mode = null, wasPlaying = false, keyDrag = -1, ovDrag = null;
  function scrubTo(x) { seekTo(clamp(tAt(x), 0, FILM - 0.02)); gv.dirty = true; }
  cv.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e); cv.setPointerCapture(e.pointerId); wasPlaying = st.playing;
    if (y < OV_H) { const ovw = tl.w - HW - 6; const wx = HW + (tl.t0 / FILM) * ovw, ww = (viewW() / tl.pps / FILM) * ovw; if (x >= wx && x <= wx + ww) { mode = 'pan'; ovDrag = { x, t0: tl.t0 }; } else { tl.t0 = ((x - HW) / ovw) * FILM - viewW() / tl.pps / 2; clampView(); mode = 'pan'; ovDrag = { x, t0: tl.t0 }; } tl.dragView = true; gv.dirty = true; return; }
    if (x < HW) { const tr = trackAtY(y); if (tr?.removable && x > HW - 24) { const id = tr.curve, n = userCurves.indexOf(id); if (n >= 0) userCurves.splice(n, 1); rebuildTracks(); gv.dirty = true; } return; }
    const tr = y >= TOP ? trackAtY(y) : null;
    if (tr?.id === 'keys') { const ov = gv.ov[SHOTS[gv.sel].t0]; if (ov) { let best = -1, bd = 10; ov.keys.forEach((k, n) => { const d = Math.abs(tx(gv.shotT(gv.sel, k.u)) - x); if (d < bd) { bd = d; best = n; } }); if (best >= 0) { gv.selKey = best; mode = 'key'; keyDrag = best; setPlaying(false); seekTo(gv.keyT(gv.sel, ov.keys[best].u)); gv.dirty = true; gv.rebuildEdit(); document.querySelectorAll('#gvIShot .keys button').forEach((b) => b.classList.toggle('on', +b.dataset.key === best)); return; } } }
    mode = 'scrub'; setPlaying(false); gv.pinned = false; scrubTo(x);
  });
  cv.addEventListener('pointermove', (e) => {
    const [x, y] = pos(e);
    if (mode === 'scrub') { scrubTo(x); return; }
    if (mode === 'pan') { const ovw = tl.w - HW - 6; tl.t0 = ovDrag.t0 + ((x - ovDrag.x) / ovw) * FILM; clampView(); gv.dirty = true; return; }
    if (mode === 'key') { const ov = gv.ov[SHOTS[gv.sel].t0]; if (!ov) return; const u = (tAt(x) - SHOTS[gv.sel].t0) / gv.shotDur(gv.sel); gv.moveKeyU(keyDrag, u); seekTo(gv.keyT(gv.sel, ov.keys[keyDrag].u)); return; }
    // hover tooltip: time under the cursor
    const tip = $t('gvTip');
    if (x > HW && y > OV_H) { const t = clamp(tAt(x), 0, FILM), si = SHOTS.findIndex((s) => t < s.t1), b = BEATS[beatAt(t)]; tip.innerHTML = `<b>${gvFmtF(t)}</b><br>S${(si < 0 ? SHOTS.length : si + 1)} · ${gvEsc(gvShotTitle(SHOTS[Math.max(0, si)].t0, Math.max(0, si)))}<br>${gvEsc(b.name)}`; tip.style.left = Math.min(innerWidth - 220, e.clientX + 12) + 'px'; tip.style.top = Math.max(8, e.clientY - 76) + 'px'; tip.classList.remove('hidden'); } else tip.classList.add('hidden');
    const tr = y >= TOP ? trackAtY(y) : null; cv.style.cursor = tr?.id === 'keys' && gv.ov[SHOTS[gv.sel].t0] ? 'pointer' : y < OV_H ? 'grab' : 'default';
  });
  cv.addEventListener('pointerleave', () => $t('gvTip').classList.add('hidden'));
  const end = (e) => { if (!mode) return; if (mode === 'key') gv.commitKeys(); if (mode === 'scrub') setPlaying(wasPlaying); mode = null; tl.dragView = false; try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ } gv.dirty = true; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault(); const [x] = pos(e);
    if (e.shiftKey || x < HW) { tl.scrollY += e.deltaY; clampView(); gv.dirty = true; return; }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { tl.t0 += (e.deltaX / tl.pps); clampView(); gv.dirty = true; return; }
    zoomAt(Math.exp(-e.deltaY * 0.0016), x > HW ? tAt(x) : st.T);
  }, { passive: false });
  // double-click a shot to zoom to it
  cv.addEventListener('dblclick', (e) => { const [x, y] = pos(e); const tr = trackAtY(y); if (tr?.id === 'shot' && x > HW) zoomShot(); });

  return { draw, zoomBy, fit, zoomShot, fillTrackMenu, get lastT() { return tl.lastT; }, tl };
}
