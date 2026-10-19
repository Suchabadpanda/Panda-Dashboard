/*
 * Robot vacuum (Dreame Vacuum integration, github.com/Tasshack/dreame-vacuum).
 *
 * Reads the vacuum entity's attributes:
 *   battery, status, current_segment (room the robot is in), active_segments (rooms in
 *   the current job), selected_map, rooms: { "<map name>": [{ id, name, icon }] }
 * and the map camera (camera.<vacuum>_map), whose picture is the live Dreame map.
 *
 * Dreame rooms are matched to floor-plan rooms by name ("Kitchen" ↔ "Kitchen / family"),
 * or explicitly with HD.config.vacuum.rooms = { <Dreame room id or name>: '<plan room id>' }.
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

  // Rooms on the map the robot is using now
  function rooms() {
    const e = entity(); const all = (e && S().attr(e, 'rooms')) || {};
    const mapName = S().attr(e, 'selected_map');
    const list = all[mapName] || Object.values(all)[0] || [];
    return list.map((r) => ({ id: Number(r.id), name: r.name }));
  }

  function planRooms() { return (HD.config.floorplan ? HD.config.floorplan.floors : []).flatMap((f) => f.rooms); }

  // Dreame segment id → floor-plan room id
  function planRoomFor(segId) {
    const r = rooms().find((x) => x.id === Number(segId)); if (!r) return null;
    const map = cfg().rooms || {};
    if (map[r.id] || map[r.name]) return map[r.id] || map[r.name];
    const n = norm(r.name);
    const candidates = planRooms().filter((p) => (p.kind || 'room') !== 'stairs');
    const exact = candidates.find((p) => norm(p.name) === n || norm(p.sensor) === n);
    if (exact) return exact.id;
    const partial = candidates.find((p) => norm(p.name).split(' ').includes(n) || n.split(' ').includes(norm(p.name)));
    return partial ? partial.id : null;
  }
  function segmentFor(planId) {
    const r = rooms().find((x) => planRoomFor(x.id) === planId);
    return r ? r.id : null;
  }

  function info() {
    const e = entity();
    const st = S().state(e);
    const active = (S().attr(e, 'active_segments') || []).map(Number);
    const cur = Number(S().attr(e, 'current_segment')) || null;
    return {
      entity: e, state: st, available: S().available(e),
      battery: S().attr(e, 'battery') ?? S().attr(e, 'battery_level'),
      status: S().attr(e, 'status') || st,
      busy: ['cleaning', 'returning'].includes(st),
      current: cur, currentPlan: cur ? planRoomFor(cur) : null,
      active, activePlan: active.map(planRoomFor).filter(Boolean),
    };
  }

  function pictureUrl() {
    const cam = mapCamera(); const s = cam && S().get(cam);
    const url = s && s.attributes.entity_picture;
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    return `${HD.ha.baseUrl()}${url}${url.includes('?') ? '&' : '?'}v=${Date.parse(s.last_updated || s.last_changed) || 0}`;
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
    const list = rooms();
    const sel = list.filter((r) => selected.has(r.id));
    const curName = v.current ? (list.find((r) => r.id === v.current) || {}).name : null;
    const activeNames = list.filter((r) => v.active.includes(r.id)).map((r) => r.name);
    const pic = pictureUrl();
    const where = v.state === 'cleaning' && activeNames.length ? ` · ${activeNames.join(', ')}` : curName && v.state !== 'docked' ? ` · in ${curName}` : '';
    return `<div class="vac">
      <div class="vac-side">
        <p class="vac-state"><strong>${esc(STATE_TEXT[v.state] || cap(String(v.status || '–').replace(/_/g, ' ')))}</strong>${esc(where)}</p>
        ${v.battery != null ? `<div class="soc-bar"><i style="width:${v.battery}%"></i></div><p class="sub">Battery ${Math.round(v.battery)}%</p>` : ''}
        <p class="eyebrow-label">Rooms to clean</p>
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

  HD.vacuum = { configured, entity, info, rooms, planRoomFor, segmentFor, selected, panelHtml, toggleRoom };
})();
