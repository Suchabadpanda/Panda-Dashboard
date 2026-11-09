/*
 * Damp and condensation watch, from the room temperature/humidity sensors.
 *
 * For each room with both a temperature and a humidity sensor:
 *  - dew point (Magnus formula)
 *  - "cold corners": the humidity the air would reach against the coldest bits of the
 *    outside walls (corners, window reveals). Their surface temperature is estimated as
 *    outside + f × (room − outside), with f = 0.75, the surface temperature factor UK
 *    guidance (BRE IP 1/06, BS 5250) uses as the line for avoiding mould. Mould needs
 *    about 80% at the surface for some hours, so: under 75% fine, 75–80% watch, 80%+ risk.
 *  - hours in the last 7 days with the room itself at or above 65% (hourly means).
 * Outside temperature/dew point come from the weather entity (Met.no gives both), or
 * config.damp.outdoor (a temperature sensor) and config.damp.outdoorHumidity.
 *
 * config.damp = false turns it off. Optional: { f: 0.75, high: 65, watch: 75, risk: 80,
 *   alertHours: 3, rooms: ['Kitchen', …] (names to include; default every room with both sensors) }
 *
 * HD.damp.load()   7 days of hourly means (cached 30 min; called from data.refresh)
 * HD.damp.rows()   per-room figures, worst first
 * HD.damp.html()   the Rooms panel
 * HD.damp.alerts() Attention items: cold corners at risk (or the room at 70%+) for alertHours
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  const cfg = () => (HD.config.damp === false ? null : { f: 0.75, high: 65, watch: 75, risk: 80, alertHours: 3, ...(HD.config.damp || {}) });
  const nowTs = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());

  // Saturation vapour pressure (hPa) and dew point (°C), Magnus with Sonntag's constants
  const es = (t) => 6.112 * Math.exp((17.62 * t) / (243.12 + t));
  function dewPoint(t, rh) {
    if (t == null || rh == null || rh <= 0) return null;
    const g = Math.log(Math.min(rh, 100) / 100) + (17.62 * t) / (243.12 + t);
    return (243.12 * g) / (17.62 - g);
  }
  // Humidity against a surface at ts, for room air with dew point td
  const surfaceRh = (td, ts) => Math.min(100, (100 * es(td)) / es(ts));
  function coldCorner(t, rh, out) {
    const c = cfg(); const td = dewPoint(t, rh);
    if (td == null || out == null || out >= t) return td == null ? null : rh;   // not colder outside: the walls are as warm as the room
    return surfaceRh(td, out + c.f * (t - out));
  }

  function rooms() {
    const c = cfg(); if (!c) return [];
    const pick = c.rooms ? new Set(c.rooms) : null;
    return (HD.config.floors || []).flatMap((f) => f.rooms.map((r) => ({ ...r, floor: f.short })))
      .filter((r) => r.temp && r.hum && (!pick || pick.has(r.name)));
  }

  function outdoor() {
    const c = cfg() || {};
    const w = HD.config.weather; const wa = (w && S().get(w) && S().get(w).attributes) || {};
    const t = c.outdoor ? S().num(c.outdoor) : wa.temperature != null ? Number(wa.temperature) : null;
    const rh = c.outdoorHumidity ? S().num(c.outdoorHumidity) : wa.humidity != null ? Number(wa.humidity) : null;
    const dew = !c.outdoor && wa.dew_point != null ? Number(wa.dew_point) : dewPoint(t, rh);
    return { t, rh, dew };
  }

  // ── history: hourly means for 7 days ──
  let hist = null; let histAt = 0; let busy = false;
  async function load(force) {
    const list = rooms(); if (!list.length || busy) return;
    if (!force && hist && Date.now() - histAt < 30 * 60e3) return;
    busy = true;
    try {
      const end = nowTs();
      const ids = [...new Set(list.flatMap((r) => [r.temp, r.hum]))];
      const res = await HD.ha.stats(ids, end - 7 * 864e5, end, 'hour', ['mean']);
      hist = {};
      ids.forEach((id) => { hist[id] = (res && res[id] ? res[id] : []).filter((r) => r.mean != null).map((r) => [r.start, r.mean]); });
      histAt = Date.now();
      HD.store.emit(null);
    } catch (e) { console.warn('Damp: history unavailable', e); } finally { busy = false; }
  }

  function rows() {
    const c = cfg(); if (!c) return [];
    const out = outdoor();
    return rooms().map((r) => {
      const t = S().num(r.temp); const rh = S().num(r.hum);
      if (t == null || rh == null) return null;
      const dew = dewPoint(t, rh);
      const corner = coldCorner(t, rh, out.t);
      // Last 7 days: hours with the room at or above `high`
      const hh = hist && hist[r.hum] ? hist[r.hum] : null;
      const hoursHigh = hh ? hh.filter(([, v]) => v >= c.high).length : null;
      // Last alertHours hourly means (with today's outside temperature) plus now
      let lasting = null;
      if (hh && hist[r.temp] && hh.length >= c.alertHours) {
        const temps = new Map(hist[r.temp].map(([s, v]) => [s, v]));
        const recent = hh.slice(-c.alertHours).map(([s, v]) => [temps.get(s), v]).filter(([tt]) => tt != null);
        if (recent.length === c.alertHours) {
          const all = [...recent, [t, rh]];
          if (all.every(([tt, v]) => (coldCorner(tt, v, out.t) ?? 0) >= c.risk)) lasting = 'corner';
          else if (all.every(([, v]) => v >= 70)) lasting = 'room';
        }
      }
      const level = corner != null && corner >= c.risk ? 'risk' : (corner != null && corner >= c.watch) || rh >= c.high ? 'watch' : rh < 35 ? 'dry' : 'ok';
      return { name: r.name, floor: r.floor, t, rh, dew, corner, hoursHigh, hours: hh ? hh.length : 0, level, lasting };
    }).filter(Boolean).sort((a, b) => (b.corner ?? b.rh) - (a.corner ?? a.rh));
  }

  const LEVEL = { risk: 'Damp risk', watch: 'Keep an eye', dry: 'Dry', ok: 'Fine' };

  function html() {
    const { esc, temp, icon } = HD.u;
    const c = cfg(); if (!c) return '';
    const list = rows(); const out = outdoor();
    if (!list.length) return '<p class="empty">No rooms with both temperature and humidity sensors.</p>';
    const risky = list.filter((r) => r.level === 'risk'); const watch = list.filter((r) => r.level === 'watch');
    const headline = risky.length
      ? `${risky.map((r) => r.name).join(', ')}: cold corners are damp enough for mould.`
      : watch.length ? (watch.every((r) => r.rh < c.high)
        ? `${watch.map((r) => r.name).join(', ')}: cold corners are getting humid.`
        : `${watch.map((r) => r.name).join(', ')} ${watch.length > 1 ? 'are' : 'is'} on the humid side.`)
      : 'No damp or condensation risk right now.';
    // Airing out helps only when the outside air holds less moisture than the room
    const avgDew = list.reduce((a, r) => a + r.dew, 0) / list.length;
    const airing = out.dew != null && (risky.length || watch.length)
      ? (out.dew < avgDew - 1 ? `Outside air is drier (dew point ${temp(out.dew)} against ${temp(avgDew)} indoors), so airing out or running an extractor will bring humidity down.`
        : 'Outside air is about as moist as inside, so airing out won’t help much; an extractor or dehumidifier will.')
      : '';
    const scale = (v) => Math.max(0, Math.min(100, ((v - 40) / 60) * 100));   // bar runs 40–100%
    const tip = `Estimated humidity against the coldest parts of the outside walls (surface factor ${c.f}). Mould needs about ${c.risk}% there for hours at a time.`;
    return `
      <p class="headline">${esc(headline)}</p>
      ${airing ? `<p class="sub damp-air">${icon('fan')}${esc(airing)}</p>` : ''}
      <div class="damp-table" role="table" aria-label="Damp by room">
        <div class="damp-row head" role="row"><span role="columnheader">Room</span><span role="columnheader">Humidity</span><span role="columnheader">Dew point</span>
          <span role="columnheader" title="${esc(tip)}" class="damp-tip">Cold corners</span><span role="columnheader" title="Hours with the room at ${c.high}% or more, last 7 days">7 days ≥ ${c.high}%</span></div>
        ${list.map((r) => `<div class="damp-row ${r.level}" role="row">
          <span class="damp-name" role="cell"><span class="floor-chip">${esc(r.floor || '')}</span>${esc(r.name)}</span>
          <span role="cell">${Math.round(r.rh)}%<small> at ${temp(r.t)}</small></span>
          <span role="cell">${temp(r.dew)}</span>
          <span role="cell" class="damp-corner" title="${esc(tip)}">${r.corner != null ? `<span class="damp-bar"><i style="width:${scale(r.corner)}%"></i><b style="left:${scale(c.watch)}%"></b><b style="left:${scale(c.risk)}%"></b></span><em>${Math.round(r.corner)}%</em><span class="damp-level">${LEVEL[r.level]}</span>` : '–'}</span>
          <span role="cell">${r.hoursHigh == null ? '…' : r.hoursHigh ? `${r.hoursHigh} h` : 'none'}<small class="damp-wk"> at ${c.high}%+ this week</small></span>
        </div>`).join('')}
      </div>
      <p class="sub damp-foot">${out.t != null ? `Outside ${temp(out.t)}${out.rh != null ? `, ${Math.round(out.rh)}%` : ''}${out.dew != null ? `, dew point ${temp(out.dew)}` : ''}` : 'No outside temperature, so cold corners are shown at room temperature'}</p>`;
  }

  function alerts() {
    if (!cfg()) return [];
    const h = cfg().alertHours;
    return rows().filter((r) => r.lasting).map((r) => r.lasting === 'corner'
      ? ['drop', `${r.name}: damp risk, cold corners near ${Math.round(r.corner)}% humidity for ${h}+ hours`, 'warning']
      : ['drop', `${r.name} has been at ${Math.round(r.rh)}% humidity for ${h}+ hours`, 'info']);
  }

  HD.damp = { enabled: () => !!cfg() && rooms().length > 0, load, rows, html, alerts, dewPoint, coldCorner };
})();
