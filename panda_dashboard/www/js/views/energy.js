/*
 * Energy view: today's power, battery charge, the last 30 days and the hot water tank.
 * Monthly costs and payback live in the Energy Tracker add-on.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, pence } = HD.u;
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
    },
    redraw() { drawToday(); drawDaily(); drawTank(); },
    // Only the tank figures follow live states; the charts redraw on data refresh
    update() { const tk = document.getElementById('tank'); if (tk && hasTank()) HD.u.setHTML(tk, tankHtml()); },
  };
})();
