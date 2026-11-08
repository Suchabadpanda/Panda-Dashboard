/*
 * Washing machine (Samsung via Home Assistant's SmartThings integration).
 *  - a chip on its room in the Home house drawing (links to Devices)
 *  - a card on Devices: what it's doing, the phase, progress, finish time, the last wash,
 *    start / pause / resume / stop, and its settings (temperature, spin, rinses, bubble soak)
 *  - an Attention item on Home for a while after a wash finishes
 *
 * config.washer = {
 *   name, room,              // room: the Home room whose tile shows the chip
 *   state,                   // sensor.<p>_machine_state (run / pause / stop)
 *   job, progress, finish,   // sensor.<p>_job_state / sensor.<p>_progress (%) / sensor.<p>_completion_time
 *   control,                 // select.<p> (operating state: stop / run / pause) — starts, pauses and stops it
 *   remote, childLock,       // binary_sensor.<p>_remote_control / _child_lock
 *   temperature, spin,       // select.<p>_water_temperature / _spin_level
 *   rinse, bubbleSoak,       // number.<p>_rinse_cycles / switch.<p>_bubble_soak
 *   doneAlertHours,          // how long "finished: ready to unload" stays on Home (default 2; 0 = never)
 * }
 * Everything but state is found from its id (<p> = the part before _machine_state) if left out.
 * Samsung washers drop off the network when switched off, so the entities are "unavailable"
 * then; the card shows the last wash from history instead. Starting, changing settings or
 * stopping from here needs Smart Control on at the machine (remote_control = on). There's no
 * programme selector in Home Assistant: Start runs the programme set on the dial.
 */
window.HD = window.HD || {};

(function () {
  const { esc, icon } = HD.u;
  const S = () => HD.store;
  const raw = () => HD.config.washer;
  const enabled = () => !!(raw() && raw().state);
  const nowTs = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());

  // Config with companions filled in from the machine-state id
  function cfg() {
    const c = raw();
    const m = String(c.state).match(/^sensor\.(.+?)_machine_state$/); const p = m ? m[1] : 'washing_machine';
    return {
      name: 'Washing machine', doneAlertHours: 2,
      job: `sensor.${p}_job_state`, progress: `sensor.${p}_progress`, finish: `sensor.${p}_completion_time`,
      control: `select.${p}`, remote: `binary_sensor.${p}_remote_control`, childLock: `binary_sensor.${p}_child_lock`,
      temperature: `select.${p}_water_temperature`, spin: `select.${p}_spin_level`,
      rinse: `number.${p}_rinse_cycles`, bubbleSoak: `switch.${p}_bubble_soak`,
      ...c,
    };
  }
  const extraIds = () => {
    if (!enabled()) return [];
    const c = cfg();
    return [c.job, c.progress, c.finish, c.control, c.remote, c.childLock, c.temperature, c.spin, c.rinse, c.bubbleSoak].filter(Boolean);
  };

  const JOB = {
    none: '', weight_sensing: 'Weighing the load', pre_wash: 'Pre-wash', wash: 'Washing', ai_wash: 'Washing',
    rinse: 'Rinsing', ai_rinse: 'Rinsing', spin: 'Spinning', ai_spin: 'Spinning', drying: 'Drying', cooling: 'Cooling down',
    delay_wash: 'Waiting to start', finish: 'Finished', air_wash: 'Air wash', wrinkle_prevent: 'Anti-crease',
    freeze_protection: 'Frost protection',
  };
  const tempName = (v) => (v === 'cold' ? 'Cold' : v === 'none' ? 'None' : /^\d+$/.test(v) ? `${v}°` : HD.u.cap(String(v).replace(/_/g, ' ')));
  const spinName = (v) => (v === 'rinse_hold' ? 'Rinse hold' : v === 'no_spin' ? 'No spin' : /^\d+$/.test(v) ? `${v}` : HD.u.cap(String(v).replace(/_/g, ' ')));

  const avail = (id) => !!id && S().available(id);
  const online = () => avail(cfg().state);
  const st = () => String(S().state(cfg().state) || '').toLowerCase();
  const running = () => online() && st() === 'run';
  const paused = () => online() && st() === 'pause';
  const busy = () => running() || paused();
  const job = () => String(S().state(cfg().job) || '').toLowerCase();
  const phase = () => (avail(cfg().job) ? JOB[job()] ?? HD.u.cap(job().replace(/_/g, ' ')) : '');
  const finishTs = () => { const v = avail(cfg().finish) && S().state(cfg().finish); const t = v ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : null; };
  const finishText = () => { const t = finishTs(); return t && busy() && t > nowTs() - 60e3 ? HD.u.time(t) : ''; };
  const remoteOn = () => S().mode !== 'live' || S().state(cfg().remote) === 'on';

  // ── Last wash, from the machine state's history (the entities vanish when it's off) ──
  let last = null; let lastAt = 0; let loading = false; let seenState = null;
  async function loadLast() {
    if (!enabled() || loading) return;
    if (S().mode === 'demo') { last = HD.demo.washerLast || null; return; }
    if (S().mode !== 'live') return;
    loading = true; lastAt = Date.now();
    try {
      const id = cfg().state;
      const res = await HD.ha.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - 14 * 864e5).toISOString(),
        entity_ids: [id], minimal_response: true, no_attributes: true, significant_changes_only: false });
      const rows = ((res && res[id]) || []).map((r) => ({ s: r.s ?? r.state, t: r.lu != null ? r.lu * 1000 : Date.parse(r.last_updated || r.last_changed) }));
      // A wash = from the first "run" after anything else to the next state that's neither run nor pause
      let start = null; let found = null;
      rows.forEach((r) => {
        const on = r.s === 'run' || r.s === 'pause';
        if (on && start == null) start = r.t;
        else if (!on && start != null) { found = { start, end: r.t }; start = null; }
      });
      if (start != null) found = { start, end: null };   // still going
      last = found;
    } catch (e) { console.warn('Washing machine history unavailable', e); } finally { loading = false; HD.store.emit(null); }
  }
  // Reload when the machine changes state (a wash just ended), and every 30 min
  function maybeLoad() {
    if (!enabled()) return;
    const s = S().state(cfg().state);
    if (s !== seenState) { const first = seenState === null; seenState = s; if (!first || !last) setTimeout(loadLast, first ? 0 : 5000); return; }
    if (Date.now() - lastAt > 30 * 60e3) loadLast();
  }

  const dur = (ms) => { const m = Math.round(ms / 60e3); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  function lastText() {
    if (!last || !last.end) return '';
    const d = new Date(last.start); const today = new Date(nowTs()); today.setHours(0, 0, 0, 0);
    const day = d >= today ? 'Today' : d >= today - 864e5 ? 'Yesterday' : HD.u.fmt(d, { weekday: 'short', day: 'numeric', month: 'short' });
    return `${day} ${HD.u.time(last.start)}–${HD.u.time(last.end)} (${dur(last.end - last.start)})`;
  }
  // Finished within doneAlertHours and nothing since
  const justFinished = () => {
    if (busy()) return false;
    if (online() && job() === 'finish') return true;
    const h = Number(cfg().doneAlertHours) || 0;
    return !!(h && last && last.end && nowTs() - last.end < h * 3600e3);
  };

  function summary() {
    if (!online()) return justFinished() ? `Finished at ${HD.u.time(last.end)}` : 'Switched off';
    if (running()) return `${phase() || 'Washing'}${finishText() ? ` · until ${finishText()}` : ''}`;
    if (paused()) return `Paused${phase() ? ` · ${phase().toLowerCase()}` : ''}`;
    if (job() === 'finish') return 'Finished';
    return 'On, not running';
  }

  // Chip on the room tile in the house drawing
  function chip(roomName) {
    if (!enabled() || (cfg().room && cfg().room !== roomName)) return '';
    const pct = S().num(cfg().progress);
    const short = !online() ? (justFinished() ? `done ${HD.u.time(last.end)}` : 'off')
      : running() ? `${pct != null ? `${Math.round(pct)}%` : (phase() || 'washing').toLowerCase()}${finishText() ? ` · ${finishText()}` : ''}`
      : paused() ? 'paused' : job() === 'finish' ? 'finished' : 'on';
    const cls = running() ? 'on' : justFinished() || paused() ? 'warn' : '';
    return `<a class="chip status washer-chip ${cls}" href="#devices" title="${esc(summary())}">${icon('washer')}${esc(cfg().name === 'Washing machine' ? 'Washer' : cfg().name)} · ${esc(short)}</a>`;
  }

  // ── Settings (only while it's on and not mid-wash) ──
  function settingsHtml(canSet) {
    const c = cfg(); const rows = [];
    const dis = canSet ? '' : 'disabled';
    const pick = (id, label, name, skip) => {
      if (!avail(id)) return;
      const cur = S().state(id); const opts = (S().attr(id, 'options') || []).filter((o) => !skip.includes(o) || o === cur);
      if (!opts.length) return;
      rows.push(`<p class="dw-label">${label}</p><div class="dw-pick" role="radiogroup" aria-label="${label}">
        ${opts.map((o) => `<button class="chip ${o === cur ? 'on' : ''}" role="radio" aria-checked="${o === cur}" data-wm-set="select" data-wm-id="${esc(id)}" data-wm-val="${esc(o)}" ${dis}>${esc(name(o))}</button>`).join('')}</div>`);
    };
    pick(c.temperature, 'Temperature', tempName, ['none']);
    pick(c.spin, 'Spin (rpm)', spinName, []);
    const extras = [];
    if (avail(c.rinse)) {
      const v = S().num(c.rinse); const min = S().attr(c.rinse, 'min') ?? 0; const max = S().attr(c.rinse, 'max') ?? 5;
      extras.push(`<span class="wm-step" aria-label="Rinse cycles">Rinses
        <button class="chip" data-wm-set="rinse" data-wm-id="${esc(c.rinse)}" data-wm-val="${(v ?? 0) - 1}" aria-label="Fewer rinses" ${canSet && v != null && v > min ? '' : 'disabled'}>−</button>
        <strong>${v == null ? '–' : Math.round(v)}</strong>
        <button class="chip" data-wm-set="rinse" data-wm-id="${esc(c.rinse)}" data-wm-val="${(v ?? 0) + 1}" aria-label="More rinses" ${canSet && v != null && v < max ? '' : 'disabled'}>+</button></span>`);
    }
    if (avail(c.bubbleSoak)) {
      const on = S().state(c.bubbleSoak) === 'on';
      extras.push(`<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}" data-wm-set="switch" data-wm-id="${esc(c.bubbleSoak)}" data-wm-val="${on ? 'off' : 'on'}" ${dis}>Bubble soak</button>`);
    }
    if (extras.length) rows.push(`<p class="dw-label">Extras</p><div class="dw-pick extras wm-extras">${extras.join('')}</div>`);
    return rows.join('');
  }

  function cardHtml() {
    if (!enabled()) return '';
    const c = cfg();
    const pct = S().num(c.progress);
    const lock = avail(c.childLock) ? (S().state(c.childLock) === 'on' ? 'On' : 'Off') : '–';
    const remote = avail(c.remote) ? (S().state(c.remote) === 'on' ? 'On' : 'Off') : '–';
    const canAct = online() && remoteOn();
    const canSet = canAct && !busy();
    const why = !online() ? 'It’s switched off. Turn it on and press Smart Control on the machine to use it from here.'
      : !remoteOn() ? 'Press Smart Control on the washing machine to control it from here.'
      : !busy() ? 'Start runs the programme set on the dial.' : '';
    const head = !online() ? 'Off' : running() ? 'Running' : paused() ? 'Paused' : job() === 'finish' ? 'Finished' : 'On';
    const ltxt = lastText();
    return `
      <section class="panel washer-panel">
        <header><h2>${esc(c.name)}</h2><p>${esc(head)}</p></header>
        <div class="dw-main">
          <span class="dw-icon wm-icon ${running() ? 'running' : ''}">${icon('washer')}</span>
          <div>
            <p class="dw-state">${esc(summary())}</p>
            ${busy() && pct != null ? `<div class="soc-bar dw-bar"><i style="width:${Math.max(0, Math.min(100, pct))}%"></i></div><p class="sub">${Math.round(pct)}% done</p>` : ''}
          </div>
        </div>
        <dl class="kv dw-kv">
          ${online() ? `<div><dt>Finishes</dt><dd>${finishText() || '–'}</dd></div>
          <div><dt>Smart control</dt><dd>${remote}</dd></div>
          <div><dt>Child lock</dt><dd>${lock}</dd></div>` : ''}
          <div class="wide"><dt>Last wash</dt><dd>${esc(ltxt || (last && !last.end ? 'Running now' : '–'))}</dd></div>
        </dl>
        ${online() ? settingsHtml(canSet) : ''}
        ${online() ? `<div class="dw-actions">
          ${running() ? `<button class="btn ghost" data-wm="pause" ${canAct ? '' : 'disabled'}>Pause</button>`
            : paused() ? `<button class="btn primary" data-wm="run" ${canAct ? '' : 'disabled'}>Resume</button>`
            : `<button class="btn primary" data-wm="run" ${canAct ? '' : 'disabled'}>Start</button>`}
          ${busy() ? `<button class="btn ghost" data-wm="stop" ${canAct ? '' : 'disabled'}>${icon('power')}Stop</button>` : ''}
        </div>` : ''}
        ${why ? `<p class="sub dw-why">${esc(why)}</p>` : ''}
      </section>`;
  }

  function alerts() {
    if (!enabled() || !justFinished()) return [];
    const t = last && last.end && !online() ? ` at ${HD.u.time(last.end)}` : '';
    return [['washer', `${cfg().name} finished${t}: ready to unload`, 'info']];
  }

  function send(kind, id, val) {
    if (kind === 'select') return HD.ha.callService('select', 'select_option', { entity_id: id, option: val });
    if (kind === 'rinse') return HD.ha.callService('number', 'set_value', { entity_id: id, value: Number(val) });
    if (kind === 'switch') return HD.ha.callService('switch', val === 'on' ? 'turn_on' : 'turn_off', { entity_id: id });
    return Promise.reject(new Error('unknown setting'));
  }

  document.addEventListener('click', (ev) => {
    const sb = ev.target.closest('[data-wm-set]');
    if (sb && enabled()) {
      sb.disabled = true;
      send(sb.dataset.wmSet, sb.dataset.wmId, sb.dataset.wmVal)
        .catch((e) => HD.app.toast(`The washing machine didn't accept that: ${e.message || e}`))
        .finally(() => { sb.disabled = false; HD.u.invalidate(); HD.app.refresh(); });
      return;
    }
    const b = ev.target.closest('[data-wm]'); if (!b || !enabled()) return;
    const a = b.dataset.wm; const c = cfg();
    if (a === 'stop' && !window.confirm(`Stop the ${c.name.toLowerCase()}? The wash will be cancelled.`)) return;
    if (a === 'run' && !paused() && !window.confirm(`Start the ${c.name.toLowerCase()} on the programme set on its dial?`)) return;
    b.disabled = true;
    const go = S().mode === 'demo' ? demoRun(a) : HD.ha.callService('select', 'select_option', { entity_id: c.control, option: a });
    Promise.resolve(go)
      .then(() => HD.app.toast({ run: paused() ? 'Resuming the wash' : 'Starting the wash', pause: 'Pausing the wash', stop: 'Stopping the wash' }[a] || 'Sent'))
      .catch((e) => HD.app.toast(`The washing machine didn't accept it: ${e.message || e}`))
      .finally(() => { b.disabled = false; });
  });

  // Demo: the machine state follows the operating-state select, as the real one does
  function demoRun(a) {
    const c = cfg(); const s = HD.store.states[c.state]; const sel = HD.store.states[c.control]; const j = HD.store.states[c.job];
    if (s) s.state = a; if (sel) sel.state = a;
    if (j) j.state = a === 'stop' ? 'none' : a === 'run' && j.state === 'none' ? 'wash' : j.state;
    [c.state, c.control, c.job].forEach((id) => HD.store.emit(id));
    return Promise.resolve();
  }

  HD.washer = { enabled, chip, cardHtml, alerts, extraIds, maybeLoad };
})();
