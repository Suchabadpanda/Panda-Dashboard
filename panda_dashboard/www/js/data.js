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
    yesterday: null,  // { net, importCost, exportCredit, standing, netByNow }
    daily: null,      // { days:[ts], series:{id:[kWh]} }
    temps: null,      // { id: [[ts, °C]] }
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

  // Yesterday's net cost, in all and up to this time of day, priced the same way as today
  let yKey = null; let yRows = null;
  async function loadYesterday() {
    const t = C().energy.totals; const t0 = startOfDay(); const y0 = t0 - 864e5;
    const nowTs = HD.store.mode === 'demo' ? HD.demo.snapshotTime : Date.now();
    if (yKey !== y0 || !yRows) {
      const r = await HD.ha.stats([t.import, t.export], y0, t0, 'hour', ['change']);
      yRows = { imp: (r[t.import] || []).filter((x) => x.start >= y0 && x.start < t0), exp: (r[t.export] || []).filter((x) => x.start >= y0 && x.start < t0) };
      yKey = y0;
    }
    if (!yRows.imp.length) { data.yesterday = null; return; }
    const cost = (rows) => { const i = HD.tariff.priceImport(rows.imp); const e = HD.tariff.priceExport(rows.exp); return { i, e }; };
    const standing = HD.tariff.tariffAt(y0).standing;
    const all = cost(yRows);
    // Same point in the day: whole hours before now's hour, plus the part of the current hour
    const cut = y0 + (nowTs - t0);
    const part = (rows) => rows.filter((x) => x.start < cut).map((x) => (x.start + 3600e3 > cut ? { ...x, change: (x.change || 0) * ((cut - x.start) / 3600e3) } : x));
    const by = cost({ imp: part(yRows.imp), exp: part(yRows.exp) });
    const frac = Math.min(1, Math.max(0, (nowTs - t0) / 864e5));
    data.yesterday = {
      importCost: all.i.cost, exportCredit: all.e.credit, standing,
      net: all.i.cost + standing - all.e.credit,
      netByNow: by.i.cost + standing - by.e.credit,
      frac,
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

  async function loadTemps() {
    const ids = [];
    C().floors.forEach((f) => f.rooms.forEach((r) => { if (r.temp) ids.push(r.temp); }));
    if (C().heatPump && C().heatPump.tankTemp) ids.push(C().heatPump.tankTemp);
    const end = HD.store.mode === 'demo' ? HD.demo.snapshotTime : Date.now();
    const res = await HD.ha.stats(ids, end - 24 * 3600e3, end, 'hour', ['mean']);
    data.temps = {};
    ids.forEach((id) => { data.temps[id] = (res[id] || []).map((r) => [r.start, r.mean]); });
  }

  async function refresh() {
    if (data.loading) return;
    data.loading = true;
    const jobs = [loadToday, loadYesterday, loadDaily, loadTemps];
    await Promise.all(jobs.map((j) => j().catch((e) => console.warn(j.name, e))));
    data.loading = false;
    emit();
  }

  data.refresh = refresh;
})();
