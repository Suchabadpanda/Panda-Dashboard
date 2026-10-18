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

  function room(r) {
    const t = S().num(r.temp); const h = S().num(r.hum);
    const motion = r.motion && S().state(r.motion) === 'on';
    const ac = r.climate && S().state(r.climate);
    const acOn = ac && ac !== 'off' && ac !== 'unavailable';
    const plug = r.plugPower ? S().num(r.plugPower) : r.socketPower ? S().num(r.socketPower) : null;
    const lights = [lightBtn(r.light, r.lightName), ...(r.extraLights || []).map((l) => lightBtn(l.id, l.name))].join('');
    const delta = t == null ? '' : (t - HD.config.comfortTarget);
    return `<article class="room" style="${tint(t)}" aria-label="${esc(r.name)}">
      <header><h3>${esc(r.name)}</h3>${motion ? `<span class="motion" title="Motion detected">${icon('motion')}</span>` : ''}</header>
      <p class="room-temp">${temp(t)}<small>${delta === '' ? '' : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`}</small></p>
      <p class="room-meta">${icon('drop')}${pct(h)}${r.thermostat ? ' · thermostat' : ''}${acOn ? ` · AC ${esc(ac)}` : ''}${plug != null && plug > 5 ? ` · ${esc(r.plugName || 'socket')} ${Math.round(plug)} W` : ''}</p>
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
    const evP = S().num(HD.config.ev.power) || 0;
    const evState = S().state(HD.config.ev.status);
    const tank = S().num(HD.config.heatPump.tankTemp);
    const cap = S().num(e.capacity) || 27.12;

    const floors = HD.config.floors.map((f) => `
      <section class="floor" aria-label="${esc(f.name)}">
        <span class="floor-tag">${esc(f.short)}</span>
        ${f.rooms.map(room).join('')}
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
      </div>

      <div class="side right">
        <div class="link">
        ${flow('f-hp', hpP, kw(hpP))}
        <div class="node heatpump ${hpP > 0.1 ? 'running' : ''}">
          <svg class="fan" viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="7" width="42" height="34" rx="4"/><circle cx="24" cy="24" r="11"/><path d="M24 24c0-6 3-9 6-9M24 24c6 0 9 3 9 6M24 24c0 6-3 9-6 9M24 24c-6 0-9-3-9-6"/></svg>
          <h4>Heat pump</h4>
          <p>${hpP > 0.1 ? `Running ${kw(hpP)}` : 'Resting'}</p>
          <p class="sub">Tank ${temp(tank)} · ${kwh(S().num(HD.config.heatPump.energyToday))} today${S().state(HD.config.heatPump.legionella) === 'on' ? ' · legionella cycle' : ''}</p>
        </div>
        </div>
        <div class="link">
        ${flow('f-ev', evP, kw(evP))}
        <div class="node ev ${evP > 0.1 ? 'running' : ''}">
          <svg class="car" viewBox="0 0 56 32" aria-hidden="true"><path d="M4 22v-5l6-2 7-8h20l9 8 6 2v5z"/><circle cx="15" cy="24" r="4"/><circle cx="42" cy="24" r="4"/></svg>
          <h4>${esc(HD.config.ev.name || 'Car')}</h4>
          <p>${evP > 0.1 ? `Charging ${kw(evP)}` : evState === 'not_connected' ? 'Not plugged in' : esc((evState || '').replace(/_/g, ' '))}</p>
          <p class="sub">Last session ${kwh(S().num(HD.config.ev.session))}${S().available(HD.config.ev.carSoc) ? ` · car ${pct(S().num(HD.config.ev.carSoc))}` : ''}</p>
        </div>
        </div>
      </div>
    </div>`;
  }

  function nowHtml() {
    const e = HD.config.energy;
    const now = S().mode === 'demo' ? HD.demo.snapshotTime : Date.now();
    const t = HD.tariff.tariffAt(now);
    const off = HD.tariff.isOffPeak(now);
    const nextSwitch = new Date(now); nextSwitch.setMinutes(0, 0, 0);
    nextSwitch.setHours(off ? t.offPeakEnd : 24 + t.offPeakStart);
    const minsToSwitch = (nextSwitch - now) / 60000;

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
    const nas = HD.config.devices.nas;
    if (S().available(nas.volStatus) && S().state(nas.volStatus) !== 'normal') alerts.push(['alert', `NAS volume ${S().state(nas.volStatus)}`, 'critical']);
    if ((S().num(nas.temp) || 0) >= 65) alerts.push(['alert', `NAS running hot (${S().num(nas.temp)}°C)`, 'warning']);
    const lastBackup = S().state(HD.config.devices.backupLast);
    if (lastBackup && Date.now() - Date.parse(lastBackup) > 8 * 864e5) alerts.push(['alert', `No HA backup since ${ago(lastBackup)}`, 'warning']);
    if (S().state(HD.config.heatPump.legionella) === 'on') alerts.push(['flame', 'Legionella cycle running', 'info']);

    return `
      <section class="now-block rate ${off ? 'off-peak' : 'peak'}">
        <h2>${off ? 'Off-peak' : 'Peak'} electricity</h2>
        <p class="big">${pence(off ? t.offPeak : t.peak)}<small>/kWh</small></p>
        <p>${off ? 'Cheap rate' : 'Peak rate'} ends ${minsToSwitch < 90 ? `in ${Math.round(minsToSwitch)} min` : `at ${String(nextSwitch.getHours()).padStart(2, '0')}:00`} · export ${pence(t.export)}</p>
      </section>
      <section class="now-block">
        <h2>Battery</h2>
        <div class="soc-bar" role="meter" aria-valuenow="${soc ?? 0}" aria-valuemin="0" aria-valuemax="100"><i style="width:${soc ?? 0}%"></i></div>
        <p class="big">${pct(soc)}<small>${bat > 0.05 ? ' charging' : bat < -0.05 ? ' discharging' : ''}</small></p>
        <p>${batNote || esc(S().state(e.emsMode) || '')}</p>
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
      <section class="now-block alerts">
        <h2>Attention</h2>
        ${alerts.length ? `<ul>${alerts.map(([ic, txt, lvl]) => `<li class="${lvl}">${icon(ic)}${esc(txt)}</li>`).join('')}</ul>`
          : `<p class="all-clear">${icon('check')}Inverter, battery, NAS and backups all fine</p>`}
      </section>`;
  }

  HD.views.home = {
    title: 'Home',
    mount(root) {
      root.innerHTML = '<div class="home-grid"><div id="house"></div><aside id="now" class="now"></aside></div>';
      this.update();
    },
    update() {
      const house = document.getElementById('house'); const now = document.getElementById('now');
      if (!house) return;
      house.innerHTML = houseHtml();
      now.innerHTML = nowHtml();
    },
  };
})();
