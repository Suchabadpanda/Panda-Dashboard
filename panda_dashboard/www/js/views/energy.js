/*
 * Energy view: today's power, battery charge, the last 30 days, and the money —
 * monthly cost vs export credit and the payback picture from the energy tracker.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, kwh, gbp, pence } = HD.u;
  const C = () => HD.config;

  const pts = (rows) => (rows || []).map((r) => [r.start, r.mean]);

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
      label: 'Power through the day', height: 240, zero: true, regions: offPeak,
      xMin: dayStart.getTime(), xMax: dayStart.getTime() + 24 * 3600e3, xTicks: 6,
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(2)} kW`),
      series: [
        { name: 'House', points: pts(c[e.loadPower]), color: 'var(--s-load)' },
        { name: 'Battery (+ charging)', short: 'Battery', points: pts(c[e.batteryPower]), color: 'var(--s-battery)' },
        { name: 'Solar', points: pts(c[e.pvPower]), color: 'var(--s-solar)', area: true },
        { name: 'Grid (+ buying)', short: 'Grid', points: pts(c[e.gridPower]), color: 'var(--s-grid)' },
      ],
    });
    HD.chart.line(document.getElementById('chart-soc'), {
      label: 'Battery charge through the day', height: 120, yMin: 0, yMax: 100, ticks: 2, regions: offPeak,
      xMin: dayStart.getTime(), xMax: dayStart.getTime() + 24 * 3600e3, xTicks: 6, endLabels: false, padRight: 74,
      format: (v) => `${Math.round(v)}%`,
      series: [{ name: 'Battery charge', points: pts(c[e.soc]), color: 'var(--s-battery)', area: true }],
    });
  }

  function drawDaily() {
    const d = HD.data.daily; const t = C().energy.totals;
    if (!d) return;
    const cats = d.days.map((ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    const long = d.days.map((ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
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

  function drawMoney() {
    const roi = HD.data.roi;
    const box = document.getElementById('roi-summary');
    if (!roi || !box) return;
    const r = C().roi;
    const months = roi.months.filter((m) => m.source !== 'none');
    HD.chart.bars(document.getElementById('chart-money'), {
      label: 'Monthly import cost and export credit', height: 220,
      categories: months.map((m) => m.label),
      format: (v, tick) => (tick ? `£${Math.round(v)}` : gbp(v)),
      series: [
        { name: 'Paid for import', values: months.map((m) => m.importCost), color: 'var(--s-import)' },
        { name: 'Earned from export', values: months.map((m) => m.exportCredit), color: 'var(--s-export)', down: true },
      ],
      tipExtra: (i) => {
        const m = months[i];
        return `<div class="tip-note">Saved ${gbp(m.saving)} vs ${esc(m.baselineFrom || 'baseline')}${m.estimated ? ' · peak/off-peak split estimated' : ''}${m.partial ? ' · part month' : ''}</div>`;
      },
    });

    const install = new Date(r.installDate + 'T00:00:00').getTime();
    const monthEnd = (key) => { const [y, mo] = key.split('-').map(Number); return Math.min(Date.now(), new Date(y, mo, 1).getTime()); };
    const actual = [[install, 0], ...roi.months.map((m) => [monthEnd(m.key), m.cumulative])];
    const horizon = roi.projection.filter((p, i) => i % 3 === 0 || i === roi.projection.length - 1).map((p) => [p.ts, p.cumulative]);
    const lastActual = actual[actual.length - 1];
    HD.chart.line(document.getElementById('chart-roi'), {
      label: 'Cumulative savings against system cost', height: 240,
      xMin: install, xMax: horizon.length ? horizon[horizon.length - 1][0] : Date.now(), xTicks: 5,
      xFormat: (ts) => String(new Date(ts).getFullYear()), tipX: (ts) => new Date(ts).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
      format: (v, tick) => (tick ? `£${(v / 1000).toFixed(0)}k` : gbp(v, 0)), yMin: 0,
      series: [
        { name: 'Saved so far', short: 'Saved', points: actual, color: 'var(--s-load)' },
        { name: `Projected (+${(r.priceRise * 100).toFixed(1)}%/yr prices)`, short: 'Projected', points: [lastActual, ...horizon], color: 'var(--s-load)', dashed: true },
        { name: 'System cost', short: 'Cost', points: [[install, r.systemCost], [horizon.length ? horizon[horizon.length - 1][0] : Date.now(), r.systemCost]], color: 'var(--s-cost)', dashed: true },
      ],
    });

    const yrs = roi.paybackYears;
    box.innerHTML = `
      <div><dt>Saved since install</dt><dd>${gbp(roi.cumulative, 0)}</dd></div>
      <div><dt>Average per month</dt><dd>${gbp(roi.avgMonthly, 0)}</dd></div>
      <div><dt>Pays for itself</dt><dd>${roi.paybackDate ? roi.paybackDate.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : 'beyond horizon'}<small>${yrs ? `${yrs.toFixed(1)} years after install` : ''}</small></dd></div>
      <div><dt>Net after ${r.horizonYears} years</dt><dd>${gbp(roi.netAtHorizon, 0)}</dd></div>`;

    const note = document.getElementById('roi-note');
    note.innerHTML = roi.hasCsv
      ? `Months before Home Assistant began recording come from your energy tracker CSV. ${roi.filledCount ? `${roi.filledCount} month(s) with no data use the tracked average.` : ''}`
      : `Home Assistant statistics start in ${roi.statsStart ? new Date(roi.statsStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'a later month'}, so ${roi.filledCount} earlier month(s) use the tracked average of ${gbp(roi.avgMonthly, 0)}. Import your energy tracker CSV to replace them with real figures.`;

    const table = document.getElementById('roi-table');
    table.innerHTML = `<table><thead><tr><th scope="col">Month</th><th scope="col">Bought</th><th scope="col">Sold</th><th scope="col">Import cost</th><th scope="col">Export credit</th><th scope="col">Baseline</th><th scope="col">Saved</th><th scope="col">Source</th></tr></thead><tbody>
      ${roi.months.map((m) => `<tr class="${m.filled ? 'filled' : ''}"><th scope="row">${m.label}</th><td>${m.import != null ? m.import.toFixed(0) : '–'}</td><td>${m.export != null ? m.export.toFixed(0) : '–'}</td><td>${gbp(m.importCost)}</td><td>${gbp(m.exportCredit)}</td><td>${gbp(m.baseline)}</td><td>${gbp(m.saving)}</td><td>${m.filled ? 'estimated (average)' : m.source === 'tracker' ? 'tracker CSV' : m.source === 'ha+tracker' ? 'HA + tracker CSV' : m.estimated ? 'HA, split estimated' : 'HA, hourly'}</td></tr>`).join('')}
    </tbody></table>`;
  }

  HD.views.energy = {
    title: 'Energy',
    mount(root) {
      const t = HD.tariff.tariffAt(Date.now());
      root.innerHTML = `
      <div class="panel-grid energy">
        <section class="panel wide">
          <header><h2>Power today</h2><p>Shaded: ${String(t.offPeakStart).padStart(2, '0')}:00–${String(t.offPeakEnd).padStart(2, '0')}:00 at ${pence(t.offPeak)}. Above zero the battery is charging and the house is buying.</p></header>
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
        <section class="panel">
          <header><h2>Money by month</h2><p>At your ${C().tariffName ? `${esc(C().tariffName)} ` : ''}rates: ${pence(t.offPeak)} off-peak, ${pence(t.peak)} peak, ${pence(t.export)} export.</p></header>
          <div id="chart-money" class="chart-box"></div>
        </section>
        <section class="panel">
          <header><h2>Payback</h2><p>${gbp(C().roi.systemCost)} system, installed ${new Date(C().roi.installDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</p></header>
          <dl id="roi-summary" class="stat-row"></dl>
          <div id="chart-roi" class="chart-box"></div>
          <p id="roi-note" class="note"></p>
          <div class="csv-actions">
            <label class="btn">Import tracker CSV<input type="file" id="csv-input" accept=".csv,text/csv" hidden></label>
            <button class="btn ghost" id="csv-clear" type="button">Forget imported CSV</button>
          </div>
        </section>
        <details class="panel wide table-view">
          <summary>Month-by-month table</summary>
          <div id="roi-table" class="table-scroll"></div>
        </details>
      </div>`;
      document.getElementById('csv-input').addEventListener('change', async (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        await HD.data.importCsv(await f.text());
      });
      document.getElementById('csv-clear').addEventListener('click', () => HD.data.clearCsv());
      this.redraw();
    },
    redraw() { drawToday(); drawDaily(); drawMoney(); },
    update() { /* charts redraw on data refresh, not on every state change */ },
  };
})();
