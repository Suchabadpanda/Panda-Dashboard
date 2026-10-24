/*
 * Robot vacuum (Dreame Vacuum integration, github.com/Tasshack/dreame-vacuum).
 *
 * Reads the vacuum entity's attributes:
 *   battery, status, current_segment (room the robot is in), active_segments (rooms in
 *   the current job), selected_map, rooms: { "<map name>": [{ id, name, icon }] }
 * and the map camera (camera.<vacuum>_map), whose picture is the live Dreame map.
 *
 * Each Dreame map (one per floor) is matched to a floor-plan floor ("1F" ↔ "First floor"),
 * and its rooms to plan rooms by name ("Hallway" ↔ "Hall"), or explicitly with
 * HD.config.vacuum.maps = { '<map>': '<plan floor name>' } and
 * HD.config.vacuum.rooms = { '<map>': { '<Dreame room name or id>': '<plan room id>' } }.
 * With no HD.config.vacuum.entity, the first vacuum entity that has Dreame room
 * attributes is used, so nothing needs configuring once the integration is set up.
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  const cfg = () => HD.config.vacuum || {};
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const selected = new Set();   // Dreame segment ids picked for the next clean

  function entity() {
    if (cfg().entity) return cfg().entity;
    const all = Object.keys(S().states || {}).filter((id) => id.startsWith('vacuum.'));
    return all.find((id) => S().attr(id, 'rooms')) || all[0] || null;
  }
  function mapCamera() {
    if (cfg().map) return cfg().map;
    const e = entity(); if (!e) return null;
    const guess = `camera.${e.split('.')[1]}_map`;
    return S().get(guess) ? guess : null;
  }
  const configured = () => HD.config.vacuum !== false && !!entity() && !!S().get(entity());

  // ── maps and floors ──
  // Dreame keeps one saved map per floor; the vacuum's `rooms` attribute is
  // { "<map name>": [{ id, name }] } and `selected_map` is the floor it's on now.
  const currentMap = () => S().attr(entity(), 'selected_map');
  function rooms(mapName = currentMap()) {
    const all = S().attr(entity(), 'rooms') || {};
    const list = all[mapName] || (mapName === currentMap() ? Object.values(all)[0] : null) || [];
    return list.map((r) => ({ id: Number(r.id), name: r.name }));
  }

  function floorKey(name) {
    const n = norm(name);
    if (/^(g|gf|ground|ground floor|0f)$/.test(n)) return 0;
    const m = n.match(/^(\d)(?:f|st|nd|rd|th)?(?: floor)?$/); if (m) return Number(m[1]);
    const words = ['first', 'second', 'third', 'fourth']; const w = n.split(' ')[0];
    return words.includes(w) ? words.indexOf(w) + 1 : n;
  }
  // Floor-plan floor for a Dreame map ("1F" → "First floor"), or config.vacuum.maps
  function planFloor(mapName) {
    const floors = HD.config.floorplan ? HD.config.floorplan.floors : [];
    const named = (cfg().maps || {})[mapName];
    return floors.find((f) => f.name === (named || '') ) || floors.find((f) => floorKey(f.name) === floorKey(mapName)) || null;
  }

  // Names that mean the same room in the Dreame app and on an estate agent's plan
  const SAME = [['hall', 'hallway', 'landing', 'corridor', 'entrance'], ['bathroom', 'wc', 'toilet', 'bath', 'ensuite', 'shower room'],
    ['living room', 'lounge', 'sitting room'], ['kitchen', 'kitchen family', 'kitchen diner'], ['office', 'study']];
  const alike = (a, b) => a === b || SAME.some((g) => g.includes(a) && g.includes(b));

  // Dreame segment id (on a map) → floor-plan room id
  function planRoomFor(segId, mapName = currentMap()) {
    const r = rooms(mapName).find((x) => x.id === Number(segId)); if (!r) return null;
    const floor = planFloor(mapName); if (!floor) return null;
    const map = (cfg().rooms || {})[mapName] || {};
    if (map[r.id] !== undefined || map[r.name] !== undefined) return map[r.id] ?? map[r.name];
    const n = norm(r.name);
    const cands = floor.rooms.filter((p) => (p.kind || 'room') !== 'stairs');
    const hit = cands.find((p) => alike(norm(p.name), n) || (p.sensor && alike(norm(p.sensor), n)));
    return hit ? hit.id : null;
  }
  function segmentFor(planId, mapName = currentMap()) {
    const r = rooms(mapName).find((x) => planRoomFor(x.id, mapName) === planId);
    return r ? r.id : null;
  }

  // ── robot position on the plan ──
  // The map camera reports room boxes and the robot/dock positions in the vacuum's own
  // millimetre coordinates. Matching room centres to the plan's rooms gives a linear fit
  // per axis (which also picks up a map drawn the other way round), so the robot can be
  // drawn where it actually is rather than just in the right room.
  const pts = (str) => str.trim().split(/\s+/).map((q) => q.split(',').map(Number));
  function fit(pairs) {
    const n = pairs.length; if (n < 2) return null;
    const mx = pairs.reduce((a, p) => a + p[0], 0) / n; const my = pairs.reduce((a, p) => a + p[1], 0) / n;
    const sxx = pairs.reduce((a, p) => a + (p[0] - mx) ** 2, 0); if (sxx < 1e-6) return null;
    const k = pairs.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx;
    return (v) => my + k * (v - mx);
  }
  function transform() {
    const cam = mapCamera(); const mapName = currentMap(); const floor = planFloor(mapName);
    const boxes = cam && S().attr(cam, 'rooms'); if (!boxes || !floor) return null;
    const xs = []; const ys = [];
    Object.values(boxes).forEach((b) => {
      const pid = planRoomFor(b.room_id, mapName); const room = pid && floor.rooms.find((r) => r.id === pid);
      if (!room || b.x0 == null) return;
      const p = pts(room.points); const px = p.map((q) => q[0]); const py = p.map((q) => q[1]);
      xs.push([(b.x0 + b.x1) / 2, (Math.min(...px) + Math.max(...px)) / 2]);
      ys.push([(b.y0 + b.y1) / 2, (Math.min(...py) + Math.max(...py)) / 2]);
    });
    const fx = fit(xs); const fy = fit(ys);
    if (!fx || !fy) return null;
    const vb = floor.viewBox.split(/\s+/).map(Number);
    return (pos) => {
      if (!pos || pos.x == null) return null;
      const x = fx(pos.x); const y = fy(pos.y);
      return x >= vb[0] && x <= vb[0] + vb[2] && y >= vb[1] && y <= vb[1] + vb[3] ? { x, y } : null;
    };
  }

  function info() {
    const e = entity();
    const st = S().state(e);
    const mapName = currentMap();
    const active = (S().attr(e, 'active_segments') || []).map(Number);
    const cur = Number(S().attr(e, 'current_segment')) || null;
    const t = transform(); const cam = mapCamera();
    const floor = planFloor(mapName);
    return {
      entity: e, state: st, available: S().available(e),
      battery: S().attr(e, 'battery') ?? S().attr(e, 'battery_level'),
      status: S().attr(e, 'status') || st,
      busy: ['cleaning', 'returning'].includes(st),
      map: mapName, floor: floor ? floor.name : null,
      current: cur, currentPlan: cur ? planRoomFor(cur) : null,
      active, activePlan: active.map((id) => planRoomFor(id)).filter(Boolean),
      robotAt: t && cam ? t(S().attr(cam, 'vacuum_position')) : null,
      dockAt: t && cam ? t(S().attr(cam, 'charger_position')) : null,
    };
  }

  // The Dreame map camera updates every few seconds while cleaning (and Home Assistant
  // rotates the picture's access token), so its URL keeps changing. Swapping the <img> src
  // straight away blanked the picture while each new one downloaded, which made the map
  // blink. Instead the newest picture is fetched in the background and only shown once it
  // has loaded and decoded; the page keeps showing the previous one until then.
  let shown = null; let loading = null; let lastTry = 0;
  function latestUrl() {
    const cam = mapCamera(); const s = cam && S().get(cam);
    const url = s && s.attributes.entity_picture;
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    return `${HD.ha.baseUrl()}${url}${url.includes('?') ? '&' : '?'}v=${Date.parse(s.last_updated || s.last_changed) || 0}`;
  }
  function pictureUrl() {
    const want = latestUrl();
    if (!want) return shown;
    if (!shown || want.startsWith('data:')) { shown = want; return shown; }
    // At most one download at a time, and not more often than every 3 s
    if (want !== shown && want !== loading && Date.now() - lastTry > 3000) {
      lastTry = Date.now(); loading = want;
      const img = new Image();
      img.src = want;
      (img.decode ? img.decode() : new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; }))
        .then(() => {
          shown = want;
          document.querySelectorAll('.vac-map img').forEach((el) => { el.src = want; });   // same element, no blank frame
          HD.app.refresh();
        })
        .catch(() => { /* keep the old picture; the next update tries again */ })
        .finally(() => { if (loading === want) loading = null; });
    }
    return shown;
  }

  // ── Map zoom ──
  // The Dreame picture is mostly empty margin round a small map, so the view starts
  // fitted to the map itself (found from the pixels), and can be zoomed with the
  // +/− buttons, the mouse wheel, a pinch or a double tap, and dragged when zoomed in.
  // The figure's markup is rewritten on live updates but the <img> is kept (setHTML's
  // keep), so the transform lives on the <img> and all events are delegated.
  // Zooming changes nothing in Home Assistant, so it isn't a control for view-only screens.
  const Z = { s: 1, tx: 0, ty: 0, user: false, map: null, box: null, boxFor: null, bg: '' };
  const MAX_ZOOM = 6;   // × the fitted view

  // Bounding box of the drawn map in picture pixels: anything not transparent and not
  // the background colour (the corner pixel). Downscaled, so it's cheap on each new picture.
  function contentBox(img) {
    const W = img.naturalWidth; const H = img.naturalHeight;
    if (!W || !H) return null;
    try {
      const k = Math.min(1, 320 / Math.max(W, H)); const w = Math.max(1, Math.round(W * k)); const h = Math.max(1, Math.round(H * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      // Background = the commonest of four points just inside the corners (screenshots and
      // some renderers have a 1 px frame of another colour)
      const m = Math.min(w - 1, h - 1, Math.max(2, Math.round(Math.min(w, h) * 0.02)));
      const corners = [[m, m], [w - 1 - m, m], [m, h - 1 - m], [w - 1 - m, h - 1 - m]].map(([x, y]) => (y * w + x) * 4);
      const same = (i, j) => Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]) + Math.abs(d[i + 3] - d[j + 3]) < 24;
      const ref = corners.reduce((best, i) => (corners.filter((j) => same(i, j)).length > corners.filter((j) => same(best, j)).length ? i : best), corners[0]);
      const [br, bg, bb, ba] = d.slice(ref, ref + 4);
      Z.bg = ba >= 200 ? `rgb(${br} ${bg} ${bb})` : '';   // the frame takes the picture's own background
      const isBg = (i) => d[i + 3] < 16 || (ba >= 16 && Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) < 24);
      let x0 = w; let y0 = h; let x1 = -1; let y1 = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x < m || y < m || x >= w - m || y >= h - m || isBg((y * w + x) * 4)) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0 || (x1 - x0) * (y1 - y0) > w * h * 0.9) return null;   // empty, or already fills it
      const pad = 0.03 * Math.max(x1 - x0, y1 - y0) + 2;
      const bx = Math.max(0, x0 - pad); const by = Math.max(0, y0 - pad);
      return { x: bx / k, y: by / k, w: (Math.min(w, x1 + 1 + pad) - bx) / k, h: (Math.min(h, y1 + 1 + pad) - by) / k };
    } catch (e) { return null; }   // a picture from another origin can't be read: show it whole
  }

  const zoomImg = () => document.querySelector('.vac-map img');
  function view(img) {
    const fig = img && img.closest('.vac-map'); if (!fig) return null;
    const W = img.naturalWidth; const H = img.naturalHeight; if (!W || !H || !fig.clientWidth) return null;
    return { fig, W, H, vw: fig.clientWidth, vh: fig.clientHeight };
  }
  function fitted(v) {
    const b = Z.box || { x: 0, y: 0, w: v.W, h: v.H };
    const s = Math.min(v.vw / b.w, v.vh / b.h);
    return { s, tx: (v.vw - b.w * s) / 2 - b.x * s, ty: (v.vh - b.h * s) / 2 - b.y * s };
  }
  // Zoom runs from the whole picture to MAX_ZOOM × the fit
  function limit(v, s) {
    const f = fitted(v).s;
    return Math.min(f * MAX_ZOOM, Math.max(Math.min(f, v.vw / v.W, v.vh / v.H), s));
  }
  // …and the picture never slides off: centred when smaller than the frame, edge to edge when bigger
  function keepOnScreen(v) {
    const w = v.W * Z.s; const h = v.H * Z.s;
    Z.tx = w <= v.vw ? (v.vw - w) / 2 : Math.min(0, Math.max(v.vw - w, Z.tx));
    Z.ty = h <= v.vh ? (v.vh - h) / 2 : Math.min(0, Math.max(v.vh - h, Z.ty));
  }
  function applyZoom() {
    const img = zoomImg(); const v = view(img); if (!v) return;
    if (Z.map !== currentMap()) { Z.map = currentMap(); Z.user = false; }   // another floor: start fitted
    if (Z.boxFor !== img.currentSrc) { Z.boxFor = img.currentSrc; Z.bg = ''; Z.box = contentBox(img); }
    v.fig.style.background = Z.bg;
    if (!Z.user) Object.assign(Z, fitted(v)); else { Z.s = limit(v, Z.s); keepOnScreen(v); }
    img.style.width = `${v.W}px`; img.style.height = `${v.H}px`;   // an SVG with no size of its own would stretch to the frame
    img.style.transform = `translate(${Z.tx}px, ${Z.ty}px) scale(${Z.s})`;
    v.fig.classList.toggle('zoomed', Z.user && Z.s > fitted(v).s * 1.02);
    v.fig.classList.add('ready');
  }
  // Zoom by `k` about a point in the figure (default: its centre)
  function zoomBy(k, px, py) {
    const v = view(zoomImg()); if (!v) return;
    if (px == null) { px = v.vw / 2; py = v.vh / 2; }
    const s1 = limit(v, Z.s * k); const r = s1 / Z.s;
    Z.tx = px - (px - Z.tx) * r; Z.ty = py - (py - Z.ty) * r; Z.s = s1; Z.user = true;
    applyZoom();
  }
  function resetZoom() { Z.user = false; applyZoom(); }
  const local = (fig, x, y) => { const r = fig.getBoundingClientRect(); return [x - r.left, y - r.top]; };

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-vzoom]'); if (!b) return;
    const k = b.dataset.vzoom;
    if (k === 'in') zoomBy(1.5); else if (k === 'out') zoomBy(1 / 1.5); else resetZoom();
  });
  document.addEventListener('wheel', (ev) => {
    const fig = ev.target.closest && ev.target.closest('.vac-map.ready'); if (!fig) return;
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    zoomBy(Math.exp(-Math.max(-100, Math.min(100, dy)) / 300), ...local(fig, ev.clientX, ev.clientY));
  }, { passive: false });
  // Drag and pinch. Tracked on window, because the figure itself is replaced on live updates.
  const ptrs = new Map(); let pinch = null; let lastTap = 0; let moved = false;
  document.addEventListener('pointerdown', (ev) => {
    const fig = ev.target.closest && ev.target.closest('.vac-map.ready');
    if (!fig || ev.target.closest('[data-vzoom]') || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    ptrs.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    moved = false; pinch = null;
    if (ev.pointerType === 'mouse') ev.preventDefault();   // no image drag-and-drop
  });
  window.addEventListener('pointermove', (ev) => {
    const p = ptrs.get(ev.pointerId); if (!p) return;
    const fig = document.querySelector('.vac-map.ready'); if (!fig) return;
    if (ptrs.size === 1) {
      const dx = ev.clientX - p.x; const dy = ev.clientY - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (Z.user) { Z.tx += dx; Z.ty += dy; applyZoom(); }
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.entries()].map(([id, q]) => (id === ev.pointerId ? { x: ev.clientX, y: ev.clientY } : q));
      const d = Math.hypot(a.x - b.x, a.y - b.y); const mid = local(fig, (a.x + b.x) / 2, (a.y + b.y) / 2);
      if (pinch && pinch.d > 0) {
        Z.tx += mid[0] - pinch.mid[0]; Z.ty += mid[1] - pinch.mid[1];
        zoomBy(d / pinch.d, mid[0], mid[1]);
      }
      pinch = { d, mid }; moved = true;
    }
    p.x = ev.clientX; p.y = ev.clientY;
  });
  const up = (ev) => {
    if (!ptrs.delete(ev.pointerId)) return;
    if (ptrs.size < 2) pinch = null;
    if (ev.type !== 'pointerup' || moved || ptrs.size) return;
    // Double tap / double click: zoom in there, or back to the fit when fully zoomed in
    const now = Date.now();
    if (now - lastTap > 320) { lastTap = now; return; }
    lastTap = 0;
    const v = view(zoomImg()); if (!v) return;
    if (Z.s >= fitted(v).s * MAX_ZOOM * 0.98) resetZoom(); else zoomBy(2, ...local(v.fig, ev.clientX, ev.clientY));
  };
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  document.addEventListener('load', (ev) => { if (ev.target.matches && ev.target.matches('.vac-map img')) applyZoom(); }, true);
  window.addEventListener('resize', () => applyZoom());

  // ── How to clean ──
  // The Dreame integration exposes each cleaning setting as a select (or switch) entity
  // named after the vacuum: select.<vacuum>_cleaning_mode, _suction_level, _mop_pad_humidity,
  // _cleaning_route, _cleangenius, _cleangenius_mode … The vacuum entity also carries each
  // value as an attribute ("cleaning_mode": "Mopping after sweeping"), which stays readable
  // when the selects go unavailable — they do while it's cleaning, and the manual ones do
  // while CleanGenius is choosing for itself. Settings are sent straight to the robot, so
  // what's shown is what it will do next (the Dreame app shows the same).
  // Option ids differ between models, so every pick is matched against the select's own
  // options by name ("Vacuum and mop" ↔ vacuum_and_mop) rather than hard-coded.
  const prefix = () => (entity() || '').split('.')[1] || '';
  const sid = (domain, key) => `${domain}.${prefix()}_${key}`;
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  let passes = 1;                // times over each room, for the next clean (sent as repeats)

  // Current value of a setting as a slug, from the select (when live) or the vacuum's attribute
  function value(key) {
    const id = sid('select', key);
    if (S().available(id)) return slug(S().state(id));
    return slug(S().attr(entity(), key));
  }
  const exists = (key) => S().get(sid('select', key)) || S().attr(entity(), key) != null;
  const canSet = (key) => {
    const opts = S().attr(sid('select', key), 'options') || [];
    return S().available(sid('select', key)) && opts.length > 0;
  };
  // The select's option that matches any of these names, or null
  function option(key, names) {
    const opts = S().attr(sid('select', key), 'options') || [];
    const want = [].concat(names).map(slug);
    return opts.find((o) => want.includes(slug(o))) || null;
  }
  const geniusOn = () => { const v = value('cleangenius'); return !!v && v !== 'off'; };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(test, ms = 6000) {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (test()) return true; await wait(250); }
    return test();
  }
  async function setSelect(key, names) {
    // A setting that has just been unlocked (CleanGenius turned off) takes a moment to appear
    await waitFor(() => canSet(key) && option(key, names));
    const opt = option(key, names);
    if (!opt) throw new Error(canSet(key) ? `it doesn't offer ${[].concat(names)[0]}` : 'it isn\'t taking changes right now');
    await HD.ha.callService('select', 'select_option', { entity_id: sid('select', key), option: opt });
  }

  // What to clean with. Under CleanGenius only "vacuum and mop" and "mop after vacuum"
  // exist, so vacuum-only and mop-only switch CleanGenius off first.
  const MODES = [
    { id: 'vacuum', label: 'Vacuum only', names: ['sweeping'] },
    { id: 'mop', label: 'Mop only', names: ['mopping'] },
    { id: 'both', label: 'Vacuum & mop', names: ['sweeping_and_mopping'], genius: ['vacuum_and_mop', 'sweeping_and_mopping'] },
    { id: 'after', label: 'Vacuum, then mop', names: ['mopping_after_sweeping'], genius: ['mop_after_vacuum', 'mopping_after_sweeping'] },
  ];
  function currentMode() {
    const v = geniusOn() ? value('cleangenius_mode') : value('cleaning_mode');
    return (MODES.find((m) => [...m.names, ...(m.genius || [])].map(slug).includes(v)) || {}).id || null;
  }
  async function setMode(id) {
    const m = MODES.find((x) => x.id === id);
    if (geniusOn() && m.genius && exists('cleangenius_mode')) return setSelect('cleangenius_mode', m.genius);
    if (geniusOn()) await setSelect('cleangenius', ['off']);
    return setSelect('cleaning_mode', m.names);
  }

  // Deep clean: CleanGenius's deep mode when it's on, otherwise the deep cleaning route
  const isDeep = () => (geniusOn() ? value('cleangenius') === 'deepcleaning' : value('cleaning_route') === 'deep');
  const setDeep = (on) => (geniusOn()
    ? setSelect('cleangenius', on ? ['deep_cleaning', 'deep'] : ['routine_cleaning', 'routine'])
    : setSelect('cleaning_route', on ? ['deep'] : ['standard']));
  const setGenius = (on) => setSelect('cleangenius', on ? (isDeep() ? ['deep_cleaning', 'deep'] : ['routine_cleaning', 'routine']) : ['off']);

  // Plain picks: [setting, label, [[option name, button text]]]
  const PICKS = [
    ['suction_level', 'Suction', [['quiet', 'Quiet'], ['standard', 'Standard'], ['strong', 'Strong'], ['turbo', 'Turbo']]],
    ['mop_pad_humidity', 'Mop wetness', [['slightly_dry', 'Damp'], ['moist', 'Moist'], ['wet', 'Wet']]],
    ['cleaning_route', 'Route', [['quick', 'Quick'], ['standard', 'Standard'], ['intensive', 'Intensive'], ['deep', 'Deep']]],
  ];
  // Less-used settings, under "More settings": selects and switches the robot has
  const MORE_SELECTS = [
    ['carpet_cleaning', 'Carpets'], ['washing_mode', 'Mop washing'], ['water_temperature', 'Wash water'],
    ['drying_time', 'Mop drying'], ['auto_empty_mode', 'Auto-empty'], ['mop_extend_frequency', 'Mop extension'],
  ];
  const SWITCHES = [
    ['carpet_boost', 'Carpet boost'], ['intensive_carpet_cleaning', 'Intensive carpets'], ['max_suction_power', 'Max suction'],
    ['large_particles_boost', 'Large debris boost'], ['mop_extend', 'Mop extends to edges'], ['side_reach', 'Side brush reach'],
    ['gap_cleaning_extension', 'Gap cleaning'], ['mopping_under_furnitures', 'Mop under furniture'],
    ['mopping_with_detergent', 'Detergent when mopping'], ['mop_washing_with_detergent', 'Detergent when washing'],
    ['smart_mop_washing', 'Smart mop washing'], ['auto_drying', 'Auto-dry mop'], ['silent_drying', 'Quiet drying'],
    ['self_clean', 'Wash mop during clean'], ['stain_avoidance', 'Avoid stains'], ['dnd', 'Do not disturb'],
  ];
  const BUTTONS = [['start_auto_empty', 'Empty dust'], ['self_clean', 'Wash mop'], ['manual_drying', 'Dry mop']];
  const optLabel = (o) => cap(String(o).replace(/_/g, ' '));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function settingsHtml(v) {
    const { esc } = HD.u;
    if (!exists('cleaning_mode') && !exists('cleangenius')) return '';
    const genius = geniusOn();
    const mode = currentMode();
    const anyLive = ['cleaning_mode', 'cleangenius', 'cleaning_route', 'suction_level'].some(canSet);
    const lockNote = !anyLive ? (v.busy ? 'Settings unlock when it pauses or docks.' : 'The robot isn\'t taking changes right now.') : '';
    const dis = (ok) => (ok ? '' : 'disabled');
    const seg = (key, label, items, cur, attrs) => `<div class="vac-set"><span>${esc(label)}</span><div class="seg" role="radiogroup" aria-label="${esc(label)}">${items.map(([id, text, ok]) =>
      `<button class="${cur === id ? 'on' : ''}" role="radio" aria-checked="${cur === id}" data-vac="${key}" data-val="${esc(id)}" ${dis(ok)} ${attrs || ''}>${esc(text)}</button>`).join('')}</div></div>`;
    const modeOk = canSet('cleaning_mode') || canSet('cleangenius') || canSet('cleangenius_mode');
    const rows = [seg('mode', 'Clean', MODES.map((m) => [m.id, m.label, modeOk]), mode)];
    // Toggles: deep clean and CleanGenius
    const toggle = (key, label, on, ok, hint) => `<div class="vac-set"><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span>
      <button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-vac="${key}" ${dis(ok)}><i></i></button></div>`;
    rows.push(toggle('deep', 'Deep clean', isDeep(), genius ? canSet('cleangenius') : canSet('cleaning_route'),
      genius ? 'CleanGenius deep mode: slower, more passes' : 'Deep route: slower, overlapping passes'));
    if (exists('cleangenius')) rows.push(toggle('genius', 'CleanGenius', genius, canSet('cleangenius'), genius ? 'Picks suction and water by itself' : ''));
    // Suction / wetness / route, unless CleanGenius is choosing them or the mode doesn't use them
    PICKS.forEach(([key, label, items]) => {
      if (!exists(key)) return;
      if (key === 'suction_level' && mode === 'mop') return;
      if (key === 'mop_pad_humidity' && mode === 'vacuum') return;
      if (genius) return;
      const cur = value(key);
      const list = items.map(([o, text]) => [o, text, canSet(key) && !!option(key, o)]);
      rows.push(seg(`pick:${key}`, label, list, (items.find(([o]) => slug(o) === cur) || [])[0]));
    });
    rows.push(seg('passes', 'Passes', [[1, '1×', true], [2, '2×', true], [3, '3×', true]].map(([n, t, ok]) => [String(n), t, ok]), String(passes)));
    if (genius) rows.push('<p class="sub vac-note">CleanGenius chooses suction, water and route. Turn it off to set them yourself.</p>');

    // More settings
    const more = [];
    MORE_SELECTS.forEach(([key, label]) => {
      const id = sid('select', key); if (!S().get(id)) return;
      const opts = (S().attr(id, 'options') || []).filter((o) => o !== 'unavailable');
      const cur = S().available(id) ? S().state(id) : null;
      if (!opts.length) return;
      more.push(`<label class="vac-set"><span>${esc(label)}</span><select data-vac-select="${key}">${opts.map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(optLabel(o))}</option>`).join('')}</select></label>`);
    });
    const sw = SWITCHES.filter(([key]) => S().available(sid('switch', key))).map(([key, label]) => {
      const on = S().state(sid('switch', key)) === 'on';
      return `<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}" data-vac="switch" data-key="${key}">${esc(label)}</button>`;
    }).join('');
    const btns = BUTTONS.filter(([key]) => S().available(sid('button', key)) || S().state(sid('button', key)) === 'unknown').map(([key, label]) =>
      `<button class="btn ghost" data-vac="press" data-key="${key}">${esc(label)}</button>`).join('');
    const moreHtml = more.length || sw || btns ? `<details class="vac-more"><summary>More settings</summary>
      ${more.join('')}${sw ? `<p class="eyebrow-label">Options</p><div class="room-controls vac-switches">${sw}</div>` : ''}
      ${btns ? `<p class="eyebrow-label">Base station</p><div class="vac-actions">${btns}</div>` : ''}</details>` : '';

    return `<p class="eyebrow-label">How to clean</p>
      ${lockNote ? `<p class="sub vac-note">${esc(lockNote)}</p>` : ''}
      <div class="vac-settings">${rows.join('')}</div>${moreHtml}`;
  }

  // ── actions ──
  const fail = (e) => HD.app.toast(`Vacuum: ${e.message || e}`);
  const busySet = new Set();     // settings being sent, so a double tap doesn't send twice
  function send(key, job) {
    if (busySet.has(key)) return;
    busySet.add(key);
    job().catch(fail).finally(() => { busySet.delete(key); HD.app.refresh(); });
  }
  function toggleRoom(segId) {
    segId = Number(segId);
    if (selected.has(segId)) selected.delete(segId); else selected.add(segId);
    HD.app.refresh();
  }
  function clean() {
    const e = entity();
    let segs = rooms().map((r) => r.id).filter((id) => selected.has(id));
    const whole = !segs.length;
    // More than one pass needs a room clean (vacuum.start has no repeats), so name every room
    if (whole && passes > 1) segs = rooms().map((r) => r.id);
    const p = segs.length
      ? HD.ha.callService('dreame_vacuum', 'vacuum_clean_segment', { entity_id: e, segments: segs, ...(passes > 1 ? { repeats: passes } : {}) })
      : HD.ha.callService('vacuum', 'start', { entity_id: e });
    const what = whole ? 'the whole floor' : `${segs.length} room${segs.length > 1 ? 's' : ''}`;
    p.then(() => { HD.app.toast(`Cleaning ${what}${passes > 1 ? `, ${passes} passes` : ''}`); selected.clear(); HD.app.refresh(); }).catch(fail);
  }
  const pause = () => HD.ha.callService('vacuum', 'pause', { entity_id: entity() }).catch(fail);
  const dock = () => HD.ha.callService('vacuum', 'return_to_base', { entity_id: entity() }).catch(fail);

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-vac]'); if (!t) return;
    const a = t.dataset.vac;
    if (a === 'room') toggleRoom(t.dataset.seg);
    else if (a === 'clean') clean();
    else if (a === 'pause') pause();
    else if (a === 'dock') dock();
    else if (a === 'clear') { selected.clear(); HD.app.refresh(); }
    else if (a === 'mode') send('mode', () => setMode(t.dataset.val));
    else if (a === 'deep') send('deep', () => setDeep(!isDeep()));
    else if (a === 'genius') send('genius', () => setGenius(!geniusOn()));
    else if (a.startsWith('pick:')) { const key = a.slice(5); send(key, () => setSelect(key, t.dataset.val)); }
    else if (a === 'passes') { passes = Number(t.dataset.val) || 1; HD.app.refresh(); }
    else if (a === 'switch') {
      const id = sid('switch', t.dataset.key);
      send(id, () => HD.ha.callService('switch', S().state(id) === 'on' ? 'turn_off' : 'turn_on', { entity_id: id }));
    } else if (a === 'press') {
      const id = sid('button', t.dataset.key);
      send(id, () => HD.ha.callService('button', 'press', { entity_id: id }).then(() => HD.app.toast(`${t.textContent.trim()}: sent`)));
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target.closest('[data-vac-select]'); if (!t) return;
    const id = sid('select', t.dataset.vacSelect);
    send(id, () => HD.ha.callService('select', 'select_option', { entity_id: id, option: t.value }));
  });

  const STATE_TEXT = { cleaning: 'Cleaning', returning: 'Heading back to the dock', docked: 'Docked', paused: 'Paused', idle: 'Idle', error: 'Needs attention' };

  function panelHtml() {
    const { esc, cap } = HD.u;
    const v = info();
    // Use the floor plan's name for a room when it has one ("Room 1" → "Office")
    const floor = v.floor && HD.config.floorplan.floors.find((f) => f.name === v.floor);
    const list = rooms().map((r) => {
      const pid = planRoomFor(r.id); const pr = pid && floor && floor.rooms.find((x) => x.id === pid);
      return { ...r, name: pr ? pr.name : r.name };
    });
    const sel = list.filter((r) => selected.has(r.id));
    const curName = v.current ? (list.find((r) => r.id === v.current) || {}).name : null;
    const activeNames = list.filter((r) => v.active.includes(r.id)).map((r) => r.name);
    const pic = pictureUrl();
    if (pic) requestAnimationFrame(applyZoom);   // the figure is rewritten; put the zoom back on it
    const where = v.state === 'cleaning' && activeNames.length ? ` · ${activeNames.join(', ')}` : curName && v.state !== 'docked' ? ` · in ${curName}` : '';
    return `<div class="vac">
      <div class="vac-side">
        <p class="vac-state"><strong>${esc(STATE_TEXT[v.state] || cap(String(v.status || '–').replace(/_/g, ' ')))}</strong>${esc(where)}</p>
        ${v.map ? `<p class="sub">On the ${esc(v.floor ? v.floor.toLowerCase() : v.map)}. Other floors can be cleaned once it's carried there.</p>` : ''}
        ${v.battery != null ? `<div class="soc-bar"><i style="width:${v.battery}%"></i></div><p class="sub">Battery ${Math.round(v.battery)}%</p>` : ''}
        <p class="eyebrow-label">Rooms to clean on this floor</p>
        <div class="room-controls vac-rooms">
          ${list.map((r) => `<button class="chip ${selected.has(r.id) ? 'on' : ''} ${v.active.includes(r.id) ? 'busy' : ''}" data-vac="room" data-seg="${r.id}" aria-pressed="${selected.has(r.id)}">${esc(r.name)}</button>`).join('') || '<span class="sub">No rooms on the map yet</span>'}
        </div>
        ${settingsHtml(v)}
        <div class="vac-actions">
          <button class="btn" data-vac="clean" ${v.available ? '' : 'disabled'}>${sel.length ? `Clean ${sel.length} room${sel.length > 1 ? 's' : ''}` : 'Clean everywhere'}</button>
          ${v.busy ? '<button class="btn ghost" data-vac="pause">Pause</button>' : ''}
          ${v.state !== 'docked' ? `<button class="btn ghost" data-vac="dock" ${v.available ? '' : 'disabled'}>Dock</button>` : ''}
          ${sel.length ? '<button class="btn ghost" data-vac="clear">Clear</button>' : ''}
        </div>
      </div>
      <figure class="vac-map">${pic ? `<img src="${pic}" alt="Dreame map: rooms and where the robot is" draggable="false">
        <div class="vac-zoom" role="group" aria-label="Map zoom">
          <button type="button" data-vzoom="in" aria-label="Zoom in" title="Zoom in">+</button>
          <button type="button" data-vzoom="out" aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" data-vzoom="fit" aria-label="Fit the map" title="Fit the map">${HD.u.icon('fit')}</button>
        </div>` : '<p class="sub">The Dreame map appears here once the robot has mapped this floor.</p>'}</figure>
    </div>`;
  }

  // Auto-detected entities, so the dashboard's filtered subscription includes them
  // (the base entities plus every setting entity named after it)
  function extraIds() {
    if (HD.config.vacuum === false || !entity()) return [];
    const keys = ['cleaning_mode', 'cleangenius', 'cleangenius_mode', ...PICKS.map((p) => p[0]), ...MORE_SELECTS.map((p) => p[0])];
    const ids = [...keys.map((k) => sid('select', k)), ...SWITCHES.map(([k]) => sid('switch', k)), ...BUTTONS.map(([k]) => sid('button', k))];
    return [entity(), mapCamera(), ...ids.filter((id) => S().get(id))].filter(Boolean);
  }

  HD.vacuum = { configured, entity, info, rooms, planRoomFor, segmentFor, planFloor, selected, panelHtml, toggleRoom, extraIds };
})();
