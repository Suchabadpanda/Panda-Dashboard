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

  // Solar power right now, in kW. The Sigen plant figure (pvPower) reads well below the strings
  // in weak light (25 Nov: plant ~0.07 kW vs roof 0.18 + ground 0.06 kW, which is what the Sigen
  // app shows), so add up the strings when they're configured and reporting; else use pvPower.
  data.pvNow = function () {
    const e = C().energy || {};
    const ids = (e.strings ? e.strings.map((x) => x.power) : [e.pv1Power, e.pv2Power]).filter(Boolean);
    let sum = null;
    ids.forEach((id) => { const v = HD.store.num(id); if (v != null) sum = (sum || 0) + v; });
    return sum != null ? sum : HD.store.num(e.pvPower);
  };
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

  const startOfDay = () => { const d = new Date(HD.u.now()); d.setHours(0, 0, 0, 0); return d.getTime(); };

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
    const nowTs = HD.u.now();
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
    const nowTs = HD.u.now();
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
    if (HD.garage) ids.push(...HD.garage.ids());
    const end = HD.u.now();
    const start = end - 24 * 3600e3;
    // 5-minute statistics (HA keeps 10 days): an hourly mean only appears once its hour is over,
    // so hourly charts ran up to 2 hours behind. Hourly is the fallback for any sensor without them.
    const [fine, res] = await Promise.all([
      HD.ha.stats(ids, start, end, '5minute', ['mean']).catch(() => null),
      HD.ha.stats(ids, start, end, 'hour', ['mean']),
    ]);
    data.temps = {};
    ids.forEach((id) => {
      const rows = fine && fine[id] && fine[id].length ? fine[id] : (res[id] || []);
      data.temps[id] = rows.filter((r) => r.mean != null).map((r) => [r.start, r.mean]);
    });
  }

  async function refresh() {
    if (data.loading) return;
    data.loading = true;
    const jobs = [loadToday, loadYesterday, loadDaily, loadTemps];
    if (HD.damp && HD.damp.enabled()) jobs.push(function loadDamp() { return HD.damp.load(); });
    // Each request gives up after 30 s (HD.ha.stats), so this can't stay "loading" for good
    try { await Promise.all(jobs.map((j) => Promise.resolve().then(j).catch((e) => console.warn(j.name, e)))); }
    finally { data.loading = false; }
    emit();
  }

  data.refresh = refresh;
})();
