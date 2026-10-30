/*
 * Energy view: today's power, battery charge, the last 30 days and the hot water tank.
 * Monthly costs and payback live in the Energy Tracker add-on.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, pence, gbp, kwh } = HD.u;
  const C = () => HD.config;
  const S = () => HD.store;
  const hasTank = () => !!(C().heatPump && C().heatPump.tankTemp);

  const pts = (rows) => (rows || []).map((r) => [r.start, r.mean]);
  // Battery and house are drawn the other way up so supply sits above zero and demand below:
  // grid buying, battery supplying and solar are positive; the house load and battery charging are negative.
  const flip = (rows) => (rows || []).map((r) => [r.start, r.mean == null ? null : -r.mean]);

  function drawToday() {
    const d = HD.data.today; const e = C().energy;
    const box = document.getElementById('chart-power');
    if (!box || !d) return;
    const c = d.curves;
    const dayStart = c[e.loadPower] && c[e.loadPower].length ? new Date(c[e.loadPower][0].start) : new Date();
    dayStart.setHours(0, 0, 0, 0);
    const t = HD.tariff.tariffAt(dayStart);
    const offPeak = [[dayStart.getTime() + t.offPeakStart * 3600e3, dayStart.getTime() + t.offPeakEnd * 3600e3]];
    HD.chart.line(box, {
      label: 'Power through the day', height: 240, zero: true, regions: offPeak, endLabels: false,
      xMin: dayStart.getTime(), xMax: dayStart.getTime() + 24 * 3600e3, xTicks: 6,
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(2)} kW`),
      series: [
        { name: 'House (− using)', short: 'House', points: flip(c[e.loadPower]), color: 'var(--s-load)' },
        { name: 'Battery (+ supplying)', short: 'Battery', points: flip(c[e.batteryPower]), color: 'var(--s-battery)' },
        { name: 'Solar', points: pts(c[e.pvPower]), color: 'var(--s-solar)', area: true },
        { name: 'Grid (+ buying)', short: 'Grid', points: pts(c[e.gridPower]), color: 'var(--s-grid)' },
      ],
    });
    HD.chart.line(document.getElementById('chart-soc'), {
      label: 'Battery charge through the day', height: 120, yMin: 0, yMax: 100, ticks: 2, regions: offPeak,
      xMin: dayStart.getTime(), xMax: dayStart.getTime() + 24 * 3600e3, xTicks: 6, endLabels: false,
      format: (v) => `${Math.round(v)}%`,
      series: [{ name: 'Battery charge', points: pts(c[e.soc]), color: 'var(--s-battery)', area: true }],
    });
  }

  function drawDaily() {
    const d = HD.data.daily; const t = C().energy.totals;
    if (!d) return;
    const cats = d.days.map((ts) => HD.u.fmt(ts, { day: 'numeric', month: 'short' }));
    const long = d.days.map((ts) => HD.u.fmt(ts, { weekday: 'short', day: 'numeric', month: 'short' }));
    HD.chart.bars(document.getElementById('chart-daily-grid'), {
      label: 'Daily grid import and export', height: 220, categories: cats, tipLabels: long,
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(1)} kWh`),
      series: [
        { name: 'Bought from grid', values: d.series[t.import], color: 'var(--s-import)' },
        { name: 'Sold to grid', values: d.series[t.export], color: 'var(--s-export)', down: true },
      ],
    });
    HD.chart.bars(document.getElementById('chart-daily-use'), {
      label: 'Daily solar and house use', height: 220, categories: cats, tipLabels: long,
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(1)} kWh`),
      series: [
        { name: 'Solar generated', values: d.series[t.pv], color: 'var(--s-solar)' },
        { name: 'House used', values: d.series[t.load], color: 'var(--s-load)' },
      ],
      tipExtra: (i) => {
        const hp = d.series[t.heatPump][i]; const ev = d.series[t.ev][i];
        return `<div class="tip-note">Heat pump ${hp == null ? '–' : hp.toFixed(1)} kWh · car ${ev == null ? '–' : ev.toFixed(1)} kWh</div>`;
      },
    });
  }

  // Hot water tank: temperature now, heat pump power and mode lamps, and 24 hours of tank temperature
  function tankHtml() {
    const hp = C().heatPump;
    const t = S().num(hp.tankTemp);
    const legion = hp.legionella && S().state(hp.legionella) === 'on';
    return `<p class="big">${HD.u.temp(t)}<small> now</small></p>
      <p class="tank-note">${legion ? 'Legionella cycle running. ' : ''}Heat pump ${HD.u.kw(S().num(hp.power))} now · ${S().num(hp.energyToday)?.toFixed(1) ?? '–'} kWh today</p>
      ${HD.heatpump ? HD.heatpump.lampsHtml(HD.heatpump.mode()) : ''}`;
  }

  function drawTank() {
    const d = HD.data.temps; const box = document.getElementById('chart-tank');
    if (!d || !box || !hasTank()) return;
    HD.chart.line(box, {
      label: 'Hot water tank, last 24 hours', height: window.innerWidth <= 820 ? 170 : 210, endLabels: false, ticks: 4, xTicks: window.innerWidth <= 820 ? 4 : 8,
      format: (v, tick) => (tick ? `${v}°` : `${v.toFixed(1)}°C`),
      series: [{ name: 'Tank', points: d[C().heatPump.tankTemp], color: 'var(--c2)', area: true }],
    });
  }

  // ── Battery plan for the peak hours after the next cheap window ──
  const hm = (ts) => HD.u.fmt(ts, { hour: '2-digit', minute: '2-digit' });
  function planHtml() {
    const p = HD.battery && HD.battery.plan();
    if (!p) return '<p class="note">Working it out from the last week…</p>';
    const w = p.window; const s = p.sim; const t = HD.tariff.tariffAt(w.end);
    const dayName = HD.u.fmt(w.end, { weekday: 'long' });
    const pct = (v) => `${Math.round(v)}%`;
    let head; let text;
    if (p.full.imp > 0.5) {
      head = `${pct(100)}<small> and still short</small>`;
      text = `Even full, it runs out about ${hm(s.runOut)} ${dayName}: roughly ${kwh(s.imp, 1)} bought at ${pence(t.peak)} (${gbp(s.impCost)}).`;
    } else if (p.chargeKwh < 0.1) {
      head = `${pct(p.atStartPct)}<small> is enough</small>`;
      text = `No charge needed: what's in it covers ${dayName} until ${hm(w.next)}, leaving about ${pct(p.leftPct)}.`;
    } else {
      head = `${pct(p.target)}<small> is enough</small>`;
      text = `Charging to ${pct(p.target)} (${kwh(p.chargeKwh, 1)}, ${gbp(p.chargeCost)} at ${pence(t.offPeak)}) covers ${dayName} until ${hm(w.next)} with about ${pct(p.leftPct)} left.${p.target < 100 ? ` A full charge would leave ${pct(p.fullLeftPct)}, carried over to the next day.` : ''}`;
    }
    return `<p class="big">${head}</p><p class="plan-text">${text}</p>
      <dl class="cop-facts plan-facts">
        <div><dt>House use</dt><dd>${kwh(s.used, 1)}</dd></div>
        <div><dt>Solar${p.forecastUsed ? '' : ' (avg)'}</dt><dd>~${kwh(s.solar, 1)}</dd></div>
        <div><dt>Bought at peak</dt><dd>${kwh(s.imp, 1)}</dd></div>
        <div><dt>Sold</dt><dd>~${kwh(s.exp, 1)}</dd></div>
      </dl>`;
  }
  function drawPlan() {
    const p = HD.battery && HD.battery.plan(); const box = document.getElementById('chart-plan');
    if (!p || !box) return;
    const series = [{ name: `Charged to ${p.target}%`, points: p.traceT, color: 'var(--s-battery)', area: true }];
    if (p.traceF) series.push({ name: 'Charged full', points: p.traceF, color: 'var(--muted)', dashed: true });
    HD.chart.line(box, {
      label: 'Expected battery charge', height: 130, yMin: 0, yMax: 100, ticks: 2, xMin: p.window.end, xMax: p.window.next, xTicks: 6, endLabels: false,
      format: (v) => `${Math.round(v)}%`, series,
    });
  }

  HD.views.energy = {
    title: 'Energy',
    mount(root) {
      const t = HD.tariff.tariffAt(Date.now());
      root.innerHTML = `
      <div class="panel-grid energy">
        <section class="panel wide">
          <header><h2>Power today</h2><p>Shaded: ${String(t.offPeakStart).padStart(2, '0')}:00–${String(t.offPeakEnd).padStart(2, '0')}:00 at ${pence(t.offPeak)}. Above zero is power coming in (solar, grid buying, battery supplying); below zero is power going out (the house using it, the battery charging, selling to the grid).</p></header>
          <div id="chart-power" class="chart-box"></div>
          <div id="chart-soc" class="chart-box"></div>
        </section>
        <section class="panel plan-panel">
          <header><h2>Battery plan</h2><p>For the peak hours after the next cheap window. Estimated from the last 7 days' use (car charging left out) and the hourly cloud forecast.</p></header>
          <div id="plan"></div>
          <div id="chart-plan" class="chart-box"></div>
        </section>
        ${HD.carbon && HD.carbon.enabled() ? `<section class="panel carbon-panel">
          <header><h2>Grid carbon</h2><p>Regional forecast from the National Energy System Operator. Shaded: cheap rate.</p></header>
          <div id="carbon"></div>
          <div id="chart-carbon" class="chart-box"></div>
        </section>` : ''}
        <section class="panel">
          <header><h2>Grid, last 30 days</h2><p>Bought above the line, sold below.</p></header>
          <div id="chart-daily-grid" class="chart-box"></div>
        </section>
        <section class="panel">
          <header><h2>Solar and use, last 30 days</h2><p>Spikes are usually the ${esc(C().ev.name || 'car')} charging overnight.</p></header>
          <div id="chart-daily-use" class="chart-box"></div>
        </section>
        ${hasTank() ? `<section class="panel wide tank-panel">
          <header><h2>Hot water tank</h2><p>Last 24 hours</p></header>
          <div class="tank-body"><div id="tank"></div><div id="chart-tank" class="chart-box"></div></div>
        </section>` : ''}
      </div>`;
      this.update(); this.redraw();
      if (HD.battery) HD.battery.load().then(() => { if (document.getElementById('plan')) this.redraw(); });
      if (HD.carbon) HD.carbon.load().then(() => { if (document.getElementById('carbon')) this.redraw(); });
    },
    redraw() {
      drawToday(); drawDaily(); drawTank();
      const pl = document.getElementById('plan'); if (pl) { HD.u.setHTML(pl, planHtml()); drawPlan(); }
      const cb = document.getElementById('carbon'); if (cb && HD.carbon) { HD.u.setHTML(cb, HD.carbon.panelHtml()); HD.carbon.draw(document.getElementById('chart-carbon')); }
      // Forecasts go stale: reload in the background on each data refresh (each is cached)
      if (HD.battery) HD.battery.load();
      if (HD.carbon) HD.carbon.load();
    },
    // Only the tank figures follow live states; the charts redraw on data refresh
    update() { const tk = document.getElementById('tank'); if (tk && hasTank()) HD.u.setHTML(tk, tankHtml()); },
  };
})();
