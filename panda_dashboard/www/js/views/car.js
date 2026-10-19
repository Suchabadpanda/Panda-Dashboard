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
      verdict = 'Charge on spare solar'; cls = 'good';
      detail = `Exporting ${kw(spare)} of solar — enough to charge at ${Math.min(amps, 32)} A for free instead of selling it at ${pence(t.export)}.`;
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
        <div><dt>Last session</dt><dd>${kwh(S().num(ev.session))}</dd></div>
        <div><dt>Lifetime</dt><dd>${S().num(ev.lifetime) != null ? `${(S().num(ev.lifetime) / 1000).toFixed(2)} MWh` : '–'}</dd></div>
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
        <section class="panel"><header><h2>Charge now?</h2></header><div id="car-advice"></div></section>
        <section class="panel wide"><header><h2>Charging, last 30 days</h2><p id="ev-summary"></p></header><div id="chart-ev" class="chart-box"></div></section>
      </div>`;
      this.update(); this.redraw();
    },
    update() {
      const c = document.getElementById('car-card'); if (!c) return;
      c.innerHTML = carHtml();
      document.getElementById('car-advice').innerHTML = adviceHtml();
    },
    redraw: drawHistory,
  };
})();
