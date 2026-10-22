/*
 * Air conditioning cards on the Rooms page.
 *
 * Everything shown comes from what each climate entity says it supports, so a unit only
 * gets the controls it really has:
 *   - mode (hvac_modes), what it's doing now (hvac_action) and the room temperature
 *   - target temperature stepper (min_temp / max_temp / target_temp_step); taps are
 *     gathered for 0.8 s and sent as one set_temperature
 *   - "More controls": fan speed (fan_modes), swing up/down (swing_modes), swing
 *     left/right (swing_horizontal_modes), preset (preset_modes: eco, boost, sleep…),
 *     target humidity in dry mode (min/max_humidity)
 *   - extra switches and selects on the same Home Assistant device (display light, beeper,
 *     quiet, turbo, vane position…), found from the entity registry at connect. A room can
 *     list them itself instead with `acExtras: ['switch.x', 'select.y']`.
 * Which cards have "More controls" open is kept per screen (localStorage hd.acOpen).
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  const esc = (s) => HD.u.esc(s);
  const ORDER = ['off', 'cool', 'heat', 'heat_cool', 'auto', 'dry', 'fan_only'];
  const MODE_TEXT = { off: 'Off', cool: 'Cool', heat: 'Heat', heat_cool: 'Heat/cool', auto: 'Auto', dry: 'Dry', fan_only: 'Fan' };
  const ACTION_TEXT = { cooling: 'cooling', heating: 'heating', drying: 'drying', fan: 'fan running', idle: 'idle', defrosting: 'defrosting', preheating: 'warming up' };
  const WORDS = { fan_only: 'Fan', mid: 'Medium', middle: 'Medium', med: 'Medium', medium_low: 'Med-low', medium_high: 'Med-high',
    silent: 'Quiet', mute: 'Quiet', full: 'Max', strong: 'Strong', on: 'On', off: 'Off', both: 'Both',
    vertical: 'Up/down', horizontal: 'Left/right', swing: 'Swing', none: 'None', comfort: 'Comfort', eco: 'Eco',
    boost: 'Boost', sleep: 'Sleep', away: 'Away', home: 'Home', activity: 'Activity' };
  const label = (v) => {
    const k = String(v).toLowerCase();
    if (WORDS[k]) return WORDS[k];
    return HD.u.cap(String(v).replace(/[_-]+/g, ' '));
  };
  const SEG_MAX = 6;   // more options than this become a drop-down

  // ── units and their extra entities ──
  const extrasFound = {};   // climate id → [entity ids] from the registry
  function units() {
    return HD.config.floors.flatMap((f) => f.rooms).filter((r) => r.climate)
      .map((r) => ({ id: r.climate, name: r.name, room: r, extras: r.acExtras || extrasFound[r.climate] || [] }));
  }

  // Switches and selects on the same device as each AC. Run once per connect, before the
  // subscription, so they're watched like everything else. Config / plain controls only:
  // diagnostic entities, hidden and disabled ones are left out.
  async function resolveExtras(send) {
    const list = units().filter((u) => !u.room.acExtras);
    if (!list.length) return;
    const ents = await send({ type: 'config/entity_registry/list' });
    const byId = Object.fromEntries(ents.map((e) => [e.entity_id, e]));
    list.forEach((u) => {
      const dev = byId[u.id] && byId[u.id].device_id;
      if (!dev) return;
      extrasFound[u.id] = ents.filter((e) => e.device_id === dev && e.entity_id !== u.id
        && /^(switch|select)\./.test(e.entity_id) && !e.disabled_by && !e.hidden_by && e.entity_category !== 'diagnostic')
        .map((e) => e.entity_id).sort();
    });
  }
  const extraIds = () => units().flatMap((u) => u.extras);

  // Name of an extra without the device's own name in front ("Office AC Display" → "Display")
  function extraName(id, unit) {
    const full = S().attr(id, 'friendly_name') || id.split('.')[1].replace(/_/g, ' ');
    const dev = S().attr(unit.id, 'friendly_name') || '';
    const short = dev && full.toLowerCase().startsWith(dev.toLowerCase()) ? full.slice(dev.length).trim() : full;
    return HD.u.cap(short || full);
  }

  // ── state ──
  const pending = {};      // climate id → target temperature waiting to be sent
  const timers = {};
  const busy = new Set();
  let open = new Set();
  try { open = new Set(JSON.parse(localStorage.getItem('hd.acOpen') || '[]')); } catch (e) { /* storage blocked */ }
  const saveOpen = () => { try { localStorage.setItem('hd.acOpen', JSON.stringify([...open])); } catch (e) { /* storage blocked */ } };

  function target(id) { return pending[id] != null ? pending[id] : S().attr(id, 'temperature'); }
  function step(id) { return Number(S().attr(id, 'target_temp_step')) || 0.5; }
  const fmtT = (v, st) => (v == null ? '–' : (st < 1 ? Number(v).toFixed(1) : String(Math.round(v))));

  // ── markup ──
  function seg(id, kind, title, options, current, enabled) {
    if (!options || !options.length) return '';
    const cur = current == null ? null : String(current);
    const control = options.length > SEG_MAX
      ? `<select data-ac-select="${kind}" data-ac="${id}" ${enabled ? '' : 'disabled'}>
          ${cur != null && !options.map(String).includes(cur) ? `<option selected>${esc(label(cur))}</option>` : ''}
          ${options.map((o) => `<option value="${esc(o)}" ${String(o) === cur ? 'selected' : ''}>${esc(label(o))}</option>`).join('')}</select>`
      : `<div class="seg" role="group" aria-label="${esc(title)}">${options.map((o) =>
        `<button data-ac="${id}" data-ac-set="${kind}" data-val="${esc(o)}" class="${String(o) === cur ? 'on' : ''}" ${enabled ? '' : 'disabled'}>${esc(label(o))}</button>`).join('')}</div>`;
    return `<div class="ac-set"><span>${esc(title)}</span>${control}</div>`;
  }

  function moreHtml(u, avail) {
    const a = (k) => S().attr(u.id, k);
    const st = S().state(u.id);
    const hasH = Array.isArray(a('swing_horizontal_modes')) && a('swing_horizontal_modes').length;
    const rows = [
      seg(u.id, 'fan', 'Fan speed', a('fan_modes'), a('fan_mode'), avail),
      seg(u.id, 'swing', hasH ? 'Swing up/down' : 'Swing', a('swing_modes'), a('swing_mode'), avail),
      hasH ? seg(u.id, 'hswing', 'Swing left/right', a('swing_horizontal_modes'), a('swing_horizontal_mode'), avail) : '',
      seg(u.id, 'preset', 'Preset', a('preset_modes'), a('preset_mode'), avail),
    ];
    // Target humidity (some units take one in dry mode)
    if (a('humidity') != null && st === 'dry') {
      const lo = Number(a('min_humidity')) || 30; const hi = Number(a('max_humidity')) || 70;
      rows.push(`<div class="ac-set"><span>Humidity</span><div class="ac-step small">
        <button data-ac="${u.id}" data-ac-hum="-5" aria-label="Lower humidity" ${avail && a('humidity') > lo ? '' : 'disabled'}>−</button>
        <b>${Math.round(a('humidity'))}%</b>
        <button data-ac="${u.id}" data-ac-hum="5" aria-label="Raise humidity" ${avail && a('humidity') < hi ? '' : 'disabled'}>+</button></div></div>`);
    }
    // Extras on the same device
    const sw = []; const sel = [];
    u.extras.forEach((id) => {
      const s = S().get(id); if (!s) return;
      const ok = S().available(id);
      if (id.startsWith('switch.')) {
        const on = s.state === 'on';
        sw.push(`<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}" data-ac-switch="${id}" ${ok ? '' : 'disabled'}>${esc(extraName(id, u))}</button>`);
      } else if (id.startsWith('select.')) {
        const opts = s.attributes.options || [];
        if (!opts.length) return;
        sel.push(`<div class="ac-set"><span>${esc(extraName(id, u))}</span><select data-ac-option="${id}" ${ok ? '' : 'disabled'}>
          ${opts.map((o) => `<option value="${esc(o)}" ${o === s.state ? 'selected' : ''}>${esc(label(o))}</option>`).join('')}</select></div>`);
      }
    });
    const body = rows.join('') + sel.join('') + (sw.length ? `<div class="ac-switches">${sw.join('')}</div>` : '');
    if (!body.trim()) return '';
    const isOpen = open.has(u.id);
    return `<button class="ac-more-btn" data-ac-more="${u.id}" aria-expanded="${isOpen}">${isOpen ? 'Fewer controls' : 'More controls'}</button>
      ${isOpen ? `<div class="ac-more">${body}</div>` : ''}`;
  }

  function cardHtml(u) {
    const a = (k) => S().attr(u.id, k);
    const st = S().state(u.id); const avail = S().available(u.id);
    const modes = (a('hvac_modes') || ['off', 'cool', 'heat']).filter((m) => ORDER.includes(m)).sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
    const t = target(u.id); const stp = step(u.id);
    const lo = Number(a('min_temp')) || 16; const hi = Number(a('max_temp')) || 30;
    const action = a('hvac_action');
    const roomT = S().num(u.room.temp) ?? a('current_temperature');
    const stateText = !avail ? 'Unavailable'
      : st === 'off' ? 'Off'
        : `${MODE_TEXT[st] || label(st)}${t != null && st !== 'fan_only' && st !== 'dry' ? ` to ${fmtT(t, stp)}°` : ''}${action && action !== 'off' && ACTION_TEXT[action] ? ` · ${ACTION_TEXT[action]}` : ''}`;
    // The stepper is there whenever the unit takes a temperature; it's dimmed while off
    const showStep = a('temperature') !== undefined || pending[u.id] != null;
    const canStep = avail && t != null && st !== 'off';
    return `<li class="${st !== 'off' && avail ? `running ${esc(st)}` : ''}">
      <div class="ac-head"><span class="name">${esc(u.name)}</span><span class="state">${esc(stateText)}</span></div>
      <div class="ac-main">
        ${showStep ? `<div class="ac-step" role="group" aria-label="${esc(u.name)} temperature">
          <button data-ac="${u.id}" data-ac-temp="-1" aria-label="Cooler" ${canStep && t > lo ? '' : 'disabled'}>−</button>
          <b class="${pending[u.id] != null ? 'pending' : ''}">${fmtT(t, stp)}<small>°</small></b>
          <button data-ac="${u.id}" data-ac-temp="1" aria-label="Warmer" ${canStep && t < hi ? '' : 'disabled'}>+</button></div>` : ''}
        ${roomT != null ? `<p class="ac-room"><small>Room</small>${fmtT(roomT, 0.1)}°</p>` : ''}
      </div>
      <div class="seg" role="group" aria-label="${esc(u.name)} mode">${modes.map((m) => `<button data-hvac="${u.id}" data-mode="${m}" class="${st === m ? 'on' : ''}" ${avail ? '' : 'disabled'}>${esc(MODE_TEXT[m] || label(m))}</button>`).join('')}</div>
      ${moreHtml(u, avail)}
    </li>`;
  }

  function html() {
    settle();
    const list = units();
    if (!list.length) return '<p class="empty">No AC units in the config.</p>';
    return `<ul class="ac-rows">${list.map(cardHtml).join('')}</ul>`;
  }

  // ── room badge: a small fan in the room's corner, blue when cooling, red when heating ──
  // null when the unit is off or offline. `active` = actually blowing hot/cold air now
  // (hvac_action), rather than switched on and resting at its target.
  const KIND_TEXT = { cool: 'cooling', heat: 'heating', dry: 'drying', fan: 'fan only' };
  function status(id) {
    if (!id || !S().available(id)) return null;
    const st = S().state(id); if (st === 'off') return null;
    const act = S().attr(id, 'hvac_action');
    let kind = { cool: 'cool', heat: 'heat', dry: 'dry', fan_only: 'fan' }[st];
    if (!kind) kind = act === 'heating' ? 'heat' : act === 'cooling' ? 'cool' : act === 'drying' ? 'dry' : 'fan';  // auto / heat_cool
    const active = act == null ? true : ['cooling', 'heating', 'drying', 'fan'].includes(act);
    const t = S().attr(id, 'temperature');
    const text = active ? `AC ${KIND_TEXT[kind]}${t != null && (kind === 'cool' || kind === 'heat') ? ` to ${t}°` : ''}`
      : `AC on (${MODE_TEXT[st] || label(st)}${t != null ? ` ${t}°` : ''}), resting at target`;
    return { kind, active, text };
  }
  function badge(id) {
    const s = status(id); if (!s) return '';
    return `<span class="ac-badge ${s.kind} ${s.active ? 'active' : ''}" role="img" aria-label="${esc(s.text)}" title="${esc(s.text)}">${HD.u.icon('fan')}</span>`;
  }

  // ── actions ──
  const fail = (e) => HD.app.toast(`AC: ${e.message || e}`);
  function send(key, job) {
    if (busy.has(key)) return;
    busy.add(key);
    job().catch(fail).finally(() => { busy.delete(key); HD.app.refresh(); });
  }
  const SERVICE = {
    fan: ['set_fan_mode', 'fan_mode'], swing: ['set_swing_mode', 'swing_mode'],
    hswing: ['set_swing_horizontal_mode', 'swing_horizontal_mode'], preset: ['set_preset_mode', 'preset_mode'],
  };
  function setAttr(id, kind, val) {
    const [service, key] = SERVICE[kind];
    send(`${id}:${kind}`, () => HD.ha.callService('climate', service, { entity_id: id, [key]: val }));
  }
  function nudgeTemp(id, dir) {
    const stp = step(id);
    const lo = Number(S().attr(id, 'min_temp')) || 16; const hi = Number(S().attr(id, 'max_temp')) || 30;
    const cur = Number(target(id));
    if (!Number.isFinite(cur)) return;
    pending[id] = Math.min(hi, Math.max(lo, Math.round((cur + dir * stp) / stp) * stp));
    clearTimeout(timers[id]);
    HD.app.refresh();
    timers[id] = setTimeout(() => {
      delete timers[id];
      const v = pending[id];
      HD.ha.callService('climate', 'set_temperature', { entity_id: id, temperature: v })
        .catch(fail)
        // Keep showing the new value until Home Assistant reports it (or give up after 8 s)
        .finally(() => setTimeout(() => { if (pending[id] === v) { delete pending[id]; HD.app.refresh(); } }, 8000));
    }, 800);
  }

  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-ac-more],[data-ac-set],[data-ac-temp],[data-ac-hum],[data-ac-switch]');
    if (!t || t.disabled) return;
    if (t.dataset.acMore) {
      const id = t.dataset.acMore;
      if (open.has(id)) open.delete(id); else open.add(id);
      saveOpen(); HD.app.refresh();
    } else if (t.dataset.acSet) {
      t.classList.add('on');   // optimistic
      setAttr(t.dataset.ac, t.dataset.acSet, t.dataset.val);
    } else if (t.dataset.acTemp) nudgeTemp(t.dataset.ac, Number(t.dataset.acTemp));
    else if (t.dataset.acHum) {
      const id = t.dataset.ac;
      const v = Math.round(Number(S().attr(id, 'humidity')) + Number(t.dataset.acHum));
      send(`${id}:hum`, () => HD.ha.callService('climate', 'set_humidity', { entity_id: id, humidity: v }));
    } else if (t.dataset.acSwitch) {
      const id = t.dataset.acSwitch;
      t.classList.toggle('on');
      send(id, () => HD.ha.callService('switch', S().state(id) === 'on' ? 'turn_off' : 'turn_on', { entity_id: id }));
    }
  });
  document.addEventListener('change', (ev) => {
    const t = ev.target.closest('[data-ac-select],[data-ac-option]'); if (!t) return;
    if (t.dataset.acSelect) setAttr(t.dataset.ac, t.dataset.acSelect, t.value);
    else send(t.dataset.acOption, () => HD.ha.callService('select', 'select_option', { entity_id: t.dataset.acOption, option: t.value }));
  });

  // Once Home Assistant reports the new target, drop the pending value
  function settle() {
    Object.keys(pending).forEach((id) => { if (Number(S().attr(id, 'temperature')) === pending[id] && !timers[id]) delete pending[id]; });
  }

  // (demo mode has no registry, so it hands over its made-up extras here)
  const setExtras = (map) => Object.assign(extrasFound, map);

  HD.ac = { html, units, resolveExtras, extraIds, setExtras, status, badge };
})();
