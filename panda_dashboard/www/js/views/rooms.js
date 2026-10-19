/*
 * Rooms view: the floor plan (lights and presence, or temperatures), how balanced
 * the house is around the comfort target, 24 hours of room temperatures, hot
 * water, and the AC units.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, temp, pct, icon } = HD.u;
  const S = () => HD.store;
  const ROOM_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

  function rooms() { return HD.config.floors.flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f.short }))); }

  function balanceHtml() {
    const target = HD.config.comfortTarget;
    const list = rooms().map((r) => ({ ...r, t: S().num(r.temp), h: S().num(r.hum) })).filter((r) => r.t != null);
    if (!list.length) return '<p class="empty">No room temperatures yet.</p>';
    const ts = list.map((r) => r.t);
    const spread = Math.max(...ts) - Math.min(...ts);
    const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
    const lo = Math.min(target - 3, ...ts); const hi = Math.max(target + 3, ...ts);
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    const verdict = spread <= 1.5 ? 'Well balanced' : spread <= 2.5 ? 'A little uneven' : 'Uneven';
    const warm = list.reduce((a, r) => (r.t > a.t ? r : a)); const cool = list.reduce((a, r) => (r.t < a.t ? r : a));
    return `
      <p class="headline">${esc(warm.name)} is ${(warm.t - cool.t).toFixed(1)}° warmer than ${esc(cool.name)}.</p>
      <div class="balance-head">
        <p class="big">${spread.toFixed(1)}°<small> spread</small></p>
        <p><strong>${verdict}.</strong> Warmest to coolest room right now; aim for 1–1.5°. House average ${temp(avg)} against a ${target}° target.</p>
      </div>
      <div class="balance-scale" role="img" aria-label="Rooms placed on a temperature scale">
        <span class="target" style="left:${x(target)}%"><em>${target}°</em></span>
        ${list.sort((a, b) => a.t - b.t).map((r) => `<span class="pin ${r.t < target ? 'cool' : 'warm'}" style="left:${x(r.t)}%" title="${esc(r.name)} ${temp(r.t)}"></span>`).join('')}
      </div>
      <ol class="room-list">
        ${list.sort((a, b) => b.t - a.t).map((r) => `<li><span class="floor-chip">${r.floor}</span><span class="name">${esc(r.name)}${r.thermostat ? ' <small>thermostat</small>' : ''}</span><span class="t ${r.t < target ? 'cool' : 'warm'}">${temp(r.t)}</span><span class="h">${icon('drop')}${pct(r.h)}</span></li>`).join('')}
      </ol>`;
  }

  function acHtml() {
    const units = rooms().filter((r) => r.climate).map((r) => ({ id: r.climate, name: r.name }));
    const quick = HD.config.devices.acQuickCool;
    return `<div class="ac-list">
      ${units.map((u) => {
        const st = S().state(u.id); const avail = S().available(u.id);
        const modes = (S().attr(u.id, 'hvac_modes') || ['off', 'cool', 'heat']).filter((m) => ['off', 'cool', 'heat', 'dry', 'fan_only'].includes(m)).sort((a, b) => ['off', 'cool', 'heat', 'dry', 'fan_only'].indexOf(a) - ['off', 'cool', 'heat', 'dry', 'fan_only'].indexOf(b));
        const target = S().attr(u.id, 'temperature');
        return `<div class="ac"><h3>${esc(u.name)}</h3><p class="state">${avail ? (st === 'off' ? 'Off' : `${esc(st)}${target ? ` to ${target}°` : ''}`) : 'Unavailable'}</p>
          <div class="seg" role="group" aria-label="${esc(u.name)} mode">${modes.map((m) => `<button data-hvac="${u.id}" data-mode="${m}" class="${st === m ? 'on' : ''}" ${avail ? '' : 'disabled'}>${esc(m.replace('_', ' '))}</button>`).join('')}</div></div>`;
      }).join('')}
      <div class="ac"><h3>Quick cool</h3><p>Turns every AC unit to cool</p>
        <button class="chip ${S().state(quick) === 'on' ? 'on' : ''}" data-toggle="${quick}" ${S().available(quick) ? '' : 'disabled'}>${icon('snow')}${S().state(quick) === 'on' ? 'On' : 'Off'}</button></div>
    </div>`;
  }

  function hotWaterHtml() {
    const hp = HD.config.heatPump;
    return `<p class="big">${temp(S().num(hp.tankTemp))}<small> tank</small></p>
      <p>${S().state(hp.legionella) === 'on' ? 'Legionella cycle running. ' : ''}Heat pump has used ${S().num(hp.energyToday)?.toFixed(1) ?? '–'} kWh today, drawing ${HD.u.kw(S().num(hp.power))} now.</p>`;
  }

  function drawCharts() {
    const d = HD.data.temps; if (!d) return;
    const list = rooms();
    HD.chart.line(document.getElementById('chart-temps'), {
      label: 'Room temperatures, last 24 hours', height: 260, band: [HD.config.comfortTarget - 0.75, HD.config.comfortTarget + 0.75],
      format: (v, tick) => (tick ? `${v}°` : `${v.toFixed(1)}°C`), xTicks: 6,
      series: list.map((r, i) => ({ name: r.name, short: r.name.replace("'s room", ''), points: d[r.temp], color: ROOM_COLORS[i] })),
    });
    HD.chart.line(document.getElementById('chart-tank'), {
      label: 'Hot water tank, last 24 hours', height: 150, endLabels: false, ticks: 3, xTicks: 4,
      format: (v, tick) => (tick ? `${v}°` : `${v.toFixed(1)}°C`),
      series: [{ name: 'Tank', points: d[HD.config.heatPump.tankTemp], color: 'var(--c2)', area: true }],
    });
  }

  let planMode = 'live';
  try { planMode = localStorage.getItem('hd.planMode') || 'live'; } catch (e) { /* storage blocked */ }
  function planHeader() {
    const vac = HD.vacuum && HD.vacuum.configured();
    if (planMode === 'vac' && !vac) planMode = 'live';
    const titles = { live: 'Around the house', temp: 'Room temperatures', vac: 'Robot vacuum' };
    return `<h2>${titles[planMode]}</h2>
      <div class="seg" role="group" aria-label="Floor plan shows">
        <button data-plan-mode="live" class="${planMode === 'live' ? 'on' : ''}">Lights</button>
        <button data-plan-mode="temp" class="${planMode === 'temp' ? 'on' : ''}">Temperature</button>
        ${vac ? `<button data-plan-mode="vac" class="${planMode === 'vac' ? 'on' : ''}">Vacuum</button>` : ''}
      </div>`;
  }

  // The Home vacuum tile opens Rooms on the vacuum plan
  document.addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-plan-goto]'); if (!g) return;
    planMode = g.dataset.planGoto;
    try { localStorage.setItem('hd.planMode', planMode); } catch (e) { /* storage blocked */ }
  });

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-plan-mode]'); const head = document.getElementById('plan-head');
    if (!b || !head) return;
    planMode = b.dataset.planMode;
    try { localStorage.setItem('hd.planMode', planMode); } catch (e) { /* storage blocked */ }
    head.innerHTML = planHeader();
    HD.views.rooms.update();
  });

  HD.views.rooms = {
    title: 'Rooms',
    mount(root) {
      root.innerHTML = `
      <div class="panel-grid climate">
        ${HD.config.floorplan ? `<section class="panel wide plan-panel"><header id="plan-head">${planHeader()}</header><div id="climate-plan"></div></section>` : ''}
        <section class="panel"><header><h2>Balance</h2></header><div id="balance"></div></section>
        <section class="panel wide-2"><header><h2>Last 24 hours</h2><p>Band shows ${HD.config.comfortTarget}° ±0.75°.</p></header><div id="chart-temps" class="chart-box"></div></section>
        <section class="panel"><header><h2>Hot water</h2></header><div id="hotwater"></div><div id="chart-tank" class="chart-box"></div></section>
        <section class="panel wide-2"><header><h2>Air conditioning</h2></header><div id="ac"></div></section>
      </div>`;
      this.update(); this.redraw();
    },
    update() {
      const b = document.getElementById('balance'); if (!b) return;
      b.innerHTML = balanceHtml();
      const head = document.getElementById('plan-head');
      if (head) { const h = planHeader(); if (head.dataset.h !== h) { head.innerHTML = h; head.dataset.h = h; } }
      const cp = document.getElementById('climate-plan');
      if (cp) {
        // Keep the Dreame map <img> across re-renders so it only reloads when the map changes
        const old = cp.querySelector('.vac-map img');
        cp.innerHTML = HD.plan.html(planMode);
        const fresh = cp.querySelector('.vac-map img');
        if (old && fresh && old.getAttribute('src') === fresh.getAttribute('src')) fresh.replaceWith(old);
      }
      document.getElementById('ac').innerHTML = acHtml();
      document.getElementById('hotwater').innerHTML = hotWaterHtml();
    },
    redraw: drawCharts,
  };
})();
