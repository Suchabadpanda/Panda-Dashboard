/*
 * Floor plan, drawn from HD.config.floorplan.
 *   live mode:  lights glow, presence pulses, AC/TV buttons, doorbell at the front door
 *   temp mode:  rooms shaded by temperature against the comfort target, with a scale
 * HD.plan.html(mode) returns markup for the Rooms view.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, temp, pct } = HD.u;
  const S = () => HD.store;
  const C = () => HD.config;

  const roomByName = (name) => C().floors.flatMap((f) => f.rooms).find((r) => r.name === name);
  const pts = (s) => s.trim().split(/\s+/).map((p) => p.split(',').map(Number));
  function bbox(points) {
    const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  // Shade for a temperature: cool blue below target, warm red above (±3 °C saturates)
  function tempFill(t) {
    const c = C().comfortTarget;
    const d = Math.max(-3, Math.min(3, t - c));
    const amt = Math.round((Math.abs(d) / 3) * 78);
    return `color-mix(in oklab, var(${d < 0 ? '--cool' : '--warm'}) ${amt}%, var(--room))`;
  }

  function roomData(r) {
    const src = r.sensor ? roomByName(r.sensor) : null;
    const t = src ? S().num(src.temp) : null;
    const h = src ? S().num(src.hum) : null;
    const lights = r.lights || [];
    const lit = lights.some((id) => S().state(id) === 'on');
    const occ = r.occupancy || (src && src.motion);
    const here = occ ? S().state(occ) === 'on' : false;
    return { src, t, h, lights, lit, here, ac: src && src.climate, tv: src && src.tv };
  }

  function deviceButtons(r, d, b, fs) {
    const items = [];
    if (d.ac) {
      const on = S().available(d.ac) && S().state(d.ac) !== 'off';
      items.push({ id: d.ac, label: 'AC', on, avail: S().available(d.ac) });
    }
    if (d.tv) {
      const st = S().state(d.tv);
      items.push({ id: d.tv, label: 'TV', on: S().available(d.tv) && !['off', 'standby'].includes(st), avail: S().available(d.tv) });
    }
    const w = fs * 2.6; const hgt = fs * 1.5; const gap = fs * 0.4;
    return items.map((it, i) => {
      const x = b.x + (w + gap) * i; const y = b.y + fs * 0.7;
      return `<g class="dev ${it.on ? 'on' : ''} ${it.avail ? '' : 'off-line'}" ${it.avail ? `data-toggle="${it.id}" role="button" tabindex="0"` : ''} aria-label="${it.label} ${it.on ? 'on' : 'off'}">
        <rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${hgt / 2}"/><text x="${x + w / 2}" y="${y + hgt * 0.7}" text-anchor="middle" font-size="${fs * 0.8}">${it.label}</text></g>`;
    }).join('');
  }

  // Top-left spot for a room's name that sits inside the room's outline (rooms with a
  // notch, like an L-shaped kitchen, would otherwise put it outside the walls)
  function labelAnchor(poly, b, lfs, chars) {
    const pad = lfs * 0.6; const w = chars * lfs * 0.55;
    const fits = (x, y) => inside(poly, x, y - lfs) && inside(poly, x + w, y - lfs) && inside(poly, x, y + lfs * 0.3) && inside(poly, x + w, y + lfs * 0.3);
    const step = lfs * 0.5;
    for (let dy = 0; dy < (b.y1 - b.y0) / 2; dy += step) {
      for (let dx = 0; dx < (b.x1 - b.x0) / 2; dx += step) {
        const x = b.x0 + pad + dx; const y = b.y0 + lfs * 1.4 + dy;
        if (fits(x, y)) return { x, y };
      }
    }
    return { x: b.x0 + pad, y: b.y0 + lfs * 1.4 };
  }

  // Where a room's temperature goes: the middle of the biggest rectangle that fits inside
  // the room. For an L-shaped room that's the centre of its main part, where the
  // bounding-box centre would sit low or off to one side, near the corner of the L.
  // Rooms are traced with square walls, so the rectangles come from the room's own corners.
  const centres = new Map();
  function visualCentre(key, poly, b) {
    if (centres.has(key)) return centres.get(key);
    const xs = [...new Set(poly.map((q) => q[0]))].sort((a, c) => a - c);
    const ys = [...new Set(poly.map((q) => q[1]))].sort((a, c) => a - c);
    // Which grid cells between the corners are inside the room
    const cell = xs.slice(0, -1).map((x, i) => ys.slice(0, -1).map((y, k) => inside(poly, (x + xs[i + 1]) / 2, (y + ys[k + 1]) / 2)));
    let best = null;
    for (let i0 = 0; i0 < xs.length - 1; i0++) for (let i1 = i0 + 1; i1 < xs.length; i1++) {
      for (let k0 = 0; k0 < ys.length - 1; k0++) for (let k1 = k0 + 1; k1 < ys.length; k1++) {
        const area = (xs[i1] - xs[i0]) * (ys[k1] - ys[k0]);
        if (best && area <= best.area) continue;
        let ok = true;
        for (let i = i0; i < i1 && ok; i++) for (let k = k0; k < k1 && ok; k++) ok = cell[i][k];
        if (ok) best = { area, x: (xs[i0] + xs[i1]) / 2, y: (ys[k0] + ys[k1]) / 2 };
      }
    }
    const c = best || { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    centres.set(key, c);
    return c;
  }

  // Ray-casting point-in-polygon
  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }

  // Robot vacuum marker: a disc with a bumper line; pulses while cleaning
  function robot(x, y, fs, state) {
    const r = fs * 0.85;
    return `<g class="robot ${state}" aria-label="Robot vacuum, ${state}"><circle class="halo" cx="${x}" cy="${y}" r="${r * 1.6}"/>
      <circle cx="${x}" cy="${y}" r="${r}"/><circle class="eye" cx="${x}" cy="${y - r * 0.35}" r="${r * 0.28}"/>
      <path d="M${x - r * 0.62},${y + r * 0.35} A${r * 0.72},${r * 0.72} 0 0 0 ${x + r * 0.62},${y + r * 0.35}" /></g>`;
  }

  function floorSvg(f, mode, idx) {
    const vb = f.viewBox.split(/\s+/).map(Number);
    // Every floor is drawn at the same scale (see .plan-floor svg in the CSS), so one text
    // size in plan units gives the same size on screen on every floor
    const fs = commonFs();
    const vacAll = HD.vacuum && HD.vacuum.configured() ? HD.vacuum.info() : null;
    const vac = vacAll && vacAll.floor === f.name ? vacAll : null;   // the robot's on this floor
    let bots = '';   // drawn last so later rooms don't cover them
    if (vac && mode !== 'temp') {
      if (vac.dockAt && mode === 'vac') bots += `<g class="dock" aria-label="Robot dock"><rect x="${vac.dockAt.x - fs * 0.7}" y="${vac.dockAt.y - fs * 0.5}" width="${fs * 1.4}" height="${fs}" rx="${fs * 0.2}"/></g>`;
      const showAny = vac.state !== 'docked' || mode === 'vac';
      if (showAny && vac.robotAt) bots += robot(vac.robotAt.x, vac.robotAt.y, fs, vac.state);
    }
    const rooms = f.rooms.map((r) => {
      const p = pts(r.points); const b = bbox(p);
      const kind = r.kind || 'room';
      const d = kind === 'room' || r.lights || r.occupancy ? roomData(r) : null;
      let fill = 'var(--room)'; let cls = `pr ${kind}`;
      if (kind === 'stairs') fill = `url(#hatch${idx})`;
      else if (kind === 'store') fill = 'var(--panel)';
      else if (kind === 'wet') fill = 'color-mix(in oklab, var(--cool) 10%, var(--room))';
      if (d && mode === 'temp' && d.t != null) fill = tempFill(d.t);
      if (d && mode === 'live' && d.lit) { fill = `url(#glow${idx})`; cls += ' lit'; }
      if (d && d.here && mode === 'live') cls += ' here';
      const seg = vac ? HD.vacuum.segmentFor(r.id) : null;
      if (vac && vac.state === 'cleaning' && vac.activePlan.includes(r.id) && mode !== 'temp') cls += ' vac-active';
      if (mode === 'vac') {
        if (seg != null) cls += ' vac-room';
        if (seg != null && HD.vacuum.selected.has(seg)) { cls += ' vac-sel'; fill = 'color-mix(in oklab, var(--accent) 38%, var(--room))'; }
      }
      const vc = visualCentre(`${f.name}|${r.points}`, p, b);
      const cx = vc.x; const cy = vc.y;
      const small = (b.x1 - b.x0) < fs * 6 || (b.y1 - b.y0) < fs * 3;
      const tappable = d && d.lights.length && mode === 'live';
      const vacTap = mode === 'vac' && seg != null;
      // One name size everywhere; only a name too long for its room is shrunk to fit
      const roomW = b.x1 - b.x0;
      const lfs = Math.max(fs * 0.6, Math.min(fs, (roomW - fs * 1.2) / (r.name.length * 0.55)));
      const a = labelAnchor(p, b, lfs, r.name.length);
      const label = kind === 'stairs' ? '' : `<text class="rn" x="${a.x}" y="${a.y}" font-size="${lfs}">${esc(r.name)}</text>`;
      let big = '';
      if (d && d.t != null && !small && mode !== 'vac') {
        // Temperature (and humidity under it) centred as one block on the room's visual centre
        const tfs = fs * (mode === 'temp' ? 2.2 : 1.6);
        const withHum = mode === 'temp' && d.h != null;
        const base = cy + tfs * 0.36 - (withHum ? fs * 0.7 : 0);
        big = `<text class="rt" x="${cx}" y="${base}" text-anchor="middle" font-size="${tfs}">${temp(d.t)}</text>`;
        if (withHum) big += `<text class="rh" x="${cx}" y="${base + fs * 1.5}" text-anchor="middle" font-size="${fs * 0.8}">${pct(d.h)} humidity</text>`;
      }
      const here = d && d.here && mode === 'live' ? `<circle class="pulse" cx="${cx}" cy="${cy + (big ? fs * 1.8 : 0)}" r="${fs * 0.55}"/>` : '';
      const devs = d && mode === 'live' && !small ? deviceButtons(r, d, a, fs) : '';
      const showBot = vac && !vac.robotAt && vac.currentPlan === r.id && mode !== 'temp' && (vac.state !== 'docked' || mode === 'vac');
      if (showBot) {
        // Beside the temperature, nudged until it's inside the room's outline
        const spots = [[cx + fs * 3.7, cy], [cx - fs * 3.7, cy], [cx, cy + fs * 2.4], [cx, cy - fs * 2.4], [cx, cy]];
        const [x, y] = spots.find(([sx, sy]) => inside(p, sx, sy) && inside(p, sx + fs, sy + fs) && inside(p, sx - fs, sy - fs)) || [cx, cy];
        bots += robot(x, y, fs, vac.state);
      }
      const title = `${r.name}${d && d.t != null ? `, ${temp(d.t)}` : ''}${d && d.lit ? ', light on' : ''}${d && d.here ? ', someone here' : ''}`;
      const tap = vacTap ? `data-vac="room" data-seg="${seg}" role="button" tabindex="0" aria-pressed="${HD.vacuum.selected.has(seg)}"`
        : tappable ? `data-plan-room="${esc(r.id)}" role="button" tabindex="0"` : '';
      return `<g class="${cls}" ${tap} aria-label="${esc(title)}">
        <polygon class="fillp" points="${r.points}" style="fill:${fill}"/><polygon class="hl" points="${r.points}" clip-path="url(#clip${idx}-${esc(r.id)})"/><polygon class="edge" points="${r.points}"/>${label}${big}${here}</g>${devs}`;
    }).join('');

    let door = '';
    if (f.doorbell && C().doorbell && S().get(C().doorbell.camera)) {
      const { x, y } = f.doorbell; const r0 = fs * 0.7;
      const ringing = S().state(C().doorbell.ringing) === 'on' || S().state(C().doorbell.person) === 'on';
      const cone = `${x},${y} ${x - fs * 2.2},${y + fs * 2.6} ${x + fs * 2.2},${y + fs * 2.6}`;
      door = `<g class="doorcam ${ringing ? 'ringing' : ''}" data-doorbell-live role="button" tabindex="0" aria-label="Front door camera, open live view">
        <polygon class="cone" points="${cone}"/><circle cx="${x}" cy="${y}" r="${r0}"/></g>`;
    }

    const off = mode === 'vac' && vacAll && !vac ? ' vac-elsewhere' : '';
    return `<figure class="plan-floor${off}"><figcaption>${esc(f.name)}${mode === 'vac' && vac ? ' <span class="robot-here">· robot is here</span>' : ''}</figcaption>
      <svg viewBox="${f.viewBox}" role="group" aria-label="${esc(f.name)}" preserveAspectRatio="xMidYMid meet" style="--vbw:${vb[2]};--vbh:${vb[3]};--maxw:${sizes().w};--maxh:${sizes().h}">
        <defs>
          <pattern id="hatch${idx}" width="${fs * 0.6}" height="${fs * 0.6}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${fs * 0.6}" height="${fs * 0.6}" fill="var(--panel)"/><line x1="0" y1="0" x2="0" y2="${fs * 0.6}" stroke="var(--line)" stroke-width="${fs * 0.12}"/></pattern>
          ${f.rooms.map((r) => `<clipPath id="clip${idx}-${esc(r.id)}"><polygon points="${r.points}"/></clipPath>`).join('')}
          <radialGradient id="glow${idx}" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#e79a3c"/></radialGradient>
        </defs>
        ${rooms}${door}${bots}
      </svg></figure>`;
  }

  function headline() {
    const list = C().floors.flatMap((f) => f.rooms).map((r) => ({ name: r.name, t: S().num(r.temp) })).filter((r) => r.t != null);
    if (list.length < 2) return '';
    const warm = list.reduce((a, r) => (r.t > a.t ? r : a)); const cool = list.reduce((a, r) => (r.t < a.t ? r : a));
    return `<p class="headline">${esc(warm.name)} is ${(warm.t - cool.t).toFixed(1)}° warmer than ${esc(cool.name)}.</p>`;
  }

  function legend(mode) {
    if (mode === 'temp') {
      const c = C().comfortTarget;
      return `<div class="plan-scale" aria-hidden="true"><i></i><div><span>${c - 3}°</span><span>${c}°</span><span>${c + 3}°</span></div></div>`;
    }
    if (mode === 'vac') {
      return `<ul class="plan-key"><li><i class="k-sel"></i>Tap rooms to choose what to clean</li><li><i class="k-robot"></i>Robot</li><li><i class="k-active"></i>Being cleaned</li></ul>${HD.vacuum.panelHtml()}`;
    }
    return `<ul class="plan-key"><li><i class="k-lit"></i>Light on — tap a room to switch</li><li><i class="k-here"></i>Someone there</li>${C().doorbell ? '<li><i class="k-door"></i>Front door camera — tap for live view</li>' : ''}</ul>`;
  }

  // Plan units per text size, the same on every floor: based on the widest floor
  const sizes = () => {
    const vbs = C().floorplan.floors.map((f) => f.viewBox.split(/\s+/).map(Number));
    return { w: Math.max(...vbs.map((v) => v[2])), h: Math.max(...vbs.map((v) => v[3])) };
  };
  const commonFs = () => sizes().w / 24;

  function html(mode) {
    const fp = C().floorplan;
    if (!fp || !fp.floors) return '<p class="empty">Add a floor plan in config.js to see it here.</p>';
    return `${mode === 'temp' ? headline() : ''}<div class="plan-floors">${fp.floors.map((f, i) => floorSvg(f, mode, `-${mode}-${i}`)).join('')}</div>${legend(mode)}`;
  }

  // Tapping a room toggles its lights (all off if any is on, else all on)
  document.addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-plan-room]'); if (!g) return;
    const room = C().floorplan.floors.flatMap((f) => f.rooms).find((r) => r.id === g.dataset.planRoom);
    if (!room || !room.lights) return;
    const anyOn = room.lights.some((id) => S().state(id) === 'on');
    room.lights.forEach((id) => {
      if ((S().state(id) === 'on') === anyOn) HD.ha.toggle(id).catch((e) => HD.app.toast(`Couldn't switch that: ${e.message}`));
    });
  });
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('svg [role="button"]')) { ev.preventDefault(); ev.target.closest('[role="button"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  HD.plan = { html };
})();
