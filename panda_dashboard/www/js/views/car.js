/*
 * Car view: the car (Bluetooth bridge at home, Tesla Fleet otherwise) and Wall
 * Connector, a "should I charge now?" gauge for the time-of-use tariff and spare
 * solar, and 30 days of charging.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, kw, kwh, gbp, pence, pct, dur, icon, ago } = HD.u;
  const S = () => HD.store;
  const C = () => HD.config;
  const nowTs = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());

  // Minutes until the cheap window starts (or ends, when inside it)
  function minutesToSwitch(ts) {
    const t = HD.tariff.tariffAt(ts); const off = HD.tariff.isOffPeak(ts);
    const next = new Date(ts); next.setMinutes(0, 0, 0);
    next.setHours(off ? t.offPeakEnd : (new Date(ts).getHours() >= t.offPeakStart ? 24 + t.offPeakStart : t.offPeakStart));
    return (next - ts) / 60000;
  }

  // Semicircle gauge: cheap band, peak band and a needle at the current rate
  function gauge(rate, t) {
    const max = Math.max(t.peak * 1.15, 0.3);
    const cx = 120; const cy = 118; const r = 92;
    const ang = (v) => Math.PI * (1 - Math.min(v, max) / max);
    const pt = (v, rr = r) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))];
    const arc = (a, b, cls) => {
      const [x1, y1] = pt(a); const [x2, y2] = pt(b);
      return `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}" class="${cls}"/>`;
    };
    const mid = (t.offPeak + t.peak) / 2;
    const [nx, ny] = pt(rate, r - 14);
    const ticks = [0, t.offPeak, mid, t.peak].map((v) => {
      const [x, y] = pt(v, r + 14);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="g-tick" text-anchor="middle">${Math.round(v * 100)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 240 140" class="gauge" role="img" aria-label="Current rate ${pence(rate)} per kWh">
      ${arc(0, t.offPeak, 'g-cheap')}${arc(t.offPeak, mid, 'g-mid')}${arc(mid, max, 'g-peak')}
      ${ticks}
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="g-needle"/>
      <circle cx="${cx}" cy="${cy}" r="6" class="g-hub"/>
    </svg>`;
  }

  function adviceHtml() {
    const e = C().energy; const ev = C().ev;
    const ts = nowTs(); const t = HD.tariff.tariffAt(ts); const off = HD.tariff.isOffPeak(ts);
    const rate = off ? t.offPeak : t.peak;
    const pv = S().num(e.pvPower) || 0; const grid = S().num(e.gridPower) || 0;
    const spare = pv > 0.1 && grid < -0.1 ? -grid : 0;
    const amps = Math.floor((spare * 1000) / 230);
    const mins = minutesToSwitch(ts);
    let verdict; let cls; let detail;
    if (off) {
      verdict = 'Good time to charge'; cls = 'good';
      detail = `Cheap rate until ${String(t.offPeakEnd).padStart(2, '0')}:00 (${dur(mins)} left).`;
    } else if (amps >= 6) {
      // Spare solar isn't free: it would otherwise be sold at the export rate
      const worth = t.export > t.offPeak;
      verdict = worth ? 'Spare solar, but tonight is cheaper' : 'Charge on spare solar'; cls = worth ? 'mid' : 'good';
      detail = worth
        ? `Exporting ${kw(spare)} (enough for ${Math.min(amps, 32)} A). Selling it earns ${pence(t.export)}/kWh, more than the ${pence(t.offPeak)} cheap rate, so only use it if you need charge before ${String(t.offPeakStart).padStart(2, '0')}:00.`
        : `Exporting ${kw(spare)} of solar, enough to charge at ${Math.min(amps, 32)} A for less than the cheap rate (it only earns ${pence(t.export)} sold).`;
    } else {
      verdict = 'Wait for the cheap rate'; cls = 'bad';
      detail = `Cheap rate starts in ${dur(mins)} at ${String(t.offPeakStart).padStart(2, '0')}:00.${spare > 0.1 ? ` Spare solar is only ${kw(spare)} right now.` : ''}`;
    }
    const pack = ev.batteryKwh || 60;
    const step = pack / 10;
    return `
      <div class="advice">
        ${gauge(rate, t)}
        <div class="advice-text">
          <p class="big">${pence(rate)}<small>/kWh now</small></p>
          <p class="verdict ${cls}">${verdict}</p>
          <p>${detail}</p>
          <p class="sub">Each 10% of charge (${step.toFixed(0)} kWh) costs ${gbp(step * t.offPeak)} on the cheap rate, ${gbp(step * t.peak)} at peak.</p>
        </div>
      </div>`;
  }

  // ── Tonight's plan, or live details while charging ──
  const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00`;
  const clock = (ts) => HD.u.fmt(ts, { hour: '2-digit', minute: '2-digit' });
  const CHARGE_EFF = 0.9;   // wall-to-battery; ~10% is lost as heat

  // Start of the next cheap window (now, if we're in it) and its end
  function cheapWindow(ts) {
    const t = HD.tariff.tariffAt(ts);
    const d = new Date(ts); d.setMinutes(0, 0, 0);
    const len = ((t.offPeakEnd - t.offPeakStart + 24) % 24) || 24;
    if (HD.tariff.isOffPeak(ts)) {
      const end = new Date(ts); end.setMinutes(0, 0, 0);
      while (HD.tariff.isOffPeak(end.getTime())) end.setHours(end.getHours() + 1);
      return { start: ts, end: end.getTime(), t };
    }
    const start = new Date(ts); start.setMinutes(0, 0, 0);
    while (!HD.tariff.isOffPeak(start.getTime())) start.setHours(start.getHours() + 1);
    return { start: start.getTime(), end: start.getTime() + len * 3600e3, t };
  }

  // 24 h price strip from now: cheap/peak hours, with the planned charge laid over it
  function priceStrip(ts, plan) {
    const h0 = new Date(ts); h0.setMinutes(0, 0, 0);
    const cells = [];
    for (let i = 0; i < 24; i++) {
      const a = h0.getTime() + i * 3600e3;
      const cheap = HD.tariff.isOffPeak(a + 1);
      const charging = plan && a + 3600e3 > plan.start && a < plan.end;
      cells.push(`<i class="${cheap ? 'cheap' : 'peak'}${charging ? ' plan' : ''}" title="${hh(new Date(a).getHours())} · ${pence(HD.tariff.importRate(a + 1))}"></i>`);
    }
    const labels = [0, 6, 12, 18].map((i) => `<span style="left:${(i / 24) * 100}%">${i === 0 ? 'Now' : hh(h0.getHours() + i)}</span>`).join('');
    return `<div class="price-strip" role="img" aria-label="Electricity price for the next 24 hours">${cells.join('')}</div><div class="strip-axis">${labels}</div>`;
  }

  function planHtml() {
    const ev = C().ev; const ts = nowTs();
    const soc = num('soc'); const limit = num('limit') || 100;
    const pack = ev.batteryKwh || 60; const rateKw = ev.chargeKw || 7.2;
    const chargingState = val('charging');
    const live = Math.max(S().num(ev.power) || 0, num('chargerPower') || 0);
    const plugged = S().state(ev.connected) === 'on' || val('cable') === 'on' || (chargingState && !['disconnected', 'unknown'].includes(chargingState));
    if (soc == null) return `<h3 class="sub-head">Tonight's plan</h3>${priceStrip(ts, null)}<p class="sub">Car charge level unknown, so there's no plan.</p>`;
    const needKwh = Math.max(0, ((limit - soc) / 100) * pack) / CHARGE_EFF;

    if (live > 0.1) {
      const sess = S().num(ev.session);
      const left = needKwh / live;
      const rate = HD.tariff.importRate(ts);
      return `<h3 class="sub-head">Charging now</h3>
        ${priceStrip(ts, { start: ts, end: ts + left * 3600e3 })}
        <dl class="kv plan-kv">
          <div><dt>Power</dt><dd>${kw(live)}</dd></div>
          <div><dt>Added this session</dt><dd>${kwh(sess)}</dd></div>
          <div><dt>To ${pct(limit)}</dt><dd>${needKwh > 0.05 ? `${dur(left * 60)} · about ${clock(ts + left * 3600e3)}` : 'Almost there'}</dd></div>
          <div><dt>Cost so far</dt><dd>${sess != null ? `≈ ${gbp(sess * rate)}` : '–'}<small> at ${pence(rate)}</small></dd></div>
        </dl>`;
    }
    if (needKwh < 0.5) return `<h3 class="sub-head">Tonight's plan</h3>${priceStrip(ts, null)}<p class="sub">Already at its ${pct(limit)} limit. Nothing to charge tonight.</p>`;

    const w = cheapWindow(ts);
    const hours = needKwh / rateKw;
    const windowH = (w.end - w.start) / 3600e3;
    const cheapKwh = Math.min(needKwh, windowH * rateKw);
    const peakKwh = needKwh - cheapKwh;
    const finish = w.start + hours * 3600e3;
    const cost = cheapKwh * w.t.offPeak + peakKwh * w.t.peak;
    const startTxt = w.start <= ts ? 'now' : clock(w.start);
    const lead = plugged
      ? `Plugged in. Charging from ${startTxt}`
      : `Plug in before ${clock(w.start)}`;
    return `<h3 class="sub-head">Tonight's plan</h3>
      ${priceStrip(ts, { start: Math.max(ts, w.start), end: finish })}
      <p class="plan-line"><strong>${lead}:</strong> ${pct(soc)} → ${pct(limit)} by about ${clock(finish)}, roughly ${kwh(needKwh, 0)} for ≈ ${gbp(cost)}.</p>
      ${peakKwh > 0.5 ? `<p class="sub">That's more than the cheap window holds, so ${kwh(peakKwh, 0)} would be at the ${pence(w.t.peak)} peak rate. Lower the limit or top up across two nights to avoid it.</p>` : ''}
      <p class="sub">Assumes ${kw(rateKw)} from the Wall Connector, about 10% lost charging, and the car's schedule starting at ${hh(w.t.offPeakStart)}.</p>`;
  }

  // ── Solar top-up hint (forecast) ──
  let forecast = null; let forecastAt = 0;
  async function loadForecast() {
    if (!C().weather || Date.now() - forecastAt < 30 * 60e3) return;
    forecastAt = Date.now();
    try {
      const r = S().mode === 'demo'
        ? HD.demo.forecast()
        : await HD.ha.callWS({ type: 'call_service', domain: 'weather', service: 'get_forecasts', service_data: { entity_id: C().weather, type: 'hourly' }, return_response: true });
      const f = r && r.response && r.response[C().weather];
      forecast = f && f.forecast ? f.forecast : null;
    } catch (e) { forecast = null; console.warn('Forecast unavailable', e); }
  }

  function solarHintHtml() {
    if (!forecast || !forecast.length) return '';
    const ts = nowTs();
    // Today if the sunny part of the day is still ahead, else tomorrow
    const day = new Date(ts); if (day.getHours() >= 14) day.setDate(day.getDate() + 1);
    const dayKey = day.toDateString();
    const hours = forecast.filter((f) => {
      const d = new Date(f.datetime);
      return d.toDateString() === dayKey && d.getHours() >= 10 && d.getHours() < 16 && d.getTime() >= ts && f.cloud_coverage != null;
    });
    if (hours.length < 3) return '';
    const sunny = hours.filter((f) => f.cloud_coverage <= 40);
    if (sunny.length < 3) return '';
    // Rough spare solar: the best recent solar day, scaled by forecast cloud, less daytime house use
    const d = HD.data.daily; const pvId = C().energy.totals.pv; const loadId = C().energy.totals.load;
    const pvDays = (d && d.series[pvId] || []).filter((v) => v != null).slice(-14);
    const loadDays = (d && d.series[loadId] || []).filter((v) => v != null).slice(-14);
    if (!pvDays.length) return '';
    const best = Math.max(...pvDays);
    const cloud = sunny.reduce((a, f) => a + f.cloud_coverage, 0) / sunny.length;
    const share = sunny.length / 6;
    const daytimeUse = loadDays.length ? (loadDays.reduce((a, v) => a + v, 0) / loadDays.length) * 0.25 * share : 0;
    const spare = best * share * (1 - 0.75 * cloud / 100) * 0.8 - daytimeUse;
    if (spare < 3) return '';
    const pack = C().ev.batteryKwh || 60;
    const gain = Math.round(((spare * CHARGE_EFF) / pack) * 100);
    const from = new Date(sunny[0].datetime).getHours(); const to = new Date(sunny[sunny.length - 1].datetime).getHours() + 1;
    const t = HD.tariff.tariffAt(ts);
    const when = day.toDateString() === new Date(ts).toDateString() ? 'Today' : 'Tomorrow';
    return `<div class="solar-hint">${icon('sun')}<div><strong>${when}: roughly ${kwh(spare, 0)} of spare solar ${hh(from)}–${hh(to)}</strong>
      <span>Enough for about +${gain}%. ${t.export > t.offPeak ? `Selling it earns ${pence(t.export)}/kWh, more than the ${pence(t.offPeak)} cheap rate, so it's only worth it if you need the charge before tonight.` : `That's cheaper than the ${pence(t.offPeak)} cheap rate.`}</span></div></div>`;
  }

  // ── Recent charging: sessions from the Wall Connector's hourly energy ──
  let history = null; let historyAt = 0;
  async function loadHistory() {
    if (Date.now() - historyAt < 5 * 60e3) return;
    historyAt = Date.now();
    const id = C().energy.totals.ev; const ts = nowTs();
    const start = ts - 35 * 864e5;
    const month0 = new Date(ts); month0.setDate(1); month0.setHours(0, 0, 0, 0);
    try {
      const odo = pick('odometer');
      const [h, o] = await Promise.all([
        HD.ha.stats([id], start, ts, 'hour', ['change']),
        odo ? HD.ha.stats([odo.id], month0.getTime() - 864e5, ts, 'day', ['state', 'max']).catch(() => ({})) : Promise.resolve({}),
      ]);
      const rows = (h[id] || []).filter((r) => (r.change || 0) > 0.05);
      // Group hours into sessions: a gap of more than 2 h starts a new one
      const sessions = [];
      rows.forEach((r) => {
        const last = sessions[sessions.length - 1];
        const rate = HD.tariff.importRate(r.start + 1);
        if (last && r.start - last.end <= 2 * 3600e3) { last.end = r.start + 3600e3; last.kwh += r.change; last.cost += r.change * rate; if (rate > last.maxRate) last.maxRate = rate; }
        else sessions.push({ start: r.start, end: r.start + 3600e3, kwh: r.change, cost: r.change * rate, maxRate: rate });
      });
      const month = sessions.filter((x) => x.start >= month0.getTime());
      const oRows = (odo && o[odo.id]) || [];
      const ov = oRows.map((r) => r.state ?? r.max).filter((v) => v != null);
      const days = oRows.length;
      const miles = ov.length > 1 ? toMiles(ov[ov.length - 1] - ov[0], unit('odometer')) : null;
      history = {
        sessions: sessions.slice(-5).reverse(),
        month: { kwh: month.reduce((a, x) => a + x.kwh, 0), cost: month.reduce((a, x) => a + x.cost, 0), miles: days >= 7 ? miles : null, odoDays: days },
      };
    } catch (e) { console.warn('Charging history unavailable', e); }
  }

  function historyHtml() {
    if (!history) return '<h3 class="sub-head">Recent charging</h3><p class="sub">Loading…</p>';
    const t = HD.tariff.tariffAt(nowTs());
    const m = history.month;
    const monthName = HD.u.fmt(nowTs(), { month: 'long' });
    const ppm = m.miles ? (m.cost * 100) / m.miles : null;
    const list = history.sessions.length ? `<ul class="sessions">${history.sessions.map((x) => `<li>
        <span>${HD.u.fmt(x.start, { weekday: 'short', day: 'numeric', month: 'short' })}<small>${clock(x.start)}–${clock(x.end)}</small></span>
        <span class="tag ${x.maxRate > t.offPeak + 0.001 ? 'peak' : 'cheap'}">${x.maxRate > t.offPeak + 0.001 ? 'Some peak' : 'Cheap'}</span>
        <b>${kwh(x.kwh, 1)}</b><b>${gbp(x.cost)}</b></li>`).join('')}</ul>` : '<p class="sub">No charging in the last 5 weeks.</p>';
    return `<h3 class="sub-head">Recent charging</h3>
      <dl class="kv plan-kv month-kv">
        <div><dt>${monthName} so far</dt><dd>${kwh(m.kwh, 0)}</dd></div>
        <div><dt>Cost</dt><dd>${gbp(m.cost)}</dd></div>
        <div><dt>Per mile</dt><dd>${ppm != null ? `${ppm.toFixed(1)}p` : '–'}<small>${ppm != null ? ` over ${Math.round(m.miles)} mi` : m.odoDays ? ' needs a week of mileage' : ''}</small></dd></div>
      </dl>
      ${list}
      <p class="sub">Costs use the tariff rate for each hour, as if it all came from the grid.</p>`;
  }

  // ── Charging totals: lifetime and each calendar year, with an estimated cost ──
  // Rates come from the Energy Tracker's tariff history (every period Nan has entered, with
  // its own band times and VAT), so each hour is priced at what was actually being charged
  // then; hours the tracker can't price (no tracker, a dynamic tariff) use the dashboard's
  // own tariffs. The Wall Connector's lifetime counter (config.ev.lifetime) goes back
  // before Home Assistant recorded it, so it's split in two: the hours Home Assistant has,
  // priced hour by hour, and the part from before, priced at the cheap rate of the time —
  // spread day by day from config.ev.chargerSince ('YYYY-MM-DD', when the charger went in)
  // when that's set, otherwise at the cheap rate just before recording began.
  // config.ev.chargedIn ({ 'YYYY-MM': kWh }, e.g. a month's total from the Tesla app) moves
  // the unrecorded part of that month out of "before records" into its own year: the month's
  // total minus what Home Assistant recorded in it, priced at the cheap rate of those days.
  let totals = null; let totalsAt = 0;
  async function loadTotals() {
    if (totals && Date.now() - totalsAt < 3 * 3600e3) return;
    const ev = C().ev; const id = ev.lifetime || C().energy.totals.ev;
    if (!id) return;
    totalsAt = Date.now();
    const ts = nowTs();
    try {
      const [res, periods] = await Promise.all([
        HD.ha.stats([id], Date.UTC(2015, 0, 1), ts, 'hour', ['change', 'state']),
        HD.tracker && HD.tracker.tariffs ? HD.tracker.tariffs().catch(() => null) : null,
      ]);
      const tr = periods ? HD.tracker.rates(periods) : null;
      let fromTracker = 0; let fromDash = 0;
      const rateAt = (when) => { const r = tr && tr.rate(when); if (r != null) { fromTracker++; return r; } fromDash++; return HD.tariff.importRate(when); };
      const cheapAt = (when) => { const c = tr && tr.isCheap(when); return c != null ? c : HD.tariff.isOffPeak(when); };
      const rows = res[id] || [];
      const years = new Map(); const months = new Map();
      const add = (when, kwh, rate) => {
        const d = new Date(when); const y = d.getFullYear();
        const o = years.get(y) || { year: y, kwh: 0, cost: 0, cheapKwh: 0, added: 0 };
        o.kwh += kwh; o.cost += kwh * rate; if (cheapAt(when)) o.cheapKwh += kwh;
        years.set(y, o);
        const mk = `${y}-${String(d.getMonth() + 1).padStart(2, '0')}`; months.set(mk, (months.get(mk) || 0) + kwh);
      };
      rows.forEach((r) => { const v = Math.max(0, r.change || 0); if (v > 0) add(r.start, v, rateAt(r.start)); });
      const first = rows[0]; const last = rows[rows.length - 1];
      const live = HD.u.stateKwh(id);
      // Since the last finished hour (the live counter is ahead of the statistics)
      const lastState = last && last.state != null ? last.state : null;
      if (live != null && lastState != null && live - lastState > 0.01 && live - lastState < 50) add(ts, live - lastState, rateAt(ts));
      // Before Home Assistant: the counter's reading when recording began
      const recorded = [...years.values()].reduce((a, y) => a + y.kwh, 0);
      let before = first && first.state != null ? Math.max(0, first.state - Math.max(0, first.change || 0))
        : live != null ? Math.max(0, live - recorded) : 0;
      const recStart = first ? first.start : ts;
      const cheapRateAt = (when) => (tr && tr.cheapest(when) != null ? tr.cheapest(when) : HD.tariff.tariffAt(when).offPeak);
      let beforeCost = 0; let beforeHow = 'last';
      const since = ev.chargerSince ? Date.parse(`${ev.chargerSince}T00:00:00`) : NaN;
      // Months whose totals are known (ev.chargedIn): their unrecorded part leaves "before"
      let beforeEnd = recStart; let addedKwh = 0;
      Object.entries(ev.chargedIn || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).forEach(([key, total]) => {
        const m = /^(\d{4})-(\d{1,2})$/.exec(String(key).trim()); const k = Number(total);
        if (!m || !(k > 0) || before <= 0) return;
        const y = +m[1]; const mo = +m[2] - 1;
        const mStart = new Date(y, mo, 1).getTime(); const mEnd = new Date(y, mo + 1, 1).getTime();
        if (mStart >= recStart) return;  // fully recorded already
        const ym = `${y}-${String(mo + 1).padStart(2, '0')}`;
        const take = Math.min(before, Math.max(0, k - (months.get(ym) || 0)));
        if (take <= 0) return;
        const from = Number.isFinite(since) ? Math.max(mStart, since) : mStart; const to = Math.min(mEnd, recStart);
        const days = Math.max(1, Math.round((to - from) / 864e5));
        let cost = 0;
        for (let d = 0; d < days; d++) cost += (take / days) * cheapRateAt(Math.min(to - 1, from + d * 864e5 + 12 * 3600e3));
        const o = years.get(y) || { year: y, kwh: 0, cost: 0, cheapKwh: 0, added: 0 };
        o.kwh += take; o.cost += cost; o.cheapKwh += take; o.added += take; years.set(y, o);
        before -= take; addedKwh += take; beforeEnd = Math.min(beforeEnd, from);
      });
      if (before > 0 && Number.isFinite(since) && since < beforeEnd) {
        // Spread evenly over the days between installation and the first recorded hour
        const days = Math.max(1, Math.round((beforeEnd - since) / 864e5));
        for (let d = 0; d < days; d++) beforeCost += (before / days) * cheapRateAt(since + d * 864e5 + 12 * 3600e3);
        beforeHow = 'spread';
      } else beforeCost = before * cheapRateAt(beforeEnd - 864e5);
      totals = {
        since: first ? first.start : null,
        years: [...years.values()].sort((a, b) => b.year - a.year),
        recorded, before, beforeCost, addedKwh, beforeHow, beforeRate: before > 0 ? beforeCost / before : null,
        chargerSince: Number.isFinite(since) ? since : null,
        source: fromTracker && !fromDash ? 'tracker' : fromTracker ? 'mixed' : 'dashboard',
        lifetime: live != null ? live : recorded + before,
      };
      totals.lifetimeCost = totals.years.reduce((a, y) => a + y.cost, 0) + totals.beforeCost;
    } catch (e) { console.warn('Charging totals unavailable', e); totalsAt = 0; }
  }

  function totalsHtml() {
    if (!totals) return '<p class="sub">Loading…</p>';
    const t = totals;
    const thisYear = new Date(nowTs()).getFullYear();
    const cur = t.years.find((y) => y.year === thisYear) || { kwh: 0, cost: 0, cheapKwh: 0 };
    const ppk = (o) => (o.kwh > 0 ? `${((o.cost / o.kwh) * 100).toFixed(1)}p` : '–');
    const since = t.since ? HD.u.fmt(t.since, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const rows = t.years.map((y) => `<tr${y.added ? ' title="Includes charging from before Home Assistant recorded it (ev.chargedIn)"' : ''}><td>${y.year}${y.year === thisYear ? ' <small>so far</small>' : ''}</td><td>${kwh(y.kwh, 0)}</td>
      <td>${y.added ? '≈ ' : ''}${gbp(y.cost)}</td><td>${ppk(y)}</td><td>${y.kwh > 0 ? `${Math.round((y.cheapKwh / y.kwh) * 100)}%` : '–'}</td></tr>`).join('');
    const beforeRow = t.before > 1 ? `<tr class="est"><td>Before ${since || 'records'}</td><td>${kwh(t.before, 0)}</td><td>≈ ${gbp(t.beforeCost)}</td><td>${ppk({ kwh: t.before, cost: t.beforeCost })}</td><td>–</td></tr>` : '';
    return `<div class="totals">
      <dl class="kv plan-kv totals-kv">
        <div><dt>Lifetime</dt><dd>${kwh(t.lifetime, 0)}</dd></div>
        <div><dt>Lifetime cost</dt><dd>${t.before > 1 || t.addedKwh > 0.5 ? '≈ ' : ''}${gbp(t.lifetimeCost, 0)}</dd></div>
        <div><dt>${thisYear} so far</dt><dd>${kwh(cur.kwh, 0)}</dd></div>
        <div><dt>${thisYear} cost</dt><dd>${cur.added ? '≈ ' : ''}${gbp(cur.cost, 0)}</dd></div>
      </dl>
      <table class="years-table"><thead><tr><th>Year</th><th>Charged</th><th>Cost</th><th>Per kWh</th><th>Cheap rate</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5">No charging recorded yet.</td></tr>'}${beforeRow}</tbody></table>
    </div>
    <p class="sub">${{
      tracker: "Each hour is priced at the rate in force then, from the Energy Tracker's tariff history (VAT included)",
      mixed: "Each hour is priced at the rate in force then, from the Energy Tracker's tariff history (VAT included), and the dashboard's own tariff where the tracker has none",
      dashboard: "Each hour is priced at the dashboard's tariff for that hour",
    }[t.source]}, as if it all came from the grid.${t.before > 1 ? ` The ${kwh(t.before, 0)} the charger counted before Home Assistant started recording (${since}) is estimated at ${t.beforeHow === 'spread'
      ? `the cheap rate of each day since the charger went in (${HD.u.fmt(t.chargerSince, { month: 'short', year: 'numeric' })}), averaging ${pence(t.beforeRate)}/kWh`
      : `the cheap rate just before then, ${pence(t.beforeRate)}/kWh. Set ev.chargerSince to when the charger went in to spread it over the rates of the time`}.` : ''}${t.addedKwh > 0.5 ? ` ${kwh(t.addedKwh, 0)} from before ${since} is counted in its own year from the monthly totals in ev.chargedIn, at the cheap rate of those days.` : ''}</p>`;
  }

  // ── Car state from two sources ──
  // config.ev.car.sources is a list of { name, ...logical key → entity }; the first
  // source whose entity exists and is available wins, key by key. With the local
  // Bluetooth bridge listed first, it's used whenever the car is in range, and Tesla
  // Fleet (cloud) fills in everything else — including when the car is away.
  const sources = () => ((C().ev && C().ev.car && C().ev.car.sources) || []);
  const usable = (id) => (id.startsWith('button.') ? S().get(id) && S().state(id) !== 'unavailable' : S().get(id) && S().available(id));
  // A source whose own awake/asleep entity reads unknown hasn't really heard from the car
  // (Tesla Fleet straight after a restart reports the boot and frunk as "open", for one), so
  // none of its readings count as live — buttons still work, they go via the cloud.
  const heard = (src) => { const s = src.awake || src.asleep; return !s || !S().get(s) || S().available(s); };
  function live(key) {
    for (const src of sources()) {
      const id = src[key]; if (!id) continue;
      if (!id.startsWith('button.') && !heard(src)) continue;
      // Buttons sit at 'unknown' until first pressed, which still means usable
      if (usable(id)) return { id, src: src.name };
    }
    return null;
  }

  // ── Last known values ──
  // When the Bluetooth bridge is out of range/offline and Tesla Fleet has nothing (the car
  // has been asleep since Home Assistant restarted, so Fleet won't wake it to ask), every
  // entity reads unknown. Rather than the car vanishing, show the last good reading of each
  // from the recorder, marked as old.
  let lastKnown = {}; let lastKnownAt = 0; let lastKnownBusy = false;
  async function loadLastKnown() {
    if (lastKnownBusy || S().mode === 'demo' || Date.now() - lastKnownAt < 10 * 60e3) return;
    const ids = [...new Set(sources().flatMap((src) => Object.entries(src).filter(([k, v]) => k !== 'name' && typeof v === 'string' && !v.startsWith('button.')).map(([, v]) => v)))]
      .filter((id) => S().get(id));
    if (!ids.length) return;
    lastKnownBusy = true;
    try {
      const r = await HD.ha.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - 7 * 864e5).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true, significant_changes_only: false });
      const t = (row) => ((row.lu || row.lc) * 1000) || Date.parse(row.last_updated || row.last_changed);
      const good = (row) => { const st = row.s ?? row.state; return st != null && st !== 'unknown' && st !== 'unavailable'; };
      // Readings after a source lost touch with the car (its awake/asleep entity went unknown)
      // are not trusted, so each source's values stop at that moment
      const cutoff = (src) => {
        const rows = (r || {})[src.awake || src.asleep] || [];
        for (let i = rows.length - 1; i >= 0; i--) if (good(rows[i])) return i + 1 < rows.length ? t(rows[i + 1]) : Infinity;
        return Infinity;
      };
      const out = {};
      sources().forEach((src) => {
        const until = cutoff(src);
        Object.entries(src).forEach(([k, id]) => {
          if (k === 'name' || typeof id !== 'string') return;
          const rows = (r || {})[id] || [];
          for (let i = rows.length - 1; i >= 0; i--) {
            if (good(rows[i]) && t(rows[i]) < until) { out[id] = { state: String(rows[i].s ?? rows[i].state), at: t(rows[i]) }; break; }
          }
        });
      });
      lastKnown = out; lastKnownAt = Date.now();
      if (HD.views.car && document.getElementById('car-card')) HD.views.car.update();
    } catch (e) { console.warn('Last known car values unavailable', e); } finally { lastKnownBusy = false; }
  }

  // Live value from the first source that has one, else the newest last-known value
  function pick(key) {
    const l = live(key); if (l) return l;
    let best = null;
    for (const src of sources()) {
      const id = src[key]; const k = id && lastKnown[id];
      if (k && (!best || k.at > best.at)) best = { id, src: src.name, stale: true, state: k.state, at: k.at };
    }
    return best;
  }
  const val = (key) => { const p = pick(key); return p ? (p.stale ? p.state : S().state(p.id)) : null; };
  const num = (key) => { const p = pick(key); if (!p) return null; if (!p.stale) return S().num(p.id); const v = parseFloat(p.state); return Number.isFinite(v) ? v : null; };
  const unit = (key) => { const p = pick(key); return p ? S().attr(p.id, 'unit_of_measurement') : null; };
  // A wake button: config `wake`, else the integration's usual name next to the flash button
  function wakeId() {
    for (const src of sources()) {
      const cands = [src.wake, src.flash && src.flash.replace(/flash_lights$/, 'wake'), src.flash && src.flash.replace(/flash_lights$/, 'wake_up')].filter(Boolean);
      const id = cands.find((c) => usable(c)); if (id) return { id, src: src.name };
    }
    return null;
  }
  // ── Software updates ──
  // Tesla Fleet's update entity is the obvious source, but Home Assistant 2026.10 leaves it "off"
  // once the car has scheduled an update (seen 23 Oct: 2026.38.3.2 downloaded and scheduled for
  // 02:29, entity said nothing), and it only offers Install while an update is "available", not
  // once it's scheduled. The integration's diagnostics carry Tesla's raw software_update fields,
  // so those are read as well (admin only; at most every 10 min, while the car page is open).
  const PENDING = ['available', 'scheduled', 'downloading', 'downloading_wifi_wait', 'installing'];
  const updateCands = () => sources().flatMap((src) => [src.update, src.flash && src.flash.replace(/^button\.(.+)_flash_lights$/, 'update.$1_update')])
    .filter((c) => c && c.startsWith('update.'));
  const updateId = () => updateCands().find((c) => S().get(c)) || null;
  let sw = null; let swAt = 0; let swBusy = false;
  async function loadSoftware(force) {
    if (swBusy || S().mode === 'demo' || !HD.ha.isLive() || (!force && Date.now() - swAt < 10 * 60e3)) return;
    swBusy = true; swAt = Date.now();
    try {
      const entries = await HD.ha.callWS({ type: 'config_entries/get', domain: 'tesla_fleet' });
      for (const e of entries || []) {
        if (e.state !== 'loaded') continue;
        const d = await HD.ha.rest(`/api/diagnostics/config_entry/${e.entry_id}`);
        const v = ((d && d.data && d.data.vehicles) || []).map((x) => (x && x.data) || {}).find((x) => 'vehicle_state_software_update_status' in x);
        if (!v) continue;
        const k = (n) => v[`vehicle_state_software_update_${n}`];
        sw = { status: k('status') || '', version: String(k('version') || '').split(' ')[0], scheduledAt: k('scheduled_time_ms') || null,
          download: k('download_perc'), install: k('install_perc'), duration: k('expected_duration_sec'), at: v.vehicle_state_timestamp || Date.now() };
        break;
      }
      if (HD.views.car && document.getElementById('car-card')) HD.views.car.update();
    } catch (e) { console.warn('Car software status unavailable', e); } finally { swBusy = false; }
  }
  // What the car is doing about software: the entity first, the raw Tesla fields when they know more
  function software() {
    const id = updateId(); const st = id ? S().get(id) : null; const a = (st && st.attributes) || {};
    const installed = a.installed_version || null;
    const out = { id, installed, status: '', version: null, at: null, pct: null, duration: null,
      canInstall: !!(st && st.state === 'on' && (a.supported_features & 1)) };
    if (st && st.state === 'on') { out.status = a.in_progress ? 'installing' : 'available'; out.version = a.latest_version; out.pct = a.update_percentage ?? null; }
    if (sw && PENDING.includes(sw.status) && sw.version && sw.version !== installed) {
      out.status = sw.status; out.version = sw.version; out.duration = sw.duration || null;
      out.at = sw.status === 'scheduled' ? sw.scheduledAt : null;
      out.pct = sw.status === 'installing' ? sw.install ?? out.pct : /^downloading/.test(sw.status) ? sw.download ?? null : null;
    }
    return out;
  }
  const whenText = (ms) => {
    const d = new Date(ms); const day = (x) => new Date(x).toDateString();
    const tag = day(d) === day(Date.now()) ? '' : day(d) === day(Date.now() + 864e5) ? ' tomorrow' : ` ${HD.u.fmt(d, { weekday: 'short', day: 'numeric', month: 'short' })}`;
    return `${HD.u.time(d)}${tag}`;
  };
  function softwareChip(u) {
    if (!u.status) return u.installed ? `<span class="car-chip">${icon('update')}${esc(u.installed)}</span>` : '';
    // Kept short so the chip stays on one line; the version is in the box under the controls
    const text = u.status === 'scheduled' ? (u.at ? `Update at ${HD.u.time(new Date(u.at))}` : 'Update scheduled')
      : u.status === 'installing' ? `Installing${u.pct != null ? ` ${u.pct}%` : ''}`
      : u.status === 'downloading' ? `Downloading${u.pct != null ? ` ${u.pct}%` : ''}`
      : u.status === 'downloading_wifi_wait' ? 'Update needs Wi-Fi' : 'Update ready';
    return chip(false, 'update', text);
  }
  function softwareHtml(u) {
    if (!u.status) return '';
    const mins = u.duration ? `about ${Math.round(u.duration / 60)} min` : 'a while';
    const elsewhere = 'use the car’s screen or the Tesla app';
    const say = {
      available: u.canInstall ? `Downloaded and ready. Installing takes ${mins}, and the car can’t be driven until it finishes.`
        : `Downloaded and ready. Home Assistant isn’t allowed to start it (Tesla Fleet needs vehicle command access), so ${elsewhere}.`,
      scheduled: `The car has scheduled it for ${u.at ? whenText(u.at) : 'later'} and will install it then (${mins}). Home Assistant can’t bring a scheduled update forward; to install it now, ${elsewhere}.`,
      downloading: `Downloading${u.pct != null ? ` (${u.pct}%)` : ''}. It can be installed once the download finishes.`,
      downloading_wifi_wait: 'Waiting for Wi-Fi to download it.',
      installing: `Installing${u.pct != null ? ` (${u.pct}%)` : ''}. The car can’t be driven until it finishes.`,
    }[u.status] || '';
    const ask = `Install ${u.version || 'the update'} now? The car can’t be driven for ${mins}.`;
    return `<div class="car-sw">${icon('update')}<p><b>Software ${esc(u.version || 'update')}</b>${u.installed ? ` <small>(now ${esc(u.installed)})</small>` : ''}<br>${esc(say)}</p>
      ${u.canInstall && u.status === 'available' ? `<button class="car-btn" data-car="install" data-entity="${u.id}" data-ask="${esc(ask)}">${icon('update')}<span>Install now</span></button>` : ''}</div>`;
  }

  const toMiles = (v, u) => (v == null ? null : /mi/i.test(u || '') ? v : v * 0.621371);
  const toPsi = (v, u) => (v == null ? null : /psi/i.test(u || '') ? v : /kpa/i.test(u || '') ? v * 0.145038 : v * 14.5038);

  // Distance in miles between two lat/longs
  function miles(a, b) {
    const R = 3958.8; const r = (d) => (d * Math.PI) / 180;
    const dLat = r(b[0] - a[0]); const dLon = r(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function whereText() {
    // The Bluetooth bridge only reaches the car on the driveway, so if it's the source the car is home
    const viaBle = pick('soc') && /bluetooth/i.test(pick('soc').src || '');
    if (viaBle) return 'At home';
    const t = pick('location');
    if (t) {
      const st = S().state(t.id);
      if (st === 'home') return 'At home';
      if (st && st !== 'not_home' && st !== 'unknown') return `At ${HD.u.cap(st.replace(/_/g, ' '))}`;
      const lat = S().attr(t.id, 'latitude'); const lon = S().attr(t.id, 'longitude');
      const z = S().get('zone.home');
      if (lat != null && z && z.attributes.latitude != null) {
        const d = miles([z.attributes.latitude, z.attributes.longitude], [lat, lon]);
        if (d < 0.1) return 'At home';
        return `${d < 10 ? d.toFixed(1) : Math.round(d)} mi from home`;
      }
    }
    return 'Location unknown';
  }

  // Top-down crossover, nose up — an original drawing, not any maker's design.
  // It shows what the car is doing: charging (port glows, energy flows down the cable),
  // plugged in, doors/frunk/boot/windows open, climate running, sentry on, asleep,
  // lights flashing and low tyres. Tyre pressures sit beside each wheel.
  let flashUntil = 0;
  function carSvg(tyres, target, st) {
    const low = (v) => v != null && v < target - 3;
    const lab = (v, x, y, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="tp ${low(v) ? 'low' : ''}">${v == null ? '–' : Math.round(v)}<tspan class="u"> psi</tspan></text>`;
    const wheel = (x, y, v) => `<rect class="wheel ${low(v) ? 'low' : ''}" x="${x}" y="${y}" width="16" height="46" rx="6"/>`;
    // Doors hinge at their front edge and swing out
    const door = (side, y0, y1, open) => {
      const x = side === 'l' ? 97 : 203;
      if (!open) return `<path class="seam" d="M${x} ${y1}h${side === 'l' ? 7 : -7}"/>`;
      return `<g class="door-open" transform="rotate(${side === 'l' ? 38 : -38} ${x} ${y0})"><rect x="${side === 'l' ? x - 6 : x}" y="${y0}" width="6" height="${y1 - y0}" rx="3"/></g>`;
    };
    const cls = [
      st.asleep ? 'asleep' : '', st.charging ? 'charging' : '', st.plugged ? 'plugged' : '',
      st.climate ? 'climate' : '', st.sentry ? 'sentry' : '', Date.now() < flashUntil ? 'flashing' : '',
    ].filter(Boolean).join(' ');
    return `<svg class="car-top ${cls}" style="--paint:${esc(C().ev.colour || '#5f7fa8')}" viewBox="0 0 300 340" role="img" aria-label="The car from above: ${esc(st.summary)}">
      <defs>
        <linearGradient id="car-paint" x1="0" x2="1"><stop offset="0" class="paint-a"/><stop offset=".5" class="paint-b"/><stop offset="1" class="paint-a"/></linearGradient>
        <radialGradient id="car-glow"><stop offset="0" class="glow-a"/><stop offset="1" class="glow-b"/></radialGradient>
      </defs>
      <ellipse class="shadow" cx="150" cy="172" rx="70" ry="160"/>
      ${st.plugged ? '<path class="cable" d="M96 268 C 60 274 46 300 22 334"/><path class="cable-flow" d="M22 334 C 46 300 60 274 96 268"/>' : ''}
      ${wheel(86, 66, tyres[0])}${wheel(198, 66, tyres[1])}${wheel(86, 228, tyres[2])}${wheel(198, 228, tyres[3])}
      <g class="beams"><path d="M110 30 L84 -20 L136 -20 Z"/><path d="M190 30 L164 -20 L216 -20 Z"/></g>
      <path class="body" d="M150 22 C181 22 197 30 199 50 L203 104 L203 250 L200 292 C198 310 182 318 150 318 C118 318 102 310 100 292 L97 250 L97 104 L101 50 C103 30 119 22 150 22 Z"/>
      <ellipse class="mirror" cx="91" cy="114" rx="7" ry="4"/><ellipse class="mirror" cx="209" cy="114" rx="7" ry="4"/>
      <path class="hood ${st.frunk ? 'open' : ''}" d="M106 52 C120 34 180 34 194 52 L191 92 C172 85 128 85 109 92 Z"/>
      <path class="lamp head" d="M108 44 Q118 31 136 28"/><path class="lamp head" d="M192 44 Q182 31 164 28"/>
      <path class="glass screen" d="M110 100 C130 90 170 90 190 100 L184 134 C166 128 134 128 116 134 Z"/>
      <path class="glass sunroof" d="M116 138 C134 132 166 132 184 138 L186 234 C166 240 134 240 114 234 Z"/>
      <path class="roof-bar" d="M115 186 H185"/>
      <path class="glass rear" d="M114 240 C134 246 166 246 186 240 L182 268 C166 274 134 274 118 268 Z"/>
      <path class="win ${st.windows ? 'open' : ''}" d="M103 110 L110 106 L110 232 L102 228 Z"/><path class="win ${st.windows ? 'open' : ''}" d="M197 110 L190 106 L190 232 L198 228 Z"/>
      <path class="boot ${st.trunk ? 'open' : ''}" d="M112 278 C134 284 166 284 188 278 L197 292 C192 310 108 310 103 292 Z"/>
      <path class="lamp tail" d="M108 302 Q150 316 192 302"/>
      ${door('l', 106, 168, st.doors[0])}${door('r', 106, 168, st.doors[1])}${door('l', 170, 232, st.doors[2])}${door('r', 170, 232, st.doors[3])}
      <g class="air"><circle cx="150" cy="186" r="14"/><circle cx="150" cy="186" r="14"/><circle cx="150" cy="186" r="14"/></g>
      <circle class="sentry-eye" cx="150" cy="104" r="4"/>
      <circle class="port" cx="99" cy="268" r="5"/>
      ${st.charging ? '<circle class="port-glow" cx="99" cy="268" r="16" fill="url(#car-glow)"/>' : ''}
      ${st.asleep ? '<text class="zz" x="214" y="40">z<tspan dx="2" dy="-8">z</tspan></text>' : ''}
      ${lab(tyres[0], 82, 92, 'end')}${lab(tyres[1], 218, 92, 'start')}${lab(tyres[2], 82, 254, 'end')}${lab(tyres[3], 218, 254, 'start')}
    </svg>`;
  }


  const chip = (on, ic, text, cls = '') => `<span class="car-chip ${on ? 'ok' : 'warn'} ${cls}">${icon(ic)}${esc(text)}</span>`;

  function carHtml() {
    const ev = C().ev;
    const soc = num('soc');
    const range = toMiles(num('range'), unit('range'));
    const limit = num('limit');
    const awake = val('awake'); const asleep = val('asleep');
    const isAsleep = asleep != null ? asleep === 'on' : awake != null ? awake !== 'on' : null;
    const wcPower = S().num(ev.power) || 0;
    const chargingState = val('charging');
    const carPower = num('chargerPower');
    const plugged = S().state(ev.connected) === 'on' || val('cable') === 'on' || (chargingState && !['disconnected', 'unknown'].includes(chargingState));
    const power = Math.max(wcPower, carPower || 0);
    const statusText = power > 0.1 ? `Charging at ${kw(power)}` : chargingState === 'complete' ? 'Charge complete' : plugged ? 'Plugged in, not charging' : 'Not plugged in';
    const tp = ['tpmsFl', 'tpmsFr', 'tpmsRl', 'tpmsRr'].map((k) => toPsi(num(k), unit(k)));
    const target = ev.tyreTarget || 42;
    const lowTyres = tp.filter((v) => v != null && v < target - 3).length;
    const locked = val('locked'); const sentry = val('sentry'); const windows = val('windows');
    const doorKeys = ['doorFl', 'doorFr', 'doorRl', 'doorRr', 'frunk', 'trunk'];
    const anyDoor = doorKeys.some((k) => { const v = val(k); return v === 'on' || v === 'open'; });
    const doorsKnown = doorKeys.some((k) => val(k) != null);
    const climate = val('climate'); const inside = num('insideTemp'); const outside = num('outsideTemp');
    const swu = software(); loadSoftware();
    const odo = toMiles(num('odometer'), unit('odometer'));
    const via = pick('soc');
    const stale = !!(via && via.stale);
    if (!via || stale) loadLastKnown();
    const updated = via ? (stale ? new Date(via.at).toISOString() : S().get(via.id).last_updated) : null;
    const any = !!via;
    const bleSrc = sources().find((src) => /bluetooth/i.test(src.name || ''));
    const bleDown = bleSrc && bleSrc.soc && !S().available(bleSrc.soc);
    const wake = wakeId();

    const chips = [
      locked != null ? chip(locked === 'locked', locked === 'locked' ? 'lock' : 'unlock', locked === 'locked' ? 'Locked' : 'Unlocked') : '',
      sentry != null ? `<span class="car-chip ${sentry === 'on' ? 'ok' : ''}">${icon('eye')}Sentry ${sentry === 'on' ? 'on' : 'off'}</span>` : '',
      doorsKnown ? chip(!anyDoor, 'door', anyDoor ? 'A door is open' : 'Doors shut') : '',
      windows != null ? chip(windows === 'closed', 'window', windows === 'closed' ? 'Windows up' : 'Windows open') : '',
      climate != null ? `<span class="car-chip ${climate !== 'off' ? 'ok' : ''}">${icon('fan')}Climate ${climate === 'off' ? 'off' : 'on'}</span>` : '',
      lowTyres ? chip(false, 'alert', `${lowTyres} tyre${lowTyres > 1 ? 's' : ''} low`) : '',
      softwareChip(swu),
    ].join('');

    const btn = (key, label, ic, action, extra = '') => {
      const p = pick(key); if (!p) return '';
      return `<button class="car-btn" data-car="${action}" data-entity="${p.id}" ${extra}>${icon(ic)}<span>${label}</span></button>`;
    };
    const controls = [
      btn('locked', locked === 'locked' ? 'Unlock' : 'Lock', locked === 'locked' ? 'unlock' : 'lock', locked === 'locked' ? 'unlock' : 'lock'),
      btn('climate', climate && climate !== 'off' ? 'Climate off' : 'Climate on', 'fan', 'climate'),
      btn('frunk', 'Frunk', 'box', 'open-frunk'),
      btn('trunk', val('trunk') === 'open' ? 'Close boot' : 'Open boot', 'box', val('trunk') === 'open' ? 'close' : 'open'),
      btn('chargePort', val('chargePort') === 'open' ? 'Close port' : 'Charge port', 'plug', val('chargePort') === 'open' ? 'close' : 'open'),
      btn('flash', 'Flash', 'flash', 'press'),
    ].join('');

    return `
      <header class="car-head"><div><p class="eyebrow-label">${esc(ev.name || 'Car')}</p>
        <h2>${icon('pin')}${esc(whereText())}</h2></div>
        <span class="pill ${!stale && isAsleep === false ? 'ok' : ''}">${!any ? 'No data' : stale ? `Last seen ${esc(ago(updated))}` : isAsleep ? 'Asleep' : 'Awake'}</span></header>
      ${stale || !any ? `<p class="note car-stale">${icon('alert')}<span>No live data from the car${bleDown ? ': the Bluetooth bridge is offline' : ''}${bleDown ? ' and' : ':'} Tesla Fleet has had nothing since ${updated ? HD.u.time(updated) + (Date.now() - Date.parse(updated) > 12 * 3600e3 ? ` on ${HD.u.fmt(updated, { weekday: 'short', day: 'numeric', month: 'short' })}` : '') : 'Home Assistant restarted'} (it doesn't wake a sleeping car). ${any ? 'Showing the last known state.' : ''}</span>${wake ? `<button class="car-btn" data-car="wake" data-entity="${wake.id}">${icon('power')}<span>Wake car</span></button>` : ''}</p>` : ''}
      ${any ? `
        <div class="car-main">
          ${carSvg(tp, target, {
            asleep: isAsleep === true, charging: power > 0.1, plugged: !!plugged,
            climate: climate != null && climate !== 'off', sentry: sentry === 'on',
            frunk: val('frunk') === 'open', trunk: val('trunk') === 'open', windows: windows != null && windows !== 'closed',
            doors: ['doorFl', 'doorFr', 'doorRl', 'doorRr'].map((k) => val(k) === 'on'),
            summary: [statusText, anyDoor ? 'something is open' : '', climate && climate !== 'off' ? 'climate on' : ''].filter(Boolean).join(', '),
          })}
          <div class="car-side">
            <div class="car-soc"><p class="big">${pct(soc)}</p>${range != null ? `<p>${Math.round(range)} mi<small>estimated range</small></p>` : ''}</div>
            <div class="soc-bar car"><i style="width:${soc || 0}%"></i>${limit ? `<b style="left:${limit}%" title="Charge limit ${limit}%"></b>` : ''}</div>
            <p class="sub">${statusText}${limit ? ` · limit ${pct(limit)}` : ''}</p>
            <div class="car-chips">${chips}</div>
          </div>
        </div>
        ${stale ? '' : `<div class="car-controls">${controls}</div>`}
        ${softwareHtml(swu)}
        <p class="sub car-foot">${[odo != null ? `${Math.round(odo).toLocaleString('en-GB')} mi` : '', inside != null ? `${Math.round(inside)}° inside` : '', outside != null ? `${Math.round(outside)}° outside` : '', via ? `via ${via.src}${stale ? ' (last known)' : ''}` : '', updated ? `updated ${ago(updated)}` : ''].filter(Boolean).join(' · ')}</p>`
      : '<p class="note">No car data yet. Tesla Fleet or the Bluetooth bridge needs to be connected in Home Assistant.</p>'}
      <dl class="kv car-kv">
        <div><dt>Wall Connector</dt><dd>${esc(HD.u.cap((S().state(ev.status) || '').replace(/_/g, ' ')) || '–')}</dd></div>
        <div><dt>Grid voltage</dt><dd>${S().num(ev.voltage) != null ? `${Math.round(S().num(ev.voltage))} V` : '–'}</dd></div>
      </dl>`;
  }

  // Car buttons. Opening things and unlocking ask first; everything else just goes.
  const ASK = { unlock: 'Unlock the car?', 'open-frunk': 'Open the frunk?', open: 'Open it?' };
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-car]'); if (!b) return;
    const a = b.dataset.car; const id = b.dataset.entity; const domain = id.split('.')[0];
    if (ASK[a] && !window.confirm(a === 'open' ? `${b.textContent.trim()}?` : ASK[a])) return;
    if (a === 'install' && !window.confirm(b.dataset.ask || 'Install the update now?')) return;
    let call;
    if (a === 'lock' || a === 'unlock') call = ['lock', a];
    else if (a === 'climate') call = ['climate', S().state(id) === 'off' ? 'turn_on' : 'turn_off'];
    else if (a === 'open-frunk' || a === 'open') call = [domain, 'open_cover'];
    else if (a === 'close') call = [domain, 'close_cover'];
    else if (a === 'wake') { call = ['button', 'press']; lastKnownAt = 0; setTimeout(() => { lastKnownAt = 0; HD.views.car.update(); }, 60e3); }
    else if (a === 'install') { call = ['update', 'install']; setTimeout(() => loadSoftware(true), 90e3); }
    else if (a === 'press') { call = ['button', 'press']; flashUntil = Date.now() + 3200; HD.views.car.update(); setTimeout(() => HD.views.car.update(), 3300); }
    if (!call) return;
    b.disabled = true;
    HD.ha.callService(call[0], call[1], { entity_id: id })
      .then(() => HD.app.toast('Sent to the car. It can take a few seconds if it was asleep.'))
      .catch((e) => HD.app.toast(`The car didn't respond: ${e.message}`))
      .finally(() => { b.disabled = false; });
  });

  HD.car = { pick, val, num, soc: () => num('soc'), software, extraIds: updateCands };

  function drawHistory() {
    const d = HD.data.daily; const box = document.getElementById('chart-ev');
    if (!d || !box) return;
    const id = C().energy.totals.ev;
    const vals = d.series[id] || [];
    const cats = d.days.map((ts) => HD.u.fmt(ts, { day: 'numeric', month: 'short' }));
    const long = d.days.map((ts) => HD.u.fmt(ts, { weekday: 'short', day: 'numeric', month: 'short' }));
    const total = vals.reduce((a, v) => a + (v || 0), 0);
    const t = HD.tariff.tariffAt(nowTs());
    document.getElementById('ev-summary').innerHTML = `${kwh(total, 0)} over 30 days, about ${gbp(total * t.offPeak)} if all on the cheap rate (${gbp(total * t.peak)} at peak).`;
    HD.chart.bars(box, {
      label: 'Car charging per day', height: 200, categories: cats, tipLabels: long,
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(1)} kWh`),
      series: [{ name: 'Car charging', values: vals, color: 'var(--s-load)' }],
      tipExtra: (i) => `<div class="tip-note">≈ ${gbp((vals[i] || 0) * t.offPeak)} at ${pence(t.offPeak)}</div>`,
    });
  }

  HD.views.car = {
    title: 'Car',
    mount(root) {
      root.innerHTML = `
      <div class="panel-grid car">
        <section class="panel" id="car-card"></section>
        <section class="panel charge-panel"><header><h2>Charge now?</h2></header><div id="car-advice"></div>
          <div id="car-plan" class="charge-block"></div><div id="car-solar"></div><div id="car-history" class="charge-block"></div></section>
        <section class="panel wide"><header><h2>Charging, last 30 days</h2><p id="ev-summary"></p></header><div id="chart-ev" class="chart-box"></div></section>
        <section class="panel wide"><header><h2>Charging totals</h2><p>Lifetime and by year, from the Wall Connector</p></header><div id="car-totals"></div></section>
      </div>`;
      this.update(); this.redraw();
    },
    update() {
      const c = document.getElementById('car-card'); if (!c) return;
      HD.u.setHTML(c, carHtml());
      HD.u.setHTML(document.getElementById('car-advice'), adviceHtml());
      HD.u.setHTML(document.getElementById('car-plan'), planHtml());
      HD.u.setHTML(document.getElementById('car-solar'), solarHintHtml());
      HD.u.setHTML(document.getElementById('car-history'), historyHtml());
      HD.u.setHTML(document.getElementById('car-totals'), totalsHtml());
    },
    redraw() {
      drawHistory();
      Promise.all([loadHistory(), loadForecast(), loadTotals()]).then(() => this.update());
    },
  };
})();
