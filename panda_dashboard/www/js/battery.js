/*
 * Battery plan: how far the battery needs charging in the next cheap window to carry the house
 * through the peak hours after it, and what's left to buy or sell.
 *
 * An estimate, hour by hour:
 *   use    the house's average for that hour over the last 7 whole days, car charging left out
 *          (totals.load − totals.ev, hourly statistics).
 *   solar  the best of the last 14 days for that hour, scaled by the hourly cloud forecast
 *          (Kasten–Czeplak: × (1 − 0.75·cloud^3.4)); without a forecast, the 7-day average.
 *   battery  config energy.capacity (else energy.batteryKwh), kept above energy.batteryReserve %
 *          (default 5), 95% each way. Not discharged in the cheap window (house runs off the
 *          grid then, as the SigenStor is set up).
 * The plan is the lowest charge (in 5% steps, plus 5% for forecast error) that buys no more at
 * peak than a full charge would. Charging more doesn't cost extra at peak, it just carries over.
 */
window.HD = window.HD || {};

(function () {
  const C = () => HD.config;
  const S = () => HD.store;
  const H = 3600e3;
  const EFF = 0.95;
  const nowTs = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());
  const midnight = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

  let hist = null; let histAt = 0;
  let forecast = null; let forecastAt = 0;
  let busy = null;

  async function loadHistory() {
    const t = C().energy.totals; const today = midnight(nowTs());
    const res = await HD.ha.stats([t.load, t.ev, t.pv].filter(Boolean), today - 14 * 864e5, today, 'hour', ['change']);
    const byHour = (id) => new Map((res[id] || []).map((r) => [r.start, Math.max(0, r.change || 0)]));
    const load = byHour(t.load); const ev = byHour(t.ev); const pv = byHour(t.pv);
    const use = Array.from({ length: 24 }, () => []); const sun = Array.from({ length: 24 }, () => []);
    load.forEach((v, ts) => { if (ts >= today - 7 * 864e5) use[new Date(ts).getHours()].push(Math.max(0, v - (ev.get(ts) || 0))); });
    pv.forEach((v, ts) => sun[new Date(ts).getHours()].push(v));
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    if (!use.some((a) => a.length)) return null;
    return {
      use: use.map(avg),
      pvBest: sun.map((a) => (a.length ? Math.max(...a) : 0)),
      pvAvg: sun.map((a) => avg(a.slice(-7))),
    };
  }

  async function loadForecast() {
    const r = S().mode === 'demo'
      ? HD.demo.forecast()
      : await HD.ha.callWS({ type: 'call_service', domain: 'weather', service: 'get_forecasts', service_data: { entity_id: C().weather, type: 'hourly' }, return_response: true });
    const f = r && r.response && r.response[C().weather];
    return f && f.forecast ? f.forecast : null;
  }

  function load() {
    if (busy) return busy;
    const jobs = [];
    if (!hist || Date.now() - histAt > 3 * H) jobs.push(loadHistory().then((h) => { hist = h; histAt = Date.now(); }).catch((e) => console.warn('Battery plan history unavailable', e)));
    if (C().weather && (!forecast || Date.now() - forecastAt > 30 * 60e3)) jobs.push(loadForecast().then((f) => { forecast = f; forecastAt = Date.now(); }).catch((e) => console.warn('Battery plan forecast unavailable', e)));
    busy = Promise.all(jobs).finally(() => { busy = null; });
    return busy;
  }

  // Solar expected in the hour starting at ts (kWh)
  function solarAt(ts) {
    const h = new Date(ts).getHours();
    const f = forecast && forecast.find((x) => Math.abs(Date.parse(x.datetime) - ts) < H / 2);
    if (f && f.cloud_coverage != null) return hist.pvBest[h] * (1 - 0.75 * Math.pow(f.cloud_coverage / 100, 3.4));
    return hist.pvAvg[h];
  }

  // The next cheap window (or the one we're in): [start, end] on hour boundaries
  function cheapWindow(now) {
    const off = (ts) => HD.tariff.isOffPeak(ts);
    let ts = new Date(now).setMinutes(0, 0, 0);
    let i = 0;
    if (off(ts)) { while (i++ < 48 && off(ts - H)) ts -= H; } else { while (i++ < 48 && !off(ts)) ts += H; }
    const start = ts; let end = ts;
    i = 0; while (i++ < 48 && off(end)) end += H;
    let next = end; i = 0; while (i++ < 48 && !off(next)) next += H;
    return { start, end, next };
  }

  // Run the battery through [from, to) starting with e kWh; hours already in the cheap window don't discharge
  function simulate(e, from, to, cap, reserve, trace) {
    let imp = 0; let exp = 0; let used = 0; let solar = 0; let fromBat = 0; let runOut = null; let impCost = 0; let expCredit = 0;
    for (let ts = from; ts < to; ts = Math.floor(ts / H) * H + H) {
      const slotEnd = Math.min(to, Math.floor(ts / H) * H + H);
      const f = (slotEnd - ts) / H; const hourStart = Math.floor(ts / H) * H;
      const u = hist.use[new Date(ts).getHours()] * f; const pv = solarAt(hourStart) * f;
      used += u; solar += pv;
      const t = HD.tariff.tariffAt(ts);
      let net = u - pv;
      if (net > 0) {
        const can = HD.tariff.isOffPeak(ts) ? 0 : Math.max(0, (e - reserve) * EFF);
        const b = Math.min(net, can); e -= b / EFF; fromBat += b; net -= b;
        if (net > 0.01 && !HD.tariff.isOffPeak(ts) && runOut == null) runOut = ts;
        imp += net; impCost += net * HD.tariff.importRate(ts);
      } else {
        const c = Math.min(-net, Math.max(0, (cap - e) / EFF)); e += c * EFF;
        exp += -net - c; expCredit += (-net - c) * t.export;
      }
      if (trace) trace.push([slotEnd, (e / cap) * 100]);
    }
    return { e, imp, exp, used, solar, fromBat, runOut, impCost, expCredit };
  }

  function plan() {
    const en = C().energy;
    const cap = S().num(en.capacity) || en.batteryKwh;
    const soc = S().num(en.soc);
    if (!hist || !cap || soc == null || !C().tariffs) return null;
    const reserve = ((en.batteryReserve ?? 5) / 100) * cap;
    const now = nowTs();
    const w = cheapWindow(now);
    // Until the window starts the battery keeps serving the house
    const before = now < w.start ? simulate((soc / 100) * cap, now, w.start, cap, reserve) : { e: (soc / 100) * cap };
    const atStart = before.e;
    const run = (pct, trace) => simulate(Math.max(atStart, (pct / 100) * cap), w.end, w.next, cap, reserve, trace);
    const full = run(100);
    let target = 100;
    for (let p = 0; p <= 100; p += 5) { if (run(p).imp <= full.imp + 0.25) { target = p; break; } }
    const startPct = Math.ceil((atStart / cap) * 100);
    if (target < 100) target = Math.min(100, target + 5);
    if (target < startPct) target = startPct;
    const traceT = [[w.end, Math.max(atStart / cap, target / 100) * 100]]; const sim = run(target, traceT);
    const traceF = target < 100 ? [[w.end, 100]] : null; if (traceF) run(100, traceF);
    const chargeKwh = Math.max(0, (target / 100) * cap - atStart) / EFF;
    const t = HD.tariff.tariffAt(w.start);
    return {
      cap, soc, atStartPct: (atStart / cap) * 100, window: w, target, chargeKwh, chargeCost: chargeKwh * t.offPeak,
      sim, full, traceT, traceF, leftPct: (sim.e / cap) * 100, fullLeftPct: (full.e / cap) * 100,
      forecastUsed: !!(forecast && forecast.length),
    };
  }

  HD.battery = { load, plan };
})();
