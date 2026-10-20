/*
 * Home view: the house drawn as a cross-section, three floors of rooms tinted
 * against the comfort target, with energy flowing between the roof panels,
 * battery, grid, heat pump and car. A "now" column sits alongside.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, kw, kwh, gbp, pence, temp, pct, dur, until, ago, icon } = HD.u;
  const S = () => HD.store;

  // Tint a room by how far it sits from the comfort target (±3 °C saturates)
  function tint(t) {
    if (t == null) return '';
    const d = Math.max(-3, Math.min(3, t - HD.config.comfortTarget));
    const amt = Math.round((Math.abs(d) / 3) * 40);
    return `--tint: color-mix(in oklab, var(${d < 0 ? '--cool' : '--warm'}) ${amt}%, var(--room));`;
  }

  function flow(cls, power, label) {
    const on = Math.abs(power || 0) >= 0.05;
    // seconds per dash cycle: faster with more power
    const speed = on ? Math.max(0.35, 2.4 - Math.min(Math.abs(power), 8) * 0.25) : 0;
    return `<div class="flow ${cls} ${on ? 'on' : ''} ${power < 0 ? 'rev' : ''}" style="--speed:${speed}s" aria-hidden="true"><span>${on ? label : ''}</span></div>`;
  }

  function lightBtn(id, name) {
    if (!id) return '';
    const st = S().state(id);
    const avail = S().available(id);
    return `<button class="chip light ${st === 'on' ? 'on' : ''}" data-toggle="${id}" ${avail ? '' : 'disabled'} aria-pressed="${st === 'on'}">${icon('bulb')}${esc(name)}</button>`;
  }

  function acBtn(id) {
    if (!id) return '';
    const st = S().state(id); const avail = S().available(id);
    const on = avail && st !== 'off';
    const target = S().attr(id, 'temperature');
    const mode = { cool: 'Cool', heat: 'Heat', dry: 'Dry', fan_only: 'Fan', heat_cool: 'Auto', auto: 'Auto' }[st] || HD.u.cap(String(st || ''));
    const label = !avail ? 'AC · offline' : on ? `AC · ${mode}${target != null ? ` ${target}°` : ''}` : 'AC · off';
    return `<button class="chip appliance chip-ac ${on ? 'on' : ''}" data-toggle="${id}" ${avail ? '' : 'disabled'} aria-pressed="${on}" title="Turn the AC ${on ? 'off' : 'on (last mode)'}">${icon('snow')}${esc(label)}</button>`;
  }

  function tvBtn(id) {
    if (!id) return '';
    const st = S().state(id);
    const avail = S().available(id);
    const on = avail && st !== 'off' && st !== 'standby';
    return `<button class="chip appliance chip-tv ${on ? 'on' : ''}" data-toggle="${id}" ${avail ? '' : 'disabled title="TV is offline in Home Assistant"'} aria-pressed="${on}">${icon('tv')}TV${avail ? '' : ' · offline'}</button>`;
  }

  function washerChip(r) {
    if (!r.washer) return '';
    const st = S().state(r.washer);
    if (!S().available(r.washer)) return `<span class="chip status" title="Washing machine is offline in Home Assistant">${icon('drop')}Washer · offline</span>`;
    const running = !['stop', 'off', 'idle', 'none'].includes(String(st).toLowerCase());
    const done = r.washerDone && S().available(r.washerDone) ? HD.u.time(S().state(r.washerDone)) : '';
    return `<span class="chip status ${running ? 'on' : ''}">${icon('drop')}Washer · ${esc(HD.u.cap(String(st).replace(/_/g, ' ')))}${running && done ? ` until ${done}` : ''}</span>`;
  }

  function room(r) {
    const t = S().num(r.temp); const h = S().num(r.hum);
    const motion = r.motion && S().state(r.motion) === 'on';
    const lux = r.lux != null ? S().num(r.lux) : null;
    const lights = [lightBtn(r.light, r.lightName), ...(r.extraLights || []).map((l) => lightBtn(l.id, l.name)), acBtn(r.climate), tvBtn(r.tv), washerChip(r), HD.dishwasher ? HD.dishwasher.chip(r.name) : ''].join('');
    const delta = t == null ? '' : (t - HD.config.comfortTarget);
    // A room waiting for its sensor (config has area: but nothing's in that area yet)
    const waiting = t == null && !S().get(r.temp);
    return `<article class="room ${r.slim ? 'slim' : ''}" style="${tint(t)}" aria-label="${esc(r.name)}">
      <header><h3>${esc(r.name)}</h3>${motion ? `<span class="motion" title="Someone here · since ${HD.u.time(S().get(r.motion).last_changed)}">${icon('motion')}</span>` : ''}</header>
      ${waiting ? '<p class="room-wait">Sensor not set up yet</p>' : `<p class="room-temp">${temp(t)}<small>${delta === '' ? '' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`}</small></p>
      <p class="room-meta">${icon('drop')}${pct(h)}${lux != null ? ` <span class="lux" title="Light level">${icon('lux')}${Math.round(lux)} lx</span>` : ''}${r.thermostat ? ' · thermostat' : ''}</p>`}
      ${lights ? `<div class="room-controls">${lights}</div>` : ''}
    </article>`;
  }

  function houseHtml() {
    const e = HD.config.energy;
    const pv = S().num(e.pvPower) || 0;
    const load = S().num(e.loadPower);
    const bat = S().num(e.batteryPower) || 0;   // + charging
    const grid = S().num(e.gridPower) || 0;     // + importing
    const soc = S().num(e.soc);
    const hpP = S().num(HD.config.heatPump.power) || 0;
    // Standby draw (controls, circulation) isn't "running"; config.heatPump.runningAbove sets the line
    const hpOn = hpP > (HD.config.heatPump.runningAbove ?? 0.1);
    const hpm = HD.heatpump.mode();
    const evP = S().num(HD.config.ev.power) || 0;
    const evState = S().state(HD.config.ev.status);
    const tank = S().num(HD.config.heatPump.tankTemp);
    const cap = S().num(e.capacity) || 27.12;

    // Landings and hallways (slim rooms) sit in the middle column, like the stairwell they
    // belong to, so the columns line up floor to floor whatever order the config lists them in.
    const arrange = (rooms) => {
      const slim = rooms.filter((r) => r.slim); const wide = rooms.filter((r) => !r.slim);
      if (slim.length === 1 && wide.length === 2) return [wide[0], slim[0], wide[1]];
      return rooms;
    };
    const layouts = HD.config.floors.map((f) => arrange(f.rooms));
    const cols = (rooms) => rooms.map((r) => (r.slim ? 'minmax(0, .72fr)' : 'minmax(0, 1fr)')).join(' ');
    const floors = HD.config.floors.map((f, i) => `
      <section class="floor" style="grid-template-columns:${cols(layouts[i])}" aria-label="${esc(f.name)}">
        <span class="floor-tag">${esc(f.short)}</span>
        ${layouts[i].map(room).join('')}
      </section>`).join('');

    return `
    <div class="section-drawing">
      <div class="side left">
        <div class="link">
        <div class="node battery ${bat > 0.05 ? 'charging' : bat < -0.05 ? 'discharging' : ''}">
          <div class="cell" style="--soc:${soc ?? 0}%"><span>${pct(soc)}</span></div>
          <h4>Battery</h4>
          <p>${bat > 0.05 ? `Charging ${kw(bat)}` : bat < -0.05 ? `Supplying ${kw(bat)}` : 'Idle'}</p>
          <p class="sub">${soc != null ? `${(soc / 100 * cap).toFixed(1)} of ${cap.toFixed(1)} kWh` : ''}</p>
        </div>
        ${flow('f-battery', -bat, kw(bat))}
        </div>
        <div class="link">
        <div class="node grid ${grid > 0.05 ? 'importing' : grid < -0.05 ? 'exporting' : ''}">
          <svg class="pylon" viewBox="0 0 40 48" aria-hidden="true"><path d="M20 2L10 46M20 2l10 44M6 14h28M9 26h22M14 14l12 12M26 14L14 26M12 36h16"/></svg>
          <h4>Grid</h4>
          <p>${grid > 0.05 ? `Importing ${kw(grid)}` : grid < -0.05 ? `Exporting ${kw(grid)}` : 'Balanced'}</p>
          <p class="sub">${esc(S().state(e.gridStatus) || '')}</p>
        </div>
        ${flow('f-grid', grid, kw(grid))}
        </div>
      </div>

      <div class="house">
        <div class="roof ${pv > 0.05 ? 'generating' : ''}">
          <div class="panels" aria-hidden="true">${'<i></i>'.repeat(10)}</div>
          <p><strong>${pv > 0.05 ? kw(pv) : 'No sun'}</strong><span>Solar · ${kwh(S().num(e.pvToday))} today</span></p>
          <p class="house-load">House using <strong>${kw(load)}</strong></p>
        </div>
        ${flow('f-solar', pv, '')}
        <div class="floors">${floors}</div>
        ${legendHtml()}
      </div>

      <div class="side right">
        <div class="link">
        ${flow('f-hp', hpOn ? hpP : 0, kw(hpP))}
        <div class="node heatpump ${hpOn ? 'running' : ''} mode-${hpm.key}">
          <svg class="fan" viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="7" width="42" height="34" rx="4"/><circle cx="24" cy="24" r="11"/><path d="M24 24c0-6 3-9 6-9M24 24c6 0 9 3 9 6M24 24c0 6-3 9-6 9M24 24c-6 0-9-3-9-6"/></svg>
          <h4>Heat pump</h4>
          <p>${hpOn ? `${esc(hpm.label)} · ${kw(hpP)}` : `Resting${hpP >= 0.05 ? ` · ${kw(hpP)} standby` : ''}`}</p>
          ${HD.heatpump.lampsHtml(hpm)}
          <p class="sub hp-note">${esc(hpm.note)}</p>
          <p class="sub">Tank ${temp(tank)} · ${kwh(S().num(HD.config.heatPump.energyToday))} today${S().state(HD.config.heatPump.legionella) === 'on' ? ' · legionella cycle' : ''}</p>
        </div>
        </div>
        <div class="link">
        ${flow('f-ev', evP, kw(evP))}
        <div class="node ev ${evP > 0.1 ? 'running' : ''}">
          <svg class="car" viewBox="0 0 56 32" aria-hidden="true"><path d="M4 22v-5l6-2 7-8h20l9 8 6 2v5z"/><circle cx="15" cy="24" r="4"/><circle cx="42" cy="24" r="4"/></svg>
          <h4>${esc(HD.config.ev.name || 'Car')}</h4>
          <p>${evP > 0.1 ? `Charging ${kw(evP)}` : evState === 'not_connected' ? 'Not plugged in' : esc((evState || '').replace(/_/g, ' '))}</p>
          <p class="sub">Last session ${kwh(S().num(HD.config.ev.session))}${HD.car && HD.car.soc() != null ? ` · car ${pct(HD.car.soc())}` : ''}</p>
        </div>
        </div>
      </div>
    </div>`;
  }

  function roomTemps() {
    return HD.config.floors.flatMap((f) => f.rooms.map((r) => ({ name: r.name, t: S().num(r.temp) }))).filter((r) => r.t != null);
  }

  // Colour scale under the house, matching the room tint
  function legendHtml() {
    const c = HD.config.comfortTarget;
    return `<div class="temp-legend" aria-hidden="true"><span>${c - 3}°</span><i></i><span>${c}°</span><i class="warm"></i><span>${c + 3}°</span></div>`;
  }

  function greetingHtml() {
    const hour = new Date().getHours();
    const part = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const name = (HD.config.people[0] || {}).name;
    const e = HD.config.energy;
    const temps = roomTemps();
    const avg = temps.length ? temps.reduce((a, r) => a + r.t, 0) / temps.length : null;

    // Who's moving around right now
    const busy = HD.config.floors.flatMap((f) => f.rooms).filter((r) => r.motion && S().state(r.motion) === 'on').map((r) => r.name);
    const place = (n) => (/'s\b/.test(n) ? esc(n) : `the ${esc(n.toLowerCase())}`);
    const headline = busy.length ? `Someone's in ${busy.map(place).join(' and ')}.` : 'All quiet at home.';

    // One sentence on what the energy system is doing
    const pv = S().num(e.pvPower) || 0; const bat = S().num(e.batteryPower) || 0; const grid = S().num(e.gridPower) || 0;
    const soc = S().num(e.soc); const now = S().mode === 'demo' ? HD.demo.snapshotTime : Date.now();
    let energy = '';
    if (grid > 0.1 && bat > 0.1 && HD.tariff.isOffPeak(now)) energy = `Filling the battery on the cheap rate (${pct(soc)}).`;
    else if (pv > 0.1 && grid < -0.1) energy = `Solar is covering the house and exporting ${kw(-grid)}.`;
    else if (pv > 0.1) energy = `Solar is making ${kw(pv)}.`;
    else if (grid < -0.1 && bat < -0.1) energy = `The battery is exporting ${kw(-grid)} before the cheap rate (${pct(soc)} left).`;
    else if (bat < -0.1) energy = `Running on the battery (${pct(soc)}).`;
    else if (grid > 0.1) energy = `Buying ${kw(grid)} from the grid.`;

    const extTemp = S().attr(HD.config.weather, 'temperature');
    return `<section class="greeting">
      <div><h1>${part}${name ? `, ${esc(name)}` : ''}</h1>
      <p><span class="dot ${busy.length ? 'busy' : ''}"></span><strong>${headline}</strong> ${avg != null ? `It's ${avg.toFixed(1)}° inside${extTemp != null ? ` and ${Math.round(extTemp)}° out` : ''}.` : ''} ${energy}</p></div>
    </section>`;
  }

  function tile(icon_, value, label, cls = '') {
    return `<div class="info-tile ${cls}">${icon(icon_)}<strong>${value}</strong><span>${label}</span></div>`;
  }

  // Robot vacuum: Dreame state and room when the integration is set up, else the dock socket's power
  function vacTile(plugW) {
    if (!(HD.vacuum && HD.vacuum.configured())) return tile('gauge', plugW == null ? '–' : plugW > 5 ? 'Charging' : 'Docked', 'Robot vacuum');
    const v = HD.vacuum.info();
    const room = v.current ? (HD.vacuum.rooms().find((r) => r.id === v.current) || {}).name : null;
    const text = { cleaning: room ? `Cleaning ${room}` : 'Cleaning', returning: 'Returning', docked: 'Docked', paused: 'Paused', idle: 'Idle', error: 'Needs attention' }[v.state] || (v.available ? HD.u.cap(v.state) : 'Offline');
    const label = `Robot vacuum${v.battery != null ? ` · ${Math.round(v.battery)}%` : ''}`;
    return `<a class="info-tile-link" href="#rooms" data-plan-goto="vac">${tile('gauge', esc(text), label, v.state === 'error' ? 'warn' : v.state === 'cleaning' ? 'good' : '')}</a>`;
  }

  // ── Shortcuts (config.shortcuts) ──
  // { name, icon, confirm?, and one of:
  //   toggle: entity          — flip it (input_boolean, switch, …); shows on/off
  //   press: button entity    — press it
  //   service: 'domain.svc', entities: [ids] | 'lights' — call a service on those
  //     ('lights' = every room light in config.floors) }
  // Every light the dashboard knows: room tiles (light / extraLights) and the floor plan's rooms
  const roomLights = () => [...new Set([
    ...HD.config.floors.flatMap((f) => f.rooms.flatMap((r) => [r.light, ...(r.extraLights || []).map((l) => l.id)])),
    ...(HD.config.floorplan ? HD.config.floorplan.floors.flatMap((f) => f.rooms.flatMap((r) => r.lights || [])) : []),
  ].filter(Boolean))];
  function shortcutTargets(sc) { return sc.entities === 'lights' ? roomLights() : [].concat(sc.entities || []); }
  function shortcutHtml(sc, i) {
    let sub = ''; let cls = ''; let ok = true;
    if (sc.toggle) {
      const on = S().state(sc.toggle) === 'on'; ok = !!S().get(sc.toggle) && S().state(sc.toggle) !== 'unavailable';
      sub = ok ? (on ? 'On' : 'Off') : 'Unavailable'; cls = on ? 'good' : '';
    } else if (sc.press) {
      ok = !!S().get(sc.press) && S().state(sc.press) !== 'unavailable';
      sub = ok ? (sc.hint || '') : 'Unavailable';
    } else if (sc.service) {
      const ids = shortcutTargets(sc);
      const lit = ids.filter((id) => S().state(id) === 'on').length;
      sub = sc.entities === 'lights' ? (lit ? `${lit} on now` : 'All off') : (sc.hint || '');
    }
    const TONES = { lightsoff: 'var(--s-solar)', bulb: 'var(--s-solar)', snow: 'var(--cool)', flame: 'var(--warm)', mute: 'var(--c5)', power: 'var(--accent)' };
    const tone = sc.danger ? 'var(--critical)' : (TONES[sc.icon] || 'var(--accent)');
    return `<button class="info-tile shortcut ${cls} ${sc.danger ? 'danger' : ''}" style="--tone:${tone}" data-shortcut="${i}" ${ok ? '' : 'disabled'}>
      ${icon(sc.icon || 'power')}<strong>${esc(sc.name)}</strong><span>${esc(sub)}</span></button>`;
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-shortcut]'); if (!b) return;
    const sc = (HD.config.shortcuts || [])[+b.dataset.shortcut]; if (!sc) return;
    if (sc.confirm && !window.confirm(sc.confirm)) return;
    let p;
    if (sc.toggle) p = HD.ha.toggle(sc.toggle);
    else if (sc.press) p = HD.ha.callService('button', 'press', { entity_id: sc.press });
    else if (sc.service) { const [d, svc] = sc.service.split('.'); p = HD.ha.callService(d, svc, { entity_id: shortcutTargets(sc) }); }
    if (!p) return;
    b.disabled = true;
    p.then(() => HD.app.toast(`${sc.name}: done`)).catch((e) => HD.app.toast(`${sc.name} didn't work: ${e.message}`)).finally(() => { b.disabled = false; });
  });

  // Heat pump efficiency from the Energy Tracker add-on (right column, under the front door)
  function copBlock() {
    const c = HD.tracker && HD.tracker.cop; if (!c) return '';
    const f = (v) => (v == null ? '–' : v.toFixed(2));
    const isToday = c.today != null;
    const main = isToday ? c.today : c.yesterday;
    const vsDesign = main != null && c.design != null ? (main >= c.design ? 'above' : 'below') : null;
    const split = [c.heating != null ? `heating ${f(c.heating)}` : '', c.hotWater != null ? `hot water ${f(c.hotWater)}` : ''].filter(Boolean).join(' · ');
    return `
      <section class="now-block cop" title="Estimated by the Energy Tracker (no heat meter): heat out ÷ electricity in">
        <h2>Heat pump COP ${isToday ? 'today' : 'yesterday'}</h2>
        <p class="big">${f(main)}${vsDesign ? `<small> ${vsDesign} its ${f(c.design)} design</small>` : ''}</p>
        ${isToday && split ? `<p>${esc(split)}${c.todayHeat != null ? ` · ${c.todayHeat} kWh of heat from ${c.todayKwh} kWh` : ''}</p>` : ''}
        <dl class="cop-facts">
          ${isToday ? `<div><dt>Yesterday</dt><dd>${f(c.yesterday)}</dd></div>` : ''}
          <div><dt>This month</dt><dd>${f(c.month)}</dd></div>
          <div><dt>Design SCOP</dt><dd>${f(c.design)}</dd></div>
        </dl>
      </section>`;
  }

  function tilesHtml() {
    const d = HD.config.devices;
    const vac = S().num(d.vacuumPower);
    const shortcuts = (HD.config.shortcuts || []).map(shortcutHtml).join('');
    return `<section class="around"><h2>Shortcuts</h2><div class="info-tiles">
      ${shortcuts}
      ${vacTile(vac)}
    </div></section>`;
  }

  function nowHtml() {
    const e = HD.config.energy;
    const now = S().mode === 'demo' ? HD.demo.snapshotTime : Date.now();
    const t = HD.tariff.tariffAt(now);

    const soc = S().num(e.soc); const bat = S().num(e.batteryPower) || 0;
    const cap = S().num(e.capacity) || 27.12;
    let batNote = '';
    if (soc != null && bat < -0.05) batNote = `Empty in about ${dur(((soc / 100) * cap) / -bat * 60)} at this rate`;
    else if (soc != null && bat > 0.05) batNote = `Full in about ${dur((((100 - soc) / 100) * cap) / bat * 60)}`;

    const pvT = S().num(e.pvToday); const loadT = S().num(e.loadToday);
    const imp = S().num(e.importToday); const exp = S().num(e.exportToday);
    const d = HD.data.today;

    const alerts = [];
    const bad = e.alarms.filter((id) => S().available(id) && S().state(id) !== 'No Problem');
    bad.forEach((id) => alerts.push(['alert', `${S().attr(id, 'friendly_name')}: ${S().state(id)}`, 'critical']));
    const v = HD.config.vpp;
    if (S().state(v.inProgress) === 'on') alerts.push(['gauge', `Axle VPP event running until ${HD.u.time(S().state(v.end))}`, 'warning']);
    else if (S().state(v.later) === 'on') alerts.push(['gauge', `Axle VPP event later today, ${HD.u.time(S().state(v.start))}`, 'info']);
    else if (S().state(v.tomorrow) === 'on') alerts.push(['gauge', 'Axle VPP event tomorrow', 'info']);
    const lastBackup = S().state(HD.config.devices.backupLast);
    if (lastBackup && Date.now() - Date.parse(lastBackup) > 8 * 864e5) alerts.push(['alert', `No HA backup since ${ago(lastBackup)}`, 'warning']);
    if (S().state(HD.config.heatPump.legionella) === 'on') alerts.push(['flame', 'Legionella cycle running', 'info']);
    if (HD.doorbell) alerts.push(...HD.doorbell.alerts());
    if (HD.dishwasher) alerts.push(...HD.dishwasher.alerts());
    // Battery-powered sensors running low
    (HD.config.devices.sensorBatteries || []).forEach((id) => {
      const v = S().num(id);
      if (v != null && v < 15) alerts.push(['alert', `${S().attr(id, 'friendly_name') || id} is at ${Math.round(v)}%`, 'warning']);
    });

    return `
      <section class="now-block battery">
        <h2>Battery</h2>
        <p class="big">${pct(soc)}<small>${bat > 0.05 ? ' charging' : bat < -0.05 ? ' discharging' : ''}</small></p>
        <p>${batNote || esc(S().state(e.emsMode) || '')}</p>
        <div class="soc-bar" role="meter" aria-label="Battery charge" aria-valuenow="${soc ?? 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${soc ?? 0}%"></i></div>
      </section>
      <section class="now-block today">
        <h2>Today so far</h2>
        <dl>
          <div><dt>Solar</dt><dd>${kwh(pvT)}</dd></div>
          <div><dt>House used</dt><dd>${kwh(loadT)}</dd></div>
          <div><dt>Bought</dt><dd>${kwh(imp)}${d ? `<small>${gbp(d.importCost)}</small>` : ''}</dd></div>
          <div><dt>Sold</dt><dd>${kwh(exp)}${d ? `<small>${gbp(d.exportCredit)}</small>` : ''}</dd></div>
        </dl>
        <p class="net">${d ? `Net cost today <strong>${gbp(d.net)}</strong> incl. ${gbp(d.standing)} standing charge` : 'Working out today’s cost…'}</p>
        ${d && d.importKwh ? `<p class="sub">${Math.round((d.offPeakKwh / d.importKwh) * 100)}% of today’s import was at the ${pence(t.offPeak)} rate</p>` : ''}
      </section>
      ${HD.doorbell ? HD.doorbell.cardHtml() : ''}
      ${copBlock()}
      ${alerts.length ? `<section class="now-block alerts">
        <h2>Attention</h2>
        <ul>${alerts.map(([ic, txt, lvl]) => `<li class="${lvl}">${icon(ic)}${esc(txt)}</li>`).join('')}</ul>
      </section>` : ''}`;
  }

  HD.views.home = {
    title: 'Home',
    mount(root) {
      root.innerHTML = '<div id="greeting"></div><div class="home-grid"><div class="home-main"><div class="house-wrap"><div id="sky-host" aria-hidden="false"></div><div id="house"></div></div><div id="tiles"></div></div><aside id="now" class="now"></aside></div>';
      if (HD.sky) HD.sky.reset();
      this.update();
    },
    update() {
      const house = document.getElementById('house'); const now = document.getElementById('now');
      if (!house) return;
      HD.u.setHTML(house, houseHtml());
      if (HD.sky) HD.sky.place(document.getElementById('sky-host'), house);
      // The doorbell picture element is kept so it isn't re-fetched (and the camera isn't
      // asked for a frame) on every update
      HD.u.setHTML(now, nowHtml(), '.door-pic img');
      HD.u.setHTML(document.getElementById('greeting'), greetingHtml());
      HD.u.setHTML(document.getElementById('tiles'), tilesHtml());
    },
  };
})();
