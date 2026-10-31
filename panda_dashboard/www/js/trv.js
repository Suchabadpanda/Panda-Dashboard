/*
 * Smart radiator valves (TRVs) on the Home room tiles.
 *
 * room.trv = 'climate.office_trv_thermostat'
 *   or { climate, name?, battery?, external?, externalSwitch? }
 *
 * Companion entities are found from the climate id, the way ZHA names a SONOFF TRVZB
 * (climate.<p>_thermostat):
 *   sensor.<p>_battery
 *   number.<p>_external_temperature_sensor_value   (the reading an HA automation feeds in)
 *   switch.<p>_external_temperature_sensor          (valve uses that reading instead of its own)
 *
 * The tile chip shows the target (warm while the valve is calling for heat); tapping it
 * opens a small dialog with the target stepper, Off/Heat, and whether the valve is being
 * fed the room sensor. Stepper buttons are controls (view-only screens can look, not change).
 */
window.HD = window.HD || {};

(function () {
  const { esc, icon } = HD.u;
  const S = () => HD.store;

  const conf = (r) => (typeof r.trv === 'string' ? { climate: r.trv } : r.trv || null);
  function ids(r) {
    const c = conf(r); if (!c || !c.climate) return null;
    const p = c.climate.split('.')[1].replace(/_thermostat$/, '');
    return {
      climate: c.climate,
      name: c.name || `${r.name} radiator`,
      battery: c.battery || `sensor.${p}_battery`,
      external: c.external || `number.${p}_external_temperature_sensor_value`,
      externalSwitch: c.externalSwitch || `switch.${p}_external_temperature_sensor`,
    };
  }
  const rooms = () => (HD.config.floors || []).flatMap((f) => f.rooms || []).filter((r) => r.trv);
  const findRoom = (name) => rooms().find((r) => r.name === name);

  // ── target (shown at once, sent after a short pause, like the AC stepper) ──
  const pending = {}; const timers = {};
  const STEP = 0.5;
  const target = (id) => (pending[id] != null ? pending[id] : S().attr(id, 'temperature'));
  const fmtT = (v) => (v == null || !Number.isFinite(Number(v)) ? '–' : (Math.round(Number(v) * 10) / 10).toFixed(Number(v) % 1 ? 1 : 0));

  function status(t) {
    const st = S().state(t.climate); const avail = S().available(t.climate);
    const action = S().attr(t.climate, 'hvac_action');
    return {
      avail, off: avail && st === 'off',
      heating: avail && st !== 'off' && action === 'heating',
      text: !avail ? 'Unavailable' : st === 'off' ? 'Off' : action === 'heating' ? 'Heating · valve open' : 'Idle · room at target',
    };
  }

  function chip(r) {
    const t = ids(r); if (!t) return '';
    const s = status(t);
    const tgt = target(t.climate);
    const label = s.off ? 'Off' : `${fmtT(tgt)}°`;
    const tip = `${t.name}: ${s.text}${!s.off && s.avail && tgt != null ? ` · target ${fmtT(tgt)}°` : ''}`;
    if (open === r.name) queueMicrotask(renderDialog);
    return `<button class="chip appliance chip-trv ${s.heating ? 'heating' : ''} ${s.off || !s.avail ? 'idle-off' : ''}" data-trv="${esc(r.name)}" aria-label="${esc(tip)}" title="${esc(tip)}">${icon('radiator')}<span>${esc(label)}</span></button>`;
  }

  // ── dialog ──
  let open = null;   // room name while the dialog is showing
  function dlg() {
    let d = document.getElementById('trv-dialog');
    if (!d) {
      d = Object.assign(document.createElement('dialog'), { id: 'trv-dialog', className: 'trv-dialog' });
      d.addEventListener('click', (ev) => { if (ev.target === d || ev.target.closest('[data-trv-close]')) d.close(); });
      d.addEventListener('close', () => { open = null; });
      document.body.appendChild(d);
    }
    return d;
  }

  function sensorLine(r, t) {
    const sw = S().state(t.externalSwitch);
    if (sw === undefined) return '';
    const fed = S().num(t.external); const room = S().num(r.temp);
    if (sw !== 'on') return `<p class="trv-note warn">${icon('alert')}Using its own sensor next to the radiator, so it reads warm and closes early.</p>`;
    if (room != null && fed != null && Math.abs(room - fed) > 0.5) {
      return `<p class="trv-note warn">${icon('alert')}Last given ${fmtT(fed)}°, but the room sensor says ${fmtT(room)}°. Check the automation that feeds it.</p>`;
    }
    return `<p class="trv-note">${icon('check')}Regulating on the room sensor (${fmtT(fed)}°).</p>`;
  }

  function renderDialog() {
    const r = open && findRoom(open); if (!r) return;
    const t = ids(r); const s = status(t);
    const lo = Math.max(5, Number(S().attr(t.climate, 'min_temp')) || 5);
    const hi = Math.min(30, Number(S().attr(t.climate, 'max_temp')) || 30);
    const tgt = target(t.climate);
    const can = s.avail && !s.off && tgt != null;
    const roomT = S().num(r.temp) ?? S().num(S().attr(t.climate, 'current_temperature'));
    const bat = S().num(t.battery);
    const html = `<header><h3>${icon('radiator')}${esc(t.name)}</h3><button class="btn ghost" data-trv-close aria-label="Close">Close</button></header>
      <p class="trv-state ${s.heating ? 'heating' : ''}">${esc(s.text)}</p>
      <div class="trv-main">
        <div class="ac-step" role="group" aria-label="${esc(t.name)} target">
          <button data-trv-temp="-1" data-trv-id="${t.climate}" aria-label="Cooler" ${can && tgt > lo ? '' : 'disabled'}>−</button>
          <b class="${pending[t.climate] != null ? 'pending' : ''}">${fmtT(tgt)}<small>°</small></b>
          <button data-trv-temp="1" data-trv-id="${t.climate}" aria-label="Warmer" ${can && tgt < hi ? '' : 'disabled'}>+</button></div>
        ${roomT != null ? `<p class="ac-room"><small>Room</small>${fmtT(roomT)}°</p>` : ''}
      </div>
      <div class="seg" role="group" aria-label="${esc(t.name)} mode">
        <button data-hvac="${t.climate}" data-mode="off" class="${s.off ? 'on' : ''}" ${s.avail ? '' : 'disabled'}>Off</button>
        <button data-hvac="${t.climate}" data-mode="heat" class="${s.avail && !s.off ? 'on' : ''}" ${s.avail ? '' : 'disabled'}>Heat</button></div>
      ${sensorLine(r, t)}
      ${bat != null ? `<p class="trv-note muted">${icon('bolt')}Battery ${Math.round(bat)}%${bat < 20 ? ' · replace soon' : ''}</p>` : ''}`;
    HD.u.setHTML(dlg(), html);
  }

  function show(name) {
    if (!findRoom(name)) return;
    open = name;
    const d = dlg(); d._html = null;
    renderDialog();
    if (!d.open) d.showModal();
  }

  function nudge(id, dir) {
    const lo = Math.max(5, Number(S().attr(id, 'min_temp')) || 5);
    const hi = Math.min(30, Number(S().attr(id, 'max_temp')) || 30);
    const cur = Number(target(id)); if (!Number.isFinite(cur)) return;
    pending[id] = Math.min(hi, Math.max(lo, Math.round((cur + dir * STEP) / STEP) * STEP));
    clearTimeout(timers[id]);
    renderDialog(); HD.app.refresh();
    timers[id] = setTimeout(() => {
      delete timers[id];
      const v = pending[id];
      HD.ha.callService('climate', 'set_temperature', { entity_id: id, temperature: v })
        .catch((e) => HD.app.toast(`Radiator: ${e.message || e}`))
        // keep showing the new value until Home Assistant reports it (or give up after 8 s)
        .finally(() => setTimeout(() => { if (pending[id] === v) { delete pending[id]; renderDialog(); HD.app.refresh(); } }, 8000));
    }, 800);
  }

  document.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-trv]');
    if (c) { show(c.dataset.trv); return; }
    const b = ev.target.closest('[data-trv-temp]');
    if (b && !b.disabled) nudge(b.dataset.trvId, Number(b.dataset.trvTemp));
    // Off/Heat use [data-hvac], handled in app.js; redraw the dialog once HA answers
  });

  // Drop a pending target once Home Assistant reports it
  function settle() {
    Object.keys(pending).forEach((id) => { if (Number(S().attr(id, 'temperature')) === pending[id] && !timers[id]) delete pending[id]; });
  }

  function extraIds() {
    return rooms().flatMap((r) => { const t = ids(r); return t ? [t.climate, t.battery, t.external, t.externalSwitch] : []; });
  }

  HD.trv = { chip: (r) => { settle(); return chip(r); }, extraIds, show };
})();
