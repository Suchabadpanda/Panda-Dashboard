/*
 * History + derived figures pulled from HA long-term statistics.
 * Refreshed every 5 minutes; views read HD.data.* and listen with HD.data.on().
 */
window.HD = window.HD || {};

(function () {
  const C = () => HD.config;
  const listeners = new Set();
  const data = {
    today: null,      // { curves, importCost, exportCredit, net, offPeakKwh, ... }
    daily: null,      // { days:[ts], series:{id:[kWh]} }
    monthly: null,    // { 'YYYY-MM': {import, export, load, pv, charge, discharge, heatPump, ev} }
    temps: null,      // { id: [[ts, °C]] }
    roi: null,
    csv: null,
    loading: false,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  HD.data = data;
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  const startOfDay = () => { const d = HD.store.mode === 'demo' ? new Date(HD.demo.snapshotTime) : new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  async function loadToday() {
    const e = C().energy; const hp = C().heatPump; const ev = C().ev;
    const t0 = startOfDay();
    const ids = [e.pvPower, e.loadPower, e.batteryPower, e.gridPower, e.soc, hp.power, ev.power];
    const [curves, hourly] = await Promise.all([
      HD.ha.stats(ids, t0, null, '5minute', ['mean']),
      HD.ha.stats([e.totals.import, e.totals.export], t0, null, 'hour', ['change']),
    ]);
    const imp = HD.tariff.priceImport(hourly[e.totals.import]);
    const exp = HD.tariff.priceExport(hourly[e.totals.export]);
    // Hourly statistics lag the current hour; price the remainder from today's counters.
    const nowTs = HD.store.mode === 'demo' ? HD.demo.snapshotTime : Date.now();
    const impToday = HD.store.num(e.importToday); const expToday = HD.store.num(e.exportToday);
    if (impToday != null && impToday > imp.kwh) { const r = impToday - imp.kwh; imp.cost += r * HD.tariff.importRate(nowTs); if (HD.tariff.isOffPeak(nowTs)) imp.offPeakKwh += r; imp.kwh = impToday; }
    if (expToday != null && expToday > exp.kwh) { const r = expToday - exp.kwh; exp.credit += r * HD.tariff.tariffAt(nowTs).export; exp.kwh = expToday; }
    const standing = HD.tariff.tariffAt(nowTs).standing;
    data.today = {
      curves, importKwh: imp.kwh, importCost: imp.cost, offPeakKwh: imp.offPeakKwh,
      exportKwh: exp.kwh, exportCredit: exp.credit, standing,
      net: imp.cost + standing - exp.credit,
    };
  }

  async function loadDaily() {
    const t = C().energy.totals;
    const ids = [t.import, t.export, t.pv, t.load, t.heatPump, t.ev, t.charge, t.discharge];
    const res = await HD.ha.stats(ids, startOfDay() - 30 * 864e5, null, 'day', ['change']);
    const days = (res[t.load] || res[t.import] || []).map((r) => r.start);
    const series = {};
    ids.forEach((id) => {
      const m = new Map((res[id] || []).map((r) => [r.start, r.change]));
      series[id] = days.map((d) => m.get(d) ?? null);
    });
    data.daily = { days, series };
  }

  async function loadMonthly() {
    const t = C().energy.totals;
    const ids = [t.import, t.export, t.pv, t.load, t.charge, t.discharge, t.heatPump, t.ev];
    const install = new Date(C().roi.installDate + 'T00:00:00');
    const res = await HD.ha.stats(ids, new Date(install.getFullYear(), install.getMonth(), 1), null, 'month', ['change']);
    const map = {};
    const key = { [t.import]: 'import', [t.export]: 'export', [t.pv]: 'pv', [t.load]: 'load', [t.charge]: 'charge', [t.discharge]: 'discharge', [t.heatPump]: 'heatPump', [t.ev]: 'ev' };
    Object.entries(res).forEach(([id, rows]) => rows.forEach((r) => {
      const k = HD.tariff.ym(r.start); (map[k] = map[k] || {})[key[id]] = r.change;
    }));
    data.monthly = map;

    // Exact time-of-use pricing from hourly statistics (live only — demo has no hourly history)
    let hourly = null;
    if (HD.store.mode === 'live') {
      try {
        const h = await HD.ha.stats([t.import, t.export], install, null, 'hour', ['change']);
        hourly = { import: h[t.import], export: h[t.export] };
      } catch (e) { console.warn('Hourly stats unavailable', e); }
    }
    data.csv = await loadCsv();
    const statsStart = hourly && hourly.import && hourly.import.length ? hourly.import[0].start : (HD.store.mode === 'demo' ? HD.demo.statsStart : null);
    data.roi = HD.tariff.buildRoi(map, hourly, data.csv, statsStart);
  }

  async function loadCsv() {
    try {
      const saved = localStorage.getItem('hd.trackerCsv');
      if (saved) return HD.tariff.parseCsv(saved);
    } catch (e) { /* ignore */ }
    for (const url of C().roi.csvUrls) {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) { const txt = await r.text(); if (/import_kwh/i.test(txt)) return HD.tariff.parseCsv(txt); }
      } catch (e) { /* not there */ }
    }
    return null;
  }

  async function loadTemps() {
    const ids = [];
    C().floors.forEach((f) => f.rooms.forEach((r) => ids.push(r.temp)));
    ids.push(C().heatPump.tankTemp);
    const end = HD.store.mode === 'demo' ? HD.demo.snapshotTime : Date.now();
    const res = await HD.ha.stats(ids, end - 24 * 3600e3, end, 'hour', ['mean']);
    data.temps = {};
    ids.forEach((id) => { data.temps[id] = (res[id] || []).map((r) => [r.start, r.mean]); });
  }

  async function refresh() {
    if (data.loading) return;
    data.loading = true;
    const jobs = [loadToday, loadDaily, loadTemps];   // payback/monthly costs live in the energy tracker
    await Promise.all(jobs.map((j) => j().catch((e) => console.warn(j.name, e))));
    data.loading = false;
    emit();
  }

  data.refresh = refresh;
  data.importCsv = async (text) => {
    try { localStorage.setItem('hd.trackerCsv', text); } catch (e) { /* ignore */ }
    data.csv = HD.tariff.parseCsv(text);
    await loadMonthly(); emit();
  };
  data.clearCsv = async () => {
    try { localStorage.removeItem('hd.trackerCsv'); } catch (e) { /* ignore */ }
    await loadMonthly(); emit();
  };
})();
