/*
 * Garage (or any outbuilding): a small building drawn beside the house on the Home view,
 * with its own temperature/humidity sensor. It isn't heated, so it's kept out of the house
 * average, the room balance, the Rooms chart and the damp watch.
 *
 * config.garage = {
 *   name: 'Garage',
 *   temp: 'sensor.…_temperature', hum: 'sensor.…_humidity',   // hum optional
 *   frostBelow: 3,    // Attention item at or below this °C (false = off). Default 3.
 *   dampAbove: false, // Attention item at or above this % humidity (e.g. 85). Default off.
 * }
 *
 * HD.garage.enabled()  config has a temperature sensor
 * HD.garage.ids()      sensors to fetch 24 h of history for (data.js)
 * HD.garage.html()     the building on the Home view
 * HD.garage.alerts()   Attention items: near freezing, damp
 * HD.garage.show()     the history dialog (also opened by clicking the building):
 *                      24 h (5-minute), 7 days (hourly), 30 days and a year (daily low/average/high),
 *                      humidity underneath, low/high/average and time near freezing
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  const { esc, temp, pct, icon } = HD.u;
  const cfg = () => (HD.config.garage && HD.config.garage.temp ? { name: 'Garage', frostBelow: 3, dampAbove: false, ...HD.config.garage } : null);

  // Tint: cool from 12° down to 2° and below (an unheated garage is never "on target"), warm above 26°
  function tint(t) {
    if (t == null) return '';
    const cold = Math.max(0, Math.min(1, (12 - t) / 10));
    const hot = Math.max(0, Math.min(1, (t - 26) / 6));
    if (!cold && !hot) return '';
    return `--tint: color-mix(in oklab, var(${cold ? '--cool' : '--warm'}) ${Math.round((cold || hot) * 45)}%, var(--room));`;
  }

  // Last 24 h (statistics, ending at the live reading) as a small line, plus its low/high
  function history(c, now) {
    const pts = ((HD.data && HD.data.temps && HD.data.temps[c.temp]) || []).slice();
    if (now != null) pts.push([HD.u.now(), now]);
    if (pts.length < 3) return null;
    const vs = pts.map((p) => p[1]);
    const lo = Math.min(...vs); const hi = Math.max(...vs);
    const t0 = pts[0][0]; const t1 = pts[pts.length - 1][0];
    const span = Math.max(hi - lo, 1);   // a flat day stays a flat line, not magnified noise
    const mid = (hi + lo) / 2;
    const y = (v) => (22 - ((v - (mid - span / 2)) / span) * 20).toFixed(1);
    const x = (ts) => (((ts - t0) / Math.max(t1 - t0, 1)) * 100).toFixed(1);
    const line = pts.map((p) => `${x(p[0])},${y(p[1])}`).join(' ');
    return { lo, hi, line };
  }

  function html() {
    const c = cfg(); if (!c) return '';
    const t = S().num(c.temp); const h = c.hum ? S().num(c.hum) : null;
    const waiting = t == null && !S().get(c.temp);
    const offline = !waiting && t == null;
    const frost = c.frostBelow !== false && t != null && t <= c.frostBelow;
    const hist = history(c, t);
    const tip = hist ? `${c.name}: ${temp(t)}${h != null ? `, ${pct(h)} humidity` : ''} · last 24 h ${hist.lo.toFixed(1)}° to ${hist.hi.toFixed(1)}°` : c.name;
    return `<div class="garage ${frost ? 'frost' : ''}" style="${tint(t)}" role="button" tabindex="0" data-garage aria-haspopup="dialog" aria-label="${esc(c.name)}: show temperature history" title="${esc(tip)} · tap for history">
      <div class="garage-roof" aria-hidden="true"></div>
      <div class="garage-body">
        <header><h4>${esc(c.name)}</h4>${frost ? `<span class="frost-mark" title="Near freezing">${icon('snow')}</span>` : ''}</header>
        ${waiting ? '<p class="room-wait">Sensor not set up yet</p>'
          : offline ? '<p class="room-wait">Sensor offline</p>'
          : `<p class="garage-temp">${temp(t)}</p>
        ${h != null ? `<p class="room-meta">${icon('drop')}${pct(h)}</p>` : ''}`}
        ${hist ? `<svg class="garage-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><polyline points="${hist.line}"/></svg>
        <p class="sub">24 h ${hist.lo.toFixed(1)}–${hist.hi.toFixed(1)}°</p>` : ''}
        <div class="garage-door" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      </div>
    </div>`;
  }

  function alerts() {
    const c = cfg(); if (!c) return [];
    const out = [];
    const t = S().num(c.temp); const h = c.hum ? S().num(c.hum) : null;
    if (c.frostBelow !== false && t != null && t <= c.frostBelow) out.push(['snow', `${c.name} is ${temp(t)}: near freezing`, t <= 0 ? 'critical' : 'warning']);
    if (c.dampAbove && h != null && h >= c.dampAbove) out.push(['drop', `${c.name} humidity ${pct(h)}`, 'info']);
    return out;
  }


  // ── History dialog ──
  const RANGES = {
    day: { label: '24 h', ms: 864e5, period: '5minute', fallback: 'hour' },
    week: { label: '7 days', ms: 7 * 864e5, period: 'hour' },
    month: { label: '30 days', ms: 30 * 864e5, period: 'day', bands: true },
    year: { label: 'Year', ms: 365 * 864e5, period: 'day', bands: true },
  };
  const STEP = { '5minute': 3e5, hour: 3600e3, day: 864e5 };
  const cache = {};       // range → { at, rows: { temp, hum }, period }
  let range = 'day';
  let token = 0;          // drops a slow answer for a range that is no longer showing
  try { range = RANGES[localStorage.getItem('hd.garageRange')] ? localStorage.getItem('hd.garageRange') : 'day'; } catch (e) { /* storage blocked */ }

  function dlg() {
    let d = document.getElementById('garage-dialog');
    if (!d) {
      d = Object.assign(document.createElement('dialog'), { id: 'garage-dialog', className: 'garage-dialog' });
      d.addEventListener('click', (ev) => {
        if (ev.target === d || ev.target.closest('[data-garage-close]')) { d.close(); return; }
        const b = ev.target.closest('[data-garage-range]');
        if (b && b.dataset.garageRange !== range) {
          range = b.dataset.garageRange;
          try { localStorage.setItem('hd.garageRange', range); } catch (e) { /* storage blocked */ }
          load();
        }
      });
      document.body.appendChild(d);
    }
    return d;
  }

  async function fetchRange(c, key) {
    const r = RANGES[key];
    const hit = cache[key];
    if (hit && HD.u.now() - hit.at < 5 * 60e3) return hit;
    const ids = [c.temp, c.hum].filter(Boolean);
    const end = HD.u.now(); const start = end - r.ms;
    let period = r.period;
    let res = await HD.ha.stats(ids, start, end, period, ['mean', 'min', 'max']).catch(() => null);
    if (r.fallback && !(res && res[c.temp] && res[c.temp].length)) {
      period = r.fallback;
      res = await HD.ha.stats(ids, start, end, period, ['mean', 'min', 'max']);
    }
    const rows = (id) => ((res && id && res[id]) || []).filter((x) => x.mean != null);
    const out = { at: HD.u.now(), period, start, end, rows: { temp: rows(c.temp), hum: rows(c.hum) } };
    cache[key] = out;
    return out;
  }

  // Low/high (with when), average, and time at or below the frost line
  function summary(c, d) {
    const rows = d.rows.temp; if (!rows.length) return null;
    let lo = rows[0]; let hi = rows[0]; let sum = 0;
    const low = (x) => (x.min ?? x.mean); const high = (x) => (x.max ?? x.mean);
    rows.forEach((x) => { if (low(x) < low(lo)) lo = x; if (high(x) > high(hi)) hi = x; sum += x.mean; });
    let frost = null;
    if (c.frostBelow !== false) {
      const n = rows.filter((x) => low(x) <= c.frostBelow).length;
      frost = d.period === 'day' ? { n, unit: n === 1 ? 'day' : 'days' } : { n: Math.round((n * STEP[d.period]) / 3600e3 * 10) / 10, unit: 'h' };
    }
    return { lo: low(lo), loAt: lo.start, hi: high(hi), hiAt: hi.start, avg: sum / rows.length, frost, since: rows[0].start };
  }

  function when(ts, period) {
    if (period === 'day') return HD.u.fmt(ts, { weekday: 'short', day: 'numeric', month: 'short' });
    if (range === 'day') return HD.u.fmt(ts, { hour: '2-digit', minute: '2-digit' });
    return HD.u.fmt(ts, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function axis(key) {
    if (key === 'day') return { x: (v) => HD.u.fmt(v, { hour: '2-digit', minute: '2-digit' }), tip: (v) => HD.u.fmt(v, { hour: '2-digit', minute: '2-digit' }) };
    if (key === 'week') return { x: (v) => HD.u.fmt(v, { weekday: 'short' }), tip: (v) => HD.u.fmt(v, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) };
    if (key === 'month') return { x: (v) => HD.u.fmt(v, { day: 'numeric', month: 'short' }), tip: (v) => HD.u.fmt(v, { weekday: 'short', day: 'numeric', month: 'short' }) };
    return { x: (v) => HD.u.fmt(v, { month: 'short' }), tip: (v) => HD.u.fmt(v, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) };
  }

  function frame(c, body) {
    const t = S().num(c.temp); const h = c.hum ? S().num(c.hum) : null;
    const tabs = Object.entries(RANGES).map(([k, r]) => `<button data-garage-range="${k}" class="${k === range ? 'on' : ''}" aria-pressed="${k === range}">${r.label}</button>`).join('');
    return `<header><h3>${icon('thermo')}${esc(c.name)}</h3><button class="btn ghost" data-garage-close aria-label="Close">Close</button></header>
      <p class="garage-now">${t != null ? `<b>${temp(t)}</b>` : '<b>–</b>'}${h != null ? `<span>${icon('drop')}${pct(h)}</span>` : ''}<small>now</small></p>
      <div class="seg" role="group" aria-label="Time range">${tabs}</div>
      ${body}`;
  }

  async function load() {
    const c = cfg(); if (!c) return;
    const d = dlg(); const my = ++token;
    if (!cache[range] || HD.u.now() - cache[range].at >= 5 * 60e3) HD.u.setHTML(d, frame(c, '<p class="empty garage-loading">Loading…</p>'));
    let data;
    try { data = await fetchRange(c, range); } catch (e) {
      if (my === token) HD.u.setHTML(d, frame(c, `<p class="empty">Couldn't load the history: ${esc(e.message || String(e))}</p>`));
      return;
    }
    if (my !== token || !d.open) return;
    draw(c, data);
  }

  function draw(c, data) {
    const d = dlg(); const r = RANGES[range];
    const sm = summary(c, data);
    const live = S().num(c.temp); const liveH = c.hum ? S().num(c.hum) : null;
    const nowTs = HD.u.now();
    const fmtV = (v, tick) => (tick ? `${v}°` : `${v.toFixed(1)}°C`);
    const facts = sm ? `<div class="garage-facts">
        <div><small>Low</small><b class="cool">${sm.lo.toFixed(1)}°</b><span>${esc(when(sm.loAt, data.period))}</span></div>
        <div><small>High</small><b class="warm">${sm.hi.toFixed(1)}°</b><span>${esc(when(sm.hiAt, data.period))}</span></div>
        <div><small>Average</small><b>${sm.avg.toFixed(1)}°</b><span>${r.label === 'Year' ? 'past year' : `past ${r.label}`}</span></div>
        ${sm.frost ? `<div><small>At or below ${c.frostBelow}°</small><b class="${sm.frost.n ? 'cool' : ''}">${sm.frost.n} ${sm.frost.unit}</b><span>near freezing</span></div>` : ''}
      </div>` : '';
    // the sensor is newer than the range: say from when
    const since = sm && sm.since - data.start > 2 * STEP[data.period] ? `<p class="trv-note muted">${icon('clock')}Recorded since ${esc(HD.u.fmt(sm.since, { weekday: 'short', day: 'numeric', month: 'short' }))}</p>` : '';
    HD.u.setHTML(d, frame(c, `${facts}
      <div class="chart-box" id="garage-chart-temp"></div>
      ${c.hum && data.rows.hum.length ? '<h4 class="garage-sub">Humidity</h4><div class="chart-box" id="garage-chart-hum"></div>' : ''}
      ${since}`));
    const ax = axis(range);
    const narrow = d.clientWidth < 520;
    const xt = narrow ? 3 : range === 'week' ? 7 : 6;
    const pts = (rows, k) => rows.map((x) => [x.start, x[k] ?? x.mean]);
    let series;
    if (r.bands) {
      series = [
        { name: 'High', points: pts(data.rows.temp, 'max'), color: 'var(--warm)' },
        { name: 'Average', points: pts(data.rows.temp, 'mean'), color: 'var(--muted)' },
        { name: 'Low', points: pts(data.rows.temp, 'min'), color: 'var(--cool)' },
      ];
    } else {
      const p = pts(data.rows.temp, 'mean');
      if (live != null && p.length) p.push([nowTs, live]);
      series = [{ name: 'Temperature', points: p, color: 'var(--c1)' }];
    }
    // frost line, only when the readings come near it
    if (sm && c.frostBelow !== false && sm.lo <= c.frostBelow + 3) {
      series.push({ name: `Frost line ${c.frostBelow}°`, points: [[data.start, c.frostBelow], [nowTs, c.frostBelow]], color: 'var(--cool)', dashed: true });
    }
    HD.chart.line(document.getElementById('garage-chart-temp'), {
      label: `${c.name} temperature, ${r.label}`, height: 240, format: fmtV, xTicks: xt,
      xMin: data.start, xMax: nowTs, xFormat: ax.x, tipX: ax.tip, empty: 'No readings recorded for this range yet.',
      series,
    });
    const hb = document.getElementById('garage-chart-hum');
    if (hb) {
      const hp = pts(data.rows.hum, 'mean');
      if (!r.bands && liveH != null && hp.length) hp.push([nowTs, liveH]);
      HD.chart.line(hb, {
        label: `${c.name} humidity, ${r.label}`, height: 120, ticks: 2, format: (v, tick) => (tick ? `${v}%` : `${v.toFixed(0)}%`),
        xTicks: xt, xMin: data.start, xMax: nowTs, xFormat: ax.x, tipX: ax.tip,
        series: [{ name: r.bands ? 'Average humidity' : 'Humidity', points: hp, color: 'var(--c3)' }],
      });
    }
  }

  function show() {
    if (!cfg()) return;
    const d = dlg(); d._html = null;
    if (!d.open) d.showModal();
    load();
  }

  document.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('[data-garage]')) show(); });
  document.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('[data-garage]')) { ev.preventDefault(); show(); }
  });

  HD.garage = {
    enabled: () => !!cfg(),
    ids: () => { const c = cfg(); return c ? [c.temp] : []; },
    html,
    alerts,
    show,
  };
})();
