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
    return `<div class="garage ${frost ? 'frost' : ''}" style="${tint(t)}" role="group" aria-label="${esc(c.name)}" title="${esc(tip)}">
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

  HD.garage = {
    enabled: () => !!cfg(),
    ids: () => { const c = cfg(); return c ? [c.temp] : []; },
    html,
    alerts,
  };
})();
