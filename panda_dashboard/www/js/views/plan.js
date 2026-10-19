/*
 * Floor plan, drawn from HD.config.floorplan.
 *   live mode:  lights glow, presence pulses, AC/TV buttons, doorbell at the front door
 *   temp mode:  rooms shaded by temperature against the comfort target, with a scale
 * HD.plan.html(mode) returns markup; the Plan view and the Climate view both use it.
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
    if (d.ac && S().get(d.ac)) {
      const on = S().available(d.ac) && S().state(d.ac) !== 'off';
      items.push({ id: d.ac, label: 'AC', on, avail: S().available(d.ac) });
    }
    if (d.tv && S().get(d.tv)) {
      const st = S().state(d.tv);
      items.push({ id: d.tv, label: 'TV', on: S().available(d.tv) && !['off', 'standby'].includes(st), avail: S().available(d.tv) });
    }
    const w = fs * 2.6; const hgt = fs * 1.5; const gap = fs * 0.4;
    return items.map((it, i) => {
      const x = b.x1 - (w + gap) * (i + 1); const y = b.y0 + gap;
      return `<g class="dev ${it.on ? 'on' : ''} ${it.avail ? '' : 'off-line'}" ${it.avail ? `data-toggle="${it.id}" role="button" tabindex="0"` : ''} aria-label="${it.label} ${it.on ? 'on' : 'off'}">
        <rect x="${x}" y="${y}" width="${w}" height="${hgt}" rx="${hgt / 2}"/><text x="${x + w / 2}" y="${y + hgt * 0.7}" text-anchor="middle" font-size="${fs * 0.8}">${it.label}</text></g>`;
    }).join('');
  }

  function floorSvg(f, mode, idx) {
    const vb = f.viewBox.split(/\s+/).map(Number);
    const fs = vb[2] / 24;
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
      const cx = (b.x0 + b.x1) / 2; const cy = (b.y0 + b.y1) / 2;
      const small = (b.x1 - b.x0) < fs * 6 || (b.y1 - b.y0) < fs * 3;
      const tappable = d && d.lights.length && mode === 'live';
      const label = kind === 'stairs' ? '' : `<text class="rn" x="${b.x0 + fs * 0.6}" y="${b.y0 + fs * 1.4}" font-size="${small ? fs * 0.7 : fs}">${esc(r.name)}</text>`;
      let big = '';
      if (d && d.t != null && !small) {
        big = `<text class="rt" x="${cx}" y="${cy + fs * 0.6}" text-anchor="middle" font-size="${fs * (mode === 'temp' ? 2.4 : 1.6)}">${temp(d.t)}</text>`;
        if (mode === 'temp' && d.h != null) big += `<text class="rh" x="${cx}" y="${cy + fs * 2.1}" text-anchor="middle" font-size="${fs * 0.8}">${pct(d.h)} humidity</text>`;
      }
      const here = d && d.here && mode === 'live' ? `<circle class="pulse" cx="${cx}" cy="${cy + (big ? fs * 1.8 : 0)}" r="${fs * 0.55}"/>` : '';
      const devs = d && mode === 'live' && !small ? deviceButtons(r, d, b, fs) : '';
      const title = `${r.name}${d && d.t != null ? `, ${temp(d.t)}` : ''}${d && d.lit ? ', light on' : ''}${d && d.here ? ', someone here' : ''}`;
      return `<g class="${cls}" ${tappable ? `data-plan-room="${esc(r.id)}" role="button" tabindex="0"` : ''} aria-label="${esc(title)}">
        <polygon points="${r.points}" style="fill:${fill}"/>${label}${big}${here}</g>${devs}`;
    }).join('');

    let door = '';
    if (f.doorbell && C().doorbell && S().get(C().doorbell.camera)) {
      const { x, y } = f.doorbell; const r0 = fs * 0.7;
      const ringing = S().state(C().doorbell.ringing) === 'on' || S().state(C().doorbell.person) === 'on';
      const cone = `${x},${y} ${x - fs * 2.2},${y + fs * 2.6} ${x + fs * 2.2},${y + fs * 2.6}`;
      door = `<g class="doorcam ${ringing ? 'ringing' : ''}" data-doorbell-live role="button" tabindex="0" aria-label="Front door camera, open live view">
        <polygon class="cone" points="${cone}"/><circle cx="${x}" cy="${y}" r="${r0}"/></g>`;
    }

    return `<figure class="plan-floor"><figcaption>${esc(f.name)}</figcaption>
      <svg viewBox="${f.viewBox}" role="group" aria-label="${esc(f.name)}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="hatch${idx}" width="${fs * 0.6}" height="${fs * 0.6}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="${fs * 0.6}" height="${fs * 0.6}" fill="var(--panel)"/><line x1="0" y1="0" x2="0" y2="${fs * 0.6}" stroke="var(--line)" stroke-width="${fs * 0.12}"/></pattern>
          <radialGradient id="glow${idx}" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#e79a3c"/></radialGradient>
        </defs>
        ${rooms}${door}
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
    return `<ul class="plan-key"><li><i class="k-lit"></i>Light on — tap a room to switch</li><li><i class="k-here"></i>Someone there</li>${C().doorbell ? '<li><i class="k-door"></i>Front door camera — tap for live view</li>' : ''}</ul>`;
  }

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

  let mode = 'live';
  HD.views.plan = {
    title: 'Plan',
    mount(root) {
      root.innerHTML = `<section class="panel plan-panel">
        <header><h2>${mode === 'live' ? 'Around the house' : 'Room temperatures'}</h2>
          <div class="seg" role="group" aria-label="Plan view">
            <button data-plan-mode="live" class="${mode === 'live' ? 'on' : ''}">Live</button>
            <button data-plan-mode="temp" class="${mode === 'temp' ? 'on' : ''}">Temperature</button>
          </div></header>
        <div id="plan-body"></div></section>`;
      root.querySelectorAll('[data-plan-mode]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.planMode; this.mount(root); }));
      this.update();
    },
    update() { const el = document.getElementById('plan-body'); if (el) el.innerHTML = html(mode); },
  };
})();
