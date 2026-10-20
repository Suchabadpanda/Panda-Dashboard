/*
 * Weather over the roof on Home: sun, moon and stars, drifting clouds, rain, snow, hail,
 * fog, wind and lightning, from config.weather (a weather.* entity) and sun.sun.
 *
 * The house markup is rebuilt whenever a number on it changes, which would restart these
 * animations every second. So the sky lives in its own element beside the house and its
 * content is only rewritten when the weather (or day/night, or wind band) changes.
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  let el = null; let lastKey = '';

  // Home Assistant weather conditions → what to draw
  const LOOKS = {
    sunny: { orb: true },
    'clear-night': { orb: true, stars: true },
    partlycloudy: { orb: true, clouds: 2 },
    cloudy: { clouds: 4, grey: 1 },
    fog: { clouds: 2, fog: true, grey: 1 },
    rainy: { clouds: 3, grey: 2, rain: 'rain' },
    pouring: { clouds: 4, grey: 3, rain: 'pour' },
    snowy: { clouds: 3, grey: 1, snow: true },
    'snowy-rainy': { clouds: 3, grey: 2, rain: 'rain', snow: true },
    hail: { clouds: 4, grey: 2, rain: 'hail' },
    lightning: { clouds: 4, grey: 3, lightning: true },
    'lightning-rainy': { clouds: 4, grey: 3, rain: 'rain', lightning: true },
    windy: { orb: true, wind: true },
    'windy-variant': { clouds: 3, grey: 1, wind: true },
    exceptional: { clouds: 4, grey: 2, wind: true },
  };

  function isNight() {
    const sun = HD.config.sun && S().state(HD.config.sun.state);
    if (sun) return sun === 'below_horizon';
    const h = new Date().getHours(); return h < 7 || h >= 19;
  }

  // Wind speed in mph (HA reports in the entity's own unit), clamped for animation speed
  function windMph(id) {
    const v = S().attr(id, 'wind_speed'); if (v == null) return 8;
    const u = String(S().attr(id, 'wind_speed_unit') || 'km/h');
    const mph = /mph/i.test(u) ? v : /m\/s/i.test(u) ? v * 2.237 : /kn/i.test(u) ? v * 1.151 : v * 0.621;
    return Math.max(0, Math.min(45, mph));
  }

  // Deterministic "random" so the layout is the same each time it is drawn
  const rnd = (i, salt) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };

  function cloudsHtml(n, night) {
    let h = '';
    for (let i = 0; i < n; i++) {
      const top = 6 + rnd(i, 1) * 52; const scale = 0.7 + rnd(i, 2) * 0.7;
      // Spread clouds across the cycle with negative delays so they're already in place
      const dur = 60 + rnd(i, 3) * 50;
      h += `<i class="cloud ${night ? 'n' : ''}" style="top:${top.toFixed(0)}px;--s:${scale.toFixed(2)};--d:${dur.toFixed(0)}s;animation-delay:-${(dur * (i / n + rnd(i, 4) * 0.2)).toFixed(1)}s"></i>`;
    }
    return h;
  }

  function dropsHtml(kind, count) {
    let h = '';
    for (let i = 0; i < count; i++) {
      const left = rnd(i, 5) * 100; const delay = rnd(i, 6) * 1.2; const dur = (kind === 'pour' ? 0.45 : kind === 'hail' ? 0.55 : 0.75) + rnd(i, 7) * 0.35;
      h += `<i style="left:${left.toFixed(1)}%;animation-delay:-${delay.toFixed(2)}s;animation-duration:${dur.toFixed(2)}s"></i>`;
    }
    return `<div class="precip ${kind}">${h}</div>`;
  }

  function flakesHtml(count) {
    let h = '';
    for (let i = 0; i < count; i++) {
      const left = rnd(i, 8) * 100; const dur = 4 + rnd(i, 9) * 4; const size = 2 + rnd(i, 10) * 3;
      h += `<i style="left:${left.toFixed(1)}%;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;animation-duration:${dur.toFixed(1)}s;animation-delay:-${(rnd(i, 11) * dur).toFixed(1)}s"></i>`;
    }
    return `<div class="precip snow">${h}</div>`;
  }

  function starsHtml() {
    let h = '';
    for (let i = 0; i < 18; i++) {
      h += `<i style="left:${(rnd(i, 12) * 100).toFixed(1)}%;top:${(rnd(i, 13) * 70).toFixed(0)}%;animation-delay:-${(rnd(i, 14) * 4).toFixed(1)}s;--z:${(1 + rnd(i, 15) * 1.2).toFixed(1)}px"></i>`;
    }
    return `<div class="stars">${h}</div>`;
  }

  function windHtml() {
    let h = '';
    for (let i = 0; i < 5; i++) h += `<i style="top:${(15 + rnd(i, 16) * 120).toFixed(0)}px;animation-delay:-${(rnd(i, 17) * 3).toFixed(1)}s"></i>`;
    return `<div class="gusts">${h}</div>`;
  }

  function render() {
    const id = HD.config.weather;
    const cond = (id && S().state(id)) || '';
    const night = isNight();
    const look = LOOKS[cond] || (night ? LOOKS['clear-night'] : LOOKS.sunny);
    const wind = windMph(id);
    const key = `${cond}|${night}|${Math.round(wind / 5)}`;
    if (key === lastKey) return;
    lastKey = key;

    const temp = S().attr(id, 'temperature');
    el.className = `sky ${night ? 'night' : 'day'} w-${cond || 'none'} grey-${look.grey || 0}`;
    // Wind tilts the rain and speeds the clouds up
    el.style.setProperty('--tilt', `${Math.min(25, wind * 0.6).toFixed(0)}deg`);
    el.style.setProperty('--wind', (1 / (0.6 + wind / 12)).toFixed(2));
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `Weather: ${cond.replace(/-/g, ' ') || 'unknown'}${temp != null ? `, ${Math.round(temp)} degrees` : ''}`);
    el.innerHTML = [
      look.stars || (night && look.orb) ? starsHtml() : '',
      look.orb ? `<i class="orb ${night ? 'moon' : 'sun'}"></i>` : '',
      look.fog ? '<i class="fog a"></i><i class="fog b"></i>' : '',
      look.clouds ? cloudsHtml(look.clouds, night) : '',
      look.wind ? windHtml() : '',
      look.rain ? dropsHtml(look.rain, look.rain === 'pour' ? 70 : look.rain === 'hail' ? 34 : 40) : '',
      look.snow ? flakesHtml(30) : '',
      look.lightning ? '<i class="bolt-flash"></i><svg class="bolt" viewBox="0 0 20 40" aria-hidden="true"><path d="M12 0L2 22h7l-3 18 12-26h-7z"/></svg>' : '',
    ].join('');
  }

  // home.js mounts a #sky-host beside #house (not inside it, so rewriting the house never
  // restarts the animations) and calls place() after each write; the host is lined up with
  // the house column whatever the layout does.
  let ro = null;
  function place(host, house) {
    if (!host || !house) return;
    if (!el || el.parentNode !== host) { el = document.createElement('div'); host.replaceChildren(el); lastKey = ''; }
    render();
    const col = house.querySelector('.house');
    const wrap = host.parentElement;
    if (!col || !wrap) return;
    const a = col.getBoundingClientRect(); const b = wrap.getBoundingClientRect();
    host.style.left = `${(a.left - b.left).toFixed(0)}px`;
    host.style.top = `${(a.top - b.top).toFixed(0)}px`;
    host.style.width = `${a.width.toFixed(0)}px`;
    if (!ro && window.ResizeObserver) { ro = new ResizeObserver(() => place(document.getElementById('sky-host'), document.getElementById('house'))); ro.observe(wrap); }
  }
  function reset() { if (ro) ro.disconnect(); ro = null; el = null; lastKey = ''; }

  HD.sky = { place, reset, conditions: Object.keys(LOOKS) };
})();
