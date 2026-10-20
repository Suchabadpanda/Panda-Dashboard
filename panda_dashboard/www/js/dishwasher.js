/*
 * Dishwasher (Bosch / Siemens / Neff via Home Assistant's Home Connect integration).
 *  - a chip on its room in the Home house drawing
 *  - a card on Devices: what it's doing, progress, finish time, door, salt / rinse aid,
 *    and buttons to start now, start on the cheap rate, or stop
 *  - Attention items on Home when it's finished, needs something, or is low on salt / rinse aid
 *
 * config.dishwasher = {
 *   name, room,                      // room: the Home room whose tile shows the chip
 *   state, door, progress, finish,   // operation state / door / % / finish timestamp
 *   active, selected,                // select entities: active and selected programme
 *   remoteStart, power, stop,        // binary_sensor / switch / button
 *   saltLow, rinseLow, careDue,      // optional event sensors ('present' = needs attention)
 *   program,                         // fallback programme if the machine doesn't offer Auto
 *   options,                         // optional { half_load: 'switch.…', … }; found from the entity names if left out
 * }
 * The programme and extras are picked on the Devices card (list from the selected-programme
 * entity) and remembered on this screen. With nothing picked, Auto is used.
 * Starting uses home_connect.set_program_and_options, which needs the device id; it's
 * looked up from the entity registry, so nothing extra goes in the config. The machine
 * only accepts remote starts while its Remote Start is switched on (a button on the door).
 */
window.HD = window.HD || {};

(function () {
  const { esc, icon, gbp, pence } = HD.u;
  const S = () => HD.store;
  const cfg = () => HD.config.dishwasher;
  const enabled = () => !!(cfg() && cfg().state);
  const nowTs = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());

  const PROGRAMS = {
    eco_50: 'Eco 50°', auto_2: 'Auto 45–65°', intensiv_70: 'Intensive 70°', quick_65: 'Quick 65°',
    night_wash: 'Silence', machine_care: 'Machine care', pre_rinse: 'Pre-rinse', quick_45: 'Quick 45°',
    auto_1: 'Auto 35–45°', auto_3: 'Auto 65–75°', glas_40: 'Glass 40°', kurz_60: 'Speed 60°', express_sparkle_65: 'Express 65°',
  };
  const progName = (key) => {
    if (!key || key === 'unknown' || key === 'unavailable') return '';
    const k = String(key).replace(/^.*_program_/, '');
    return PROGRAMS[k] || HD.u.cap(k.replace(/_/g, ' '));
  };
  const STATE = {
    inactive: 'Off', ready: 'Ready', delayedstart: 'Starting later', run: 'Washing', pause: 'Paused',
    actionrequired: 'Needs attention', finished: 'Finished', error: 'Error', aborting: 'Stopping',
  };
  // Extras the machine has, as Home Connect option keys for set_program_and_options.
  // Home Assistant names the switches after them (switch.<name>_half_load …).
  const EXTRAS = [
    ['half_load', 'dishcare_dishwasher_option_half_load', 'Half load'],
    ['vario_speed', 'dishcare_dishwasher_option_vario_speed_plus', 'Speed+'],
    ['intensive_zone', 'dishcare_dishwasher_option_intensiv_zone', 'Intensive zone'],
    ['hygiene', 'dishcare_dishwasher_option_hygiene_plus', 'Hygiene+'],
    ['extra_dry', 'dishcare_dishwasher_option_extra_dry', 'Extra dry'],
    ['brilliance_dry', 'dishcare_dishwasher_option_brilliance_dry', 'Brilliance dry'],
    ['silence_on_demand', 'dishcare_dishwasher_option_silence_on_demand', 'Silence on demand'],
  ];
  const prefix = () => { const id = cfg().selected || cfg().active || cfg().state || ''; const m = id.match(/^\w+\.(.+?)_(selected|active)_programme$/) || id.match(/^\w+\.(.+?)_operation_state$/); return m ? m[1] : 'dishwasher'; };
  const extras = () => EXTRAS.filter(([k]) => {
    const id = (cfg().options && cfg().options[k]) || `switch.${prefix()}_${k}`;
    return !!S().get(id);
  });
  // Programmes the machine offers (the selected-programme entity lists them), minus machine care
  const programmes = () => (S().attr(cfg().selected, 'options') || S().attr(cfg().active, 'options') || []).filter((p) => !/machine_care/.test(p));

  // The pick, remembered on this screen
  const LS = 'hd.dishwasher';
  const saved = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } };
  const save = (v) => { try { localStorage.setItem(LS, JSON.stringify({ ...saved(), ...v })); } catch (e) { /* not kept; still used this time */ } memo = { ...memo, ...v }; };
  let memo = null;
  const choice = () => { memo = memo || saved(); return memo; };
  function chosenProgram() {
    const list = programmes(); const p = choice().program;
    if (p && (!list.length || list.includes(p))) return p;
    return list.find((x) => /_program_auto_2$/.test(x)) || list.find((x) => /_program_auto/.test(x)) || cfg().program || list[0] || null;
  }
  const chosenExtras = () => (choice().extras || []).filter((k) => extras().some(([e]) => e === k));

  const st = () => String(S().state(cfg().state) || '').toLowerCase();
  const running = () => ['run', 'delayedstart', 'pause'].includes(st());
  const present = (id) => id && S().state(id) === 'present';
  const time = (id) => { const v = id && S().state(id); return v && !['unknown', 'unavailable'].includes(v) ? HD.u.time(v) : ''; };

  function summary() {
    const c = cfg(); const s = st();
    const prog = progName(S().state(c.active)) || progName(S().state(c.selected));
    if (!S().available(c.state)) return 'Offline';
    if (s === 'run') return `${prog || 'Washing'}${time(c.finish) ? ` · until ${time(c.finish)}` : ''}`;
    if (s === 'delayedstart') return `${prog ? `${prog} · ` : ''}starts later${time(c.finish) ? `, done ${time(c.finish)}` : ''}`;
    return STATE[s] || HD.u.cap(s);
  }

  // Chip on the room tile in the house drawing
  function chip(roomName) {
    if (!enabled() || (cfg().room && cfg().room !== roomName)) return '';
    const s = st();
    const cls = running() ? 'on' : s === 'finished' || s === 'actionrequired' || s === 'error' ? 'warn' : '';
    // Short on the tile; the full story is on Devices
    const c = cfg(); const pct = S().num(c.progress);
    const short = !S().available(c.state) ? 'offline'
      : s === 'run' ? `${pct != null ? `${Math.round(pct)}%` : 'washing'}${time(c.finish) ? ` · ${time(c.finish)}` : ''}`
      : s === 'delayedstart' ? `starts later${time(c.finish) ? ` · done ${time(c.finish)}` : ''}`
      : (STATE[s] || s).toLowerCase();
    return `<a class="chip status dishwasher-chip ${cls}" href="#devices" title="${esc(summary())}">${icon('dish')}${esc(c.name || 'Dishwasher')} · ${esc(short)}</a>`;
  }

  // Next cheap-rate start, as seconds from now (0 if we're in it)
  function secondsToCheap() {
    const ts = nowTs();
    if (HD.tariff.isOffPeak(ts)) return 0;
    const d = new Date(ts); d.setMinutes(0, 0, 0);
    while (!HD.tariff.isOffPeak(d.getTime())) d.setHours(d.getHours() + 1);
    return Math.round((d.getTime() - ts) / 1000);
  }

  function cardHtml() {
    if (!enabled()) return '';
    const c = cfg(); const s = st();
    const prog = progName(S().state(c.active)) || progName(S().state(c.selected));
    const pct = S().num(c.progress);
    const door = S().state(c.door);
    const remote = S().state(c.remoteStart) === 'on';
    const t = HD.tariff.tariffAt(nowTs());
    const cheapAt = secondsToCheap();
    const pick = chosenProgram();
    const startProg = progName(pick) || prog || 'the selected programme';
    const picks = chosenExtras();
    const ex = extras();
    const progs = programmes();
    const warn = [
      present(c.saltLow) ? 'Salt is running low' : '',
      present(c.rinseLow) ? 'Rinse aid is running low' : '',
      present(c.careDue) ? 'Machine care is due' : '',
    ].filter(Boolean);
    const canStart = S().mode === 'live' ? remote && !running() && door !== 'open' && S().available(c.state) : !running();
    const why = !S().available(c.state) ? 'The dishwasher is offline.'
      : running() ? '' : door === 'open' ? 'Close the door to start it from here.'
      : !remote && S().mode === 'live' ? 'Press Remote Start on the dishwasher to start it from here.' : '';
    return `
      <section class="panel dishwasher-panel">
        <header><h2>${esc(c.name || 'Dishwasher')}</h2><p>${esc(STATE[s] || HD.u.cap(s) || '–')}</p></header>
        <div class="dw-main">
          <span class="dw-icon ${running() ? 'running' : ''}">${icon('dish')}</span>
          <div>
            <p class="dw-state">${esc(summary())}</p>
            ${running() && pct != null ? `<div class="soc-bar dw-bar"><i style="width:${pct}%"></i></div><p class="sub">${Math.round(pct)}% done</p>` : ''}
          </div>
        </div>
        <dl class="kv dw-kv">
          <div><dt>Programme</dt><dd>${esc((running() ? prog : startProg) || '–')}</dd></div>
          <div><dt>Door</dt><dd>${esc(HD.u.cap(door || '–'))}</dd></div>
          <div><dt>Finishes</dt><dd>${time(c.finish) || '–'}</dd></div>
          <div><dt>Remote start</dt><dd>${remote ? 'On' : 'Off'}</dd></div>
        </dl>
        ${!running() && progs.length ? `
        <p class="dw-label">Programme</p><div class="dw-pick" role="radiogroup" aria-label="Programme">
          ${progs.map((p) => `<button class="chip ${p === pick ? 'on' : ''}" role="radio" aria-checked="${p === pick}" data-dw-prog="${esc(p)}">${esc(progName(p))}</button>`).join('')}
        </div>
        ${ex.length ? `<p class="dw-label">Extras</p><div class="dw-pick extras" aria-label="Extras">
          ${ex.map(([k, , label]) => `<button class="chip ${picks.includes(k) ? 'on' : ''}" aria-pressed="${picks.includes(k)}" data-dw-extra="${k}">${esc(label)}</button>`).join('')}
        </div>` : ''}` : ''}
        ${warn.length ? `<p class="dw-warn">${icon('alert')}${warn.map(esc).join(' · ')}</p>` : ''}
        <div class="dw-actions">
          ${running()
            ? (c.stop ? `<button class="btn ghost" data-dw="stop">${icon('power')}Stop</button>` : '')
            : `<button class="btn ghost" data-dw="now" ${canStart ? '' : 'disabled'}>Start ${esc(startProg)} now</button>
               <button class="btn primary" data-dw="cheap" ${canStart ? '' : 'disabled'}>${cheapAt ? `Start at ${String(t.offPeakStart).padStart(2, '0')}:00 (${pence(t.offPeak)})` : `Start now on the cheap rate (${pence(t.offPeak)})`}</button>`}
        </div>
        ${why ? `<p class="sub">${esc(why)}</p>` : running() ? '' : `<p class="sub">A typical eco wash uses about 1 kWh: roughly ${gbp(t.offPeak)} on the cheap rate against ${gbp(t.peak)} at peak.</p>`}
      </section>`;
  }

  function alerts() {
    if (!enabled()) return [];
    const c = cfg(); const s = st(); const out = [];
    const name = c.name || 'Dishwasher';
    if (s === 'finished' && S().state(c.door) !== 'open') out.push(['dish', `${name} finished${time(c.finish) ? ` at ${time(c.finish)}` : ''}: ready to unload`, 'info']);
    if (s === 'actionrequired') out.push(['alert', `${name} needs attention`, 'warning']);
    if (s === 'error') out.push(['alert', `${name} reports an error`, 'critical']);
    if (present(c.saltLow)) out.push(['dish', `${name}: salt is running low`, 'info']);
    if (present(c.rinseLow)) out.push(['dish', `${name}: rinse aid is running low`, 'info']);
    return out;
  }

  let deviceId = null;
  async function device() {
    if (deviceId) return deviceId;
    const e = await HD.ha.callWS({ type: 'config/entity_registry/get', entity_id: cfg().selected || cfg().active || cfg().state });
    deviceId = e && e.device_id;
    return deviceId;
  }

  async function start(delaySecs) {
    const c = cfg();
    const program = chosenProgram() || S().state(c.selected);
    if (S().mode === 'demo') {
      const s = HD.store.states[c.state]; if (s) { s.state = delaySecs ? 'delayedstart' : 'run'; HD.store.emit(c.state); }
      return;
    }
    const data = { device_id: await device(), affects_to: 'active_program', program };
    if (delaySecs) data.b_s_h_common_option_start_in_relative = delaySecs;
    // Extras picked on. Only those are sent: not every programme takes every extra, and the
    // machine refuses a start that names one it doesn't support for that programme.
    const on = chosenExtras();
    if (!/machine_care|pre_rinse/.test(program)) extras().forEach(([k, key]) => { if (on.includes(k)) data[key] = true; });
    return HD.ha.callService('home_connect', 'set_program_and_options', data);
  }

  document.addEventListener('click', (ev) => {
    const pb = ev.target.closest('[data-dw-prog]');
    if (pb && enabled()) { save({ program: pb.dataset.dwProg }); HD.app.refresh(); return; }
    const xb = ev.target.closest('[data-dw-extra]');
    if (xb && enabled()) {
      const k = xb.dataset.dwExtra; const cur = chosenExtras();
      save({ extras: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] });
      HD.app.refresh(); return;
    }
    const b = ev.target.closest('[data-dw]'); if (!b || !enabled()) return;
    const c = cfg(); const a = b.dataset.dw;
    const extraText = chosenExtras().map((k) => (EXTRAS.find(([e]) => e === k) || [])[2]).filter(Boolean);
    const prog = `${progName(chosenProgram()) || progName(S().state(c.selected)) || 'the selected programme'}${extraText.length ? ` with ${extraText.join(', ').toLowerCase()}` : ''}`;
    let go;
    if (a === 'stop') {
      if (!window.confirm(`Stop the ${(c.name || 'dishwasher').toLowerCase()}?`)) return;
      go = S().mode === 'demo' ? Promise.resolve((HD.store.states[c.state].state = 'ready', HD.store.emit(c.state))) : HD.ha.callService('button', 'press', { entity_id: c.stop });
    } else {
      const delay = a === 'cheap' ? secondsToCheap() : 0;
      const when = delay ? `at ${String(HD.tariff.tariffAt(nowTs()).offPeakStart).padStart(2, '0')}:00` : 'now';
      if (!window.confirm(`Start ${prog} ${when}?`)) return;
      go = start(delay);
    }
    b.disabled = true;
    Promise.resolve(go)
      .then(() => HD.app.toast(a === 'stop' ? 'Stopping the dishwasher' : 'Sent to the dishwasher'))
      .catch((e) => HD.app.toast(`The dishwasher didn't accept it: ${e.message || e}`))
      .finally(() => { b.disabled = false; });
  });

  HD.dishwasher = { enabled, chip, cardHtml, alerts };
})();
