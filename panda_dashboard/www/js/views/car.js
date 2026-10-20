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
  const clock = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
    const ev = C().ev;
    if (!history) return '<h3 class="sub-head">Recent charging</h3><p class="sub">Loading…</p>';
    const t = HD.tariff.tariffAt(nowTs());
    const m = history.month;
    const monthName = new Date(nowTs()).toLocaleDateString('en-GB', { month: 'long' });
    const ppm = m.miles ? (m.cost * 100) / m.miles : null;
    const lifetime = S().num(ev.lifetime);
    const list = history.sessions.length ? `<ul class="sessions">${history.sessions.map((x) => `<li>
        <span>${new Date(x.start).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}<small>${clock(x.start)}–${clock(x.end)}</small></span>
        <span class="tag ${x.maxRate > t.offPeak + 0.001 ? 'peak' : 'cheap'}">${x.maxRate > t.offPeak + 0.001 ? 'Some peak' : 'Cheap'}</span>
        <b>${kwh(x.kwh, 1)}</b><b>${gbp(x.cost)}</b></li>`).join('')}</ul>` : '<p class="sub">No charging in the last 5 weeks.</p>';
    return `<h3 class="sub-head">Recent charging</h3>
      <dl class="kv plan-kv month-kv">
        <div><dt>${monthName} so far</dt><dd>${kwh(m.kwh, 0)}</dd></div>
        <div><dt>Cost</dt><dd>${gbp(m.cost)}</dd></div>
        <div><dt>Per mile</dt><dd>${ppm != null ? `${ppm.toFixed(1)}p` : '–'}<small>${ppm != null ? ` over ${Math.round(m.miles)} mi` : m.odoDays ? ' needs a week of mileage' : ''}</small></dd></div>
        <div><dt>Lifetime</dt><dd>${lifetime != null ? `${(lifetime / 1000).toFixed(2)} MWh` : '–'}</dd></div>
      </dl>
      ${list}
      <p class="sub">Costs use the tariff rate for each hour, as if it all came from the grid.</p>`;
  }

  // ── Car state from two sources ──
  // config.ev.car.sources is a list of { name, ...logical key → entity }; the first
  // source whose entity exists and is available wins, key by key. With the local
  // Bluetooth bridge listed first, it's used whenever the car is in range, and Tesla
  // Fleet (cloud) fills in everything else — including when the car is away.
  const sources = () => ((C().ev && C().ev.car && C().ev.car.sources) || []);
  function pick(key) {
    for (const src of sources()) {
      const id = src[key]; if (!id) continue;
      // Buttons sit at 'unknown' until first pressed, which still means usable
      const ok = id.startsWith('button.') ? S().get(id) && S().state(id) !== 'unavailable' : S().get(id) && S().available(id);
      if (ok) return { id, src: src.name };
    }
    return null;
  }
  const val = (key) => { const p = pick(key); return p ? S().state(p.id) : null; };
  const num = (key) => { const p = pick(key); return p ? S().num(p.id) : null; };
  const unit = (key) => { const p = pick(key); return p ? S().attr(p.id, 'unit_of_measurement') : null; };
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

  function carSvg(tyres, target) {
    // Top-down car, nose up. Tyre labels sit beside each wheel.
    const low = (v) => v != null && v < target - 3;
    const lab = (v, x, y, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="tp ${low(v) ? 'low' : ''}">${v == null ? '–' : Math.round(v)}<tspan class="u"> psi</tspan></text>`;
    return `<svg class="car-top" viewBox="0 0 300 300" role="img" aria-label="Tyre pressures">
      <rect class="wheel" x="92" y="58" width="14" height="44" rx="5"/><rect class="wheel" x="194" y="58" width="14" height="44" rx="5"/>
      <rect class="wheel" x="92" y="196" width="14" height="44" rx="5"/><rect class="wheel" x="194" y="196" width="14" height="44" rx="5"/>
      <path class="body" d="M150 18c30 0 44 10 46 34l6 60v86l-4 56c-2 18-18 28-48 28s-46-10-48-28l-4-56v-86l6-60c2-24 16-34 46-34z"/>
      <path class="glass" d="M114 98c10-8 62-8 72 0l6 34v70l-6 44c-10 8-62 8-72 0l-6-44v-70z"/>
      <path class="line" d="M122 104c8-4 48-4 56 0M118 240c10 4 54 4 64 0"/>
      ${lab(tyres[0], 90, 78, 'end')}${lab(tyres[1], 210, 78, 'start')}${lab(tyres[2], 90, 222, 'end')}${lab(tyres[3], 210, 222, 'start')}
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
    const upd = pick('update'); const updAvail = upd && S().state(upd.id) === 'on';
    const version = upd ? S().attr(upd.id, 'installed_version') : null;
    const odo = toMiles(num('odometer'), unit('odometer'));
    const via = pick('soc');
    const updated = via ? S().get(via.id).last_updated : null;
    const any = !!via;

    const chips = [
      locked != null ? chip(locked === 'locked', locked === 'locked' ? 'lock' : 'unlock', locked === 'locked' ? 'Locked' : 'Unlocked') : '',
      sentry != null ? `<span class="car-chip ${sentry === 'on' ? 'ok' : ''}">${icon('eye')}Sentry ${sentry === 'on' ? 'on' : 'off'}</span>` : '',
      doorsKnown ? chip(!anyDoor, 'door', anyDoor ? 'A door is open' : 'Doors shut') : '',
      windows != null ? chip(windows === 'closed', 'window', windows === 'closed' ? 'Windows up' : 'Windows open') : '',
      climate != null ? `<span class="car-chip ${climate !== 'off' ? 'ok' : ''}">${icon('fan')}Climate ${climate === 'off' ? 'off' : 'on'}</span>` : '',
      lowTyres ? chip(false, 'alert', `${lowTyres} tyre${lowTyres > 1 ? 's' : ''} low`) : '',
      updAvail ? chip(false, 'update', `Update ${S().attr(upd.id, 'latest_version') || 'available'}`) : version ? `<span class="car-chip">${icon('update')}${esc(version)}</span>` : '',
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
        <span class="pill ${isAsleep === false ? 'ok' : ''}">${!any ? 'Offline' : isAsleep ? 'Asleep' : 'Awake'}</span></header>
      ${any ? `
        <div class="car-main">
          ${carSvg(tp, target)}
          <div class="car-side">
            <div class="car-soc"><p class="big">${pct(soc)}</p>${range != null ? `<p>${Math.round(range)} mi<small>estimated range</small></p>` : ''}</div>
            <div class="soc-bar car"><i style="width:${soc || 0}%"></i>${limit ? `<b style="left:${limit}%" title="Charge limit ${limit}%"></b>` : ''}</div>
            <p class="sub">${statusText}${limit ? ` · limit ${pct(limit)}` : ''}</p>
            <div class="car-chips">${chips}</div>
          </div>
        </div>
        <div class="car-controls">${controls}</div>
        <p class="sub car-foot">${[odo != null ? `${Math.round(odo).toLocaleString('en-GB')} mi` : '', inside != null ? `${Math.round(inside)}° inside` : '', outside != null ? `${Math.round(outside)}° outside` : '', via ? `via ${via.src}` : '', updated ? `updated ${ago(updated)}` : ''].filter(Boolean).join(' · ')}</p>`
      : '<p class="note">No car data. Tesla Fleet or the Bluetooth bridge needs to be connected in Home Assistant.</p>'}
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
    let call;
    if (a === 'lock' || a === 'unlock') call = ['lock', a];
    else if (a === 'climate') call = ['climate', S().state(id) === 'off' ? 'turn_on' : 'turn_off'];
    else if (a === 'open-frunk' || a === 'open') call = [domain, 'open_cover'];
    else if (a === 'close') call = [domain, 'close_cover'];
    else if (a === 'press') call = ['button', 'press'];
    if (!call) return;
    b.disabled = true;
    HD.ha.callService(call[0], call[1], { entity_id: id })
      .then(() => HD.app.toast('Sent to the car. It can take a few seconds if it was asleep.'))
      .catch((e) => HD.app.toast(`The car didn't respond: ${e.message}`))
      .finally(() => { b.disabled = false; });
  });

  HD.car = { pick, val, num, soc: () => num('soc') };

  function drawHistory() {
    const d = HD.data.daily; const box = document.getElementById('chart-ev');
    if (!d || !box) return;
    const id = C().energy.totals.ev;
    const vals = d.series[id] || [];
    const cats = d.days.map((ts) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    const long = d.days.map((ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
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
    },
    redraw() {
      drawHistory();
      Promise.all([loadHistory(), loadForecast()]).then(() => this.update());
    },
  };
})();
