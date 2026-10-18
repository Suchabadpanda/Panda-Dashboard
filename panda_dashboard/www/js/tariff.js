/*
 * Tariff, cost and return-on-investment maths.
 *
 * Savings method (kept consistent with the energy tracker's corrected formula,
 * which treats export credit as saving on top of the avoided import):
 *   baseline  = what the household load would have cost with no system
 *   actual    = import cost − export credit           (standing charge cancels out)
 *   saving    = baseline − actual
 * HA statistics win for every month they cover; the tracker CSV fills earlier months.
 * Baseline: household load kWh × roi.baselineRate where HA measured the load,
 * else the same calendar month before install from the tracker CSV.
 */
window.HD = window.HD || {};

(function () {
  const cfg = () => HD.config;

  function tariffAt(ts) {
    const d = new Date(ts);
    let t = cfg().tariffs[0];
    cfg().tariffs.forEach((row) => { if (d >= new Date(row.from + 'T00:00:00')) t = row; });
    return t;
  }

  function isOffPeak(ts) {
    const t = tariffAt(ts);
    const h = new Date(ts).getHours();
    return t.offPeakStart <= t.offPeakEnd ? h >= t.offPeakStart && h < t.offPeakEnd : h >= t.offPeakStart || h < t.offPeakEnd;
  }

  function importRate(ts) { const t = tariffAt(ts); return isOffPeak(ts) ? t.offPeak : t.peak; }

  // Price hourly statistics rows ({start, change}) → { kwh, cost, offPeakKwh }
  function priceImport(rows) {
    let kwh = 0; let cost = 0; let off = 0;
    (rows || []).forEach((r) => {
      const v = Math.max(0, r.change || 0);
      kwh += v; cost += v * importRate(r.start);
      if (isOffPeak(r.start)) off += v;
    });
    return { kwh, cost, offPeakKwh: off };
  }
  function priceExport(rows) {
    let kwh = 0; let credit = 0;
    (rows || []).forEach((r) => { const v = Math.max(0, r.change || 0); kwh += v; credit += v * tariffAt(r.start).export; });
    return { kwh, credit };
  }

  // Bucket hourly rows by local YYYY-MM
  function byMonth(rows) {
    const m = {};
    (rows || []).forEach((r) => { const k = ym(r.start); (m[k] = m[k] || []).push(r); });
    return m;
  }
  function ym(ts) { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
  function daysInMonth(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); }

  // Parse energy tracker CSV
  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    const head = lines.shift().split(',').map((h) => h.trim().toLowerCase());
    const idx = (n) => head.indexOf(n);
    const rows = {};
    lines.forEach((line) => {
      const c = line.split(',');
      const label = (c[idx('label')] || '').trim();
      const key = normaliseLabel(label);
      if (!key) return;
      const num = (n) => { const v = parseFloat(c[idx(n)]); return Number.isFinite(v) ? v : null; };
      rows[key] = {
        import: num('import_kwh'), export: num('export_kwh'),
        importCost: num('import_cost'), exportCredit: num('export_credit'), standing: num('standing_charge'),
      };
    });
    return rows;
  }
  function normaliseLabel(label) {
    let m = label.match(/^(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
    m = label.match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
    if (m) {
      const i = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase());
      if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`;
    }
    return null;
  }

  /*
   * Build the month-by-month ROI table.
   *  ha:      { 'YYYY-MM': { import, export, load, pv, charge } } monthly kWh from HA
   *  hourly:  { import: rows, export: rows } hourly stats (optional — exact TOU pricing)
   *  csv:     parsed tracker rows (optional)
   */
  function buildRoi(ha, hourly, csv, statsStart) {
    const r = cfg().roi;
    const install = new Date(r.installDate + 'T00:00:00');
    const startKey = ym(install);
    const nowKey = ym(Date.now());
    const impByMonth = byMonth(hourly && hourly.import);
    const expByMonth = byMonth(hourly && hourly.export);
    const months = [];

    for (let d = new Date(install.getFullYear(), install.getMonth(), 1); ym(d) <= nowKey; d.setMonth(d.getMonth() + 1)) {
      const key = ym(d);
      const h = ha[key] && ha[key].import != null ? ha[key] : null;
      const c = csv && csv[key];
      const firstHaMonth = statsStart && ym(statsStart) === key && new Date(statsStart).getDate() > 1;
      const row = { key, label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), partial: key === nowKey || key === startKey || firstHaMonth, estimated: false };

      if (h) {
        row.source = 'ha';
        row.import = h.import; row.export = h.export; row.load = h.load;
        if (impByMonth[key]) {
          row.importCost = priceImport(impByMonth[key]).cost;
          row.exportCredit = priceExport(expByMonth[key]).credit;
        } else {
          // No hourly split: off-peak share ≈ grid energy put into the battery overnight
          const t = tariffAt(new Date(key + '-15'));
          const share = h.import ? Math.min(0.95, (h.charge || 0) / h.import) : 0.8;
          row.importCost = h.import * (share * t.offPeak + (1 - share) * t.peak);
          row.exportCredit = h.export * t.export;
          row.estimated = true;
        }
      } else if (c && c.importCost != null) {
        // Tracker month (before HA recorded). Export credit is accrued from kWh at the
        // export rate: the CSV's credit column holds E.ON's lump payments, which land
        // months after the export happened.
        row.source = 'tracker';
        row.import = c.import; row.export = c.export; row.load = null;
        row.importCost = c.importCost;
        row.exportCredit = c.export ? c.export * tariffAt(new Date(key + '-15')).export : (c.exportCredit || 0);
      } else {
        row.source = 'none';
      }

      if (row.source !== 'none') {
        // Prefer measured household load (captures the heat pump and EV the old bills didn't have);
        // fall back to the same calendar month before install from the tracker CSV.
        const y = +key.slice(0, 4); const mm = key.slice(4);
        const before = csv && [csv[`${y - 1}${mm}`], csv[`${y - 2}${mm}`]].find((b, i) => b && b.importCost != null && new Date(`${y - 1 - i}${mm}-01`) < install);
        if (row.load != null) {
          row.baseline = row.load * r.baselineRate; row.baselineFrom = `load × ${(r.baselineRate * 100).toFixed(1)}p`;
        } else if (before) {
          row.baseline = before.importCost; row.baselineFrom = 'same month before install';
        }
        row.actual = row.importCost - row.exportCredit;
        row.saving = row.baseline != null ? row.baseline - row.actual : null;
        // Install month: only the days after install count
        if (key === startKey && row.saving != null) row.saving *= (daysInMonth(startKey) - install.getDate() + 1) / daysInMonth(startKey);
      }
      months.push(row);
    }

    // Fill untracked months with the tracked average (marked estimated)
    const tracked = months.filter((m) => m.saving != null && !m.partial);
    const avg = tracked.length ? tracked.reduce((a, m) => a + m.saving, 0) / tracked.length : 0;
    months.forEach((m) => {
      if (m.saving == null) {
        let f = fractionOfMonth(m.key);
        if (m.key === startKey) f *= (daysInMonth(startKey) - install.getDate() + 1) / daysInMonth(startKey);
        m.saving = avg * f; m.filled = true;
      }
    });

    let cum = 0;
    months.forEach((m) => { cum += m.saving; m.cumulative = cum; });

    // Projection with annual price rise
    const proj = [];
    let pc = cum; let date = new Date(); let paybackDate = cum >= r.systemCost ? new Date() : null;
    const monthlyRise = Math.pow(1 + r.priceRise, 1 / 12);
    let monthly = avg;
    const end = new Date(install); end.setFullYear(end.getFullYear() + r.horizonYears);
    while (date < end) {
      date = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      monthly *= monthlyRise; pc += monthly;
      proj.push({ ts: date.getTime(), cumulative: pc });
      if (!paybackDate && pc >= r.systemCost) paybackDate = new Date(date);
    }
    const years = paybackDate ? (paybackDate - install) / (365.25 * 864e5) : null;

    return {
      months, projection: proj, avgMonthly: avg, cumulative: cum,
      paybackDate, paybackYears: years, netAtHorizon: pc - r.systemCost,
      trackedCount: tracked.length, filledCount: months.filter((m) => m.filled).length,
      hasCsv: !!csv, statsStart,
    };
  }

  function fractionOfMonth(key) {
    if (key !== ym(Date.now())) return 1;
    return new Date().getDate() / daysInMonth(key);
  }

  HD.tariff = { tariffAt, isOffPeak, importRate, priceImport, priceExport, parseCsv, buildRoi, ym };
})();
