/*
 * Car view: the car and Wall Connector, a "should I charge now?" gauge for the
 * time-of-use tariff and spare solar, and 30 days of charging.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, kw, kwh, gbp, pence, pct, dur, icon } = HD.u;
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

  function carHtml() {
    const ev = C().ev;
    const soc = S().num(ev.carSoc); const online = S().available(ev.carSoc);
    const range = S().num(ev.carRange);
    const limit = S().num(ev.chargeLimit);
    const power = S().num(ev.power) || 0;
    const status = S().state(ev.status) || '';
    const plugged = S().state(ev.connected) === 'on';
    const statusText = power > 0.1 ? `Charging at ${kw(power)}` : plugged ? 'Plugged in, not charging' : 'Not plugged in';
    const tp = ev.tpms || {};
    const tyres = ['fl', 'fr', 'rl', 'rr'].map((k) => S().num(tp[k]));
    const hasTyres = tyres.some((v) => v != null);
    const toFull = soc != null ? ((Math.max(0, (limit || 80) - soc) / 100) * (ev.batteryKwh || 60)) : null;
    return `
      <header class="car-head"><div><p class="eyebrow-label">${esc(ev.name || 'Car')}</p>
        <h2>${statusText}</h2></div>
        <span class="pill ${online ? 'ok' : ''}">${online ? 'Car online' : 'Car offline'}</span></header>
      ${online ? `
        <div class="car-soc"><p class="big">${pct(soc)}</p>${range != null ? `<p>${Math.round(range * 0.621)} mi range</p>` : ''}</div>
        <div class="soc-bar car"><i style="width:${soc}%"></i>${limit ? `<b style="left:${limit}%" title="Limit ${limit}%"></b>` : ''}</div>
        <p class="sub">${limit ? `Limit ${pct(limit)}` : ''}${toFull ? ` · ${toFull.toFixed(1)} kWh to the limit` : ''}</p>
        ${hasTyres ? `<div class="tyres">${['Front left', 'Front right', 'Rear left', 'Rear right'].map((n, i) => `<div><span>${n}</span><strong>${tyres[i] == null ? '–' : `${(tyres[i] * 14.5).toFixed(0)} psi`}</strong></div>`).join('')}</div>` : ''}`
      : `<p class="note">Battery level, range and tyres come from the ESPHome Tesla bridge, which Home Assistant reports as unavailable. Charging data below comes from the Wall Connector.</p>`}
      <dl class="kv car-kv">
        <div><dt>Wall Connector</dt><dd>${esc(HD.u.cap(status.replace(/_/g, ' ')) || '–')}</dd></div>
        <div><dt>Last session</dt><dd>${kwh(S().num(ev.session))}</dd></div>
        <div><dt>Lifetime</dt><dd>${S().num(ev.lifetime) != null ? `${(S().num(ev.lifetime) / 1000).toFixed(2)} MWh` : '–'}</dd></div>
        <div><dt>Handle temp</dt><dd>${S().num(ev.handleTemp) != null ? `${S().num(ev.handleTemp)}°C` : '–'}</dd></div>
        <div><dt>Grid voltage</dt><dd>${S().num(ev.voltage) != null ? `${Math.round(S().num(ev.voltage))} V` : '–'}</dd></div>
        <div><dt>Doors</dt><dd>${S().available(ev.doors) ? esc(HD.u.cap(S().state(ev.doors))) : '–'}</dd></div>
      </dl>`;
  }

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
