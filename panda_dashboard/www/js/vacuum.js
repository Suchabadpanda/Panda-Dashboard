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

  // ── actions ──
  const fail = (e) => HD.app.toast(`Vacuum: ${e.message || e}`);
  function toggleRoom(segId) {
    segId = Number(segId);
    if (selected.has(segId)) selected.delete(segId); else selected.add(segId);
    HD.app.refresh();
  }
  function clean() {
    const e = entity();
    const segs = rooms().map((r) => r.id).filter((id) => selected.has(id));
    const p = segs.length
      ? HD.ha.callService('dreame_vacuum', 'vacuum_clean_segment', { entity_id: e, segments: segs })
      : HD.ha.callService('vacuum', 'start', { entity_id: e });
    p.then(() => { HD.app.toast(segs.length ? `Cleaning ${segs.length} room${segs.length > 1 ? 's' : ''}` : 'Cleaning the whole floor'); selected.clear(); HD.app.refresh(); }).catch(fail);
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
        <div class="vac-actions">
          <button class="btn" data-vac="clean" ${v.available ? '' : 'disabled'}>${sel.length ? `Clean ${sel.length} room${sel.length > 1 ? 's' : ''}` : 'Clean everywhere'}</button>
          ${v.busy ? '<button class="btn ghost" data-vac="pause">Pause</button>' : ''}
          ${v.state !== 'docked' ? `<button class="btn ghost" data-vac="dock" ${v.available ? '' : 'disabled'}>Dock</button>` : ''}
          ${sel.length ? '<button class="btn ghost" data-vac="clear">Clear</button>' : ''}
        </div>
      </div>
      <figure class="vac-map">${pic ? `<img src="${pic}" alt="Dreame map: rooms and where the robot is">` : '<p class="sub">The Dreame map appears here once the robot has mapped this floor.</p>'}</figure>
    </div>`;
  }

  // Auto-detected entities, so the dashboard's filtered subscription includes them
  const extraIds = () => (HD.config.vacuum === false ? [] : [entity(), mapCamera()].filter(Boolean));

  HD.vacuum = { configured, entity, info, rooms, planRoomFor, segmentFor, planFloor, selected, panelHtml, toggleRoom, extraIds };
})();
