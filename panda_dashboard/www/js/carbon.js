/*
 * Grid carbon intensity for your region, from the GB Carbon Intensity API (NESO,
 * api.carbonintensity.org.uk; free, no key, CC BY 4.0). Only the first half of your postcode is
 * sent. config.carbon = { postcode: 'PO15' } turns it on.
 *
 * Gives the half-hourly regional forecast from midnight today for 48 hours: now, the greenest
 * 3-hour window in the next 24 hours, today's mix, and an estimate of the CO₂ in what the house
 * bought from the grid today (5-minute grid power × that half hour's intensity).
 */
window.HD = window.HD || {};

(function () {
  const C = () => HD.config;
  const S = () => HD.store;
  const nowTs = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());
  const HALF = 30 * 60e3;

  let data = null; let at = 0; let busy = null; let failed = false;
  const enabled = () => !!(C().carbon && C().carbon.postcode);

  function load(force) {
    if (!enabled() || busy) return busy || Promise.resolve();
    if (!force && data && Date.now() - at < 30 * 60e3) return Promise.resolve();
    busy = (async () => {
      try {
        if (S().mode === 'demo') { data = HD.demo.carbon(); at = Date.now(); return; }
        const d = new Date(nowTs()); d.setHours(0, 0, 0, 0);
        const pc = encodeURIComponent(String(C().carbon.postcode).trim().split(/\s+/)[0].toUpperCase());
        const r = await fetch(`https://api.carbonintensity.org.uk/regional/intensity/${d.toISOString().slice(0, 16)}Z/fw48h/postcode/${pc}`, { headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        data = { region: j.data.shortname, rows: j.data.data.map((x) => ({ from: Date.parse(x.from), to: Date.parse(x.to), g: x.intensity.forecast, index: x.intensity.index, mix: x.generationmix })) };
        at = Date.now(); failed = false;
      } catch (e) { failed = true; console.warn('Carbon intensity unavailable', e); }
    })().finally(() => { busy = null; });
    return busy;
  }

  const rowAt = (ts) => data && data.rows.find((r) => ts >= r.from && ts < r.to);

  // Lowest average over `hours` in the next `ahead` hours
  function greenest(now, hours = 3, ahead = 24) {
    const rows = data.rows.filter((r) => r.to > now && r.from < now + ahead * 3600e3);
    const n = hours * 2; let best = null;
    for (let i = 0; i + n <= rows.length; i++) {
      const seg = rows.slice(i, i + n); const avg = seg.reduce((a, r) => a + r.g, 0) / n;
      if (!best || avg < best.g) best = { from: seg[0].from, to: seg[n - 1].to, g: avg };
    }
    return best;
  }

  // kg CO₂ in today's grid import, from the 5-minute grid power curve
  function todayKg() {
    const d = HD.data.today; const id = C().energy.gridPower;
    const pts = d && d.curves && d.curves[id];
    if (!pts || !pts.length || !data) return null;
    let g = 0; let kwh = 0;
    pts.forEach((p) => { const r = rowAt(p.start); const v = Math.max(0, p.mean || 0) * (5 / 60); if (r && v) { g += v * r.g; kwh += v; } });
    return kwh ? { kg: g / 1000, kwh } : null;
  }

  const LEVEL = { 'very low': 'good', low: 'good', moderate: 'mid', high: 'bad', 'very high': 'bad' };

  function panelHtml() {
    if (!data) return `<p class="note">${failed ? 'Carbon intensity isn’t available right now.' : 'Loading…'}</p>`;
    const { esc, fmt } = HD.u;
    const now = nowTs(); const r = rowAt(now) || data.rows[0];
    const best = greenest(now);
    const hm = (ts) => fmt(ts, { hour: '2-digit', minute: '2-digit' });
    const day = (ts) => (new Date(ts).toDateString() === new Date(now).toDateString() ? '' : ` ${fmt(ts, { weekday: 'short' })}`);
    const cheap = best && HD.tariff.isOffPeak(best.from) && HD.tariff.isOffPeak(best.to - 1);
    const mix = (r.mix || []).filter((m) => m.perc >= 1).sort((a, b) => b.perc - a.perc);
    const clean = (r.mix || []).filter((m) => ['wind', 'solar', 'hydro', 'nuclear', 'biomass'].includes(m.fuel)).reduce((a, m) => a + m.perc, 0);
    const kg = todayKg();
    return `<div class="carbon-now">
        <p class="big">${Math.round(r.g)}<small> g CO₂/kWh</small></p>
        <span class="carbon-level ${LEVEL[r.index] || ''}">${esc(r.index || '')}</span>
      </div>
      <p class="sub">${esc(data.region || 'Your region')} now · ${Math.round(clean)}% low-carbon (${mix.slice(0, 3).map((m) => `${esc(m.fuel)} ${Math.round(m.perc)}%`).join(', ')})</p>
      ${best ? `<p class="carbon-best">${HD.u.icon('leaf')}<span><strong>Greenest 3 hours: ${hm(best.from)}–${hm(best.to)}${day(best.from)}</strong>, about ${Math.round(best.g)} g/kWh${cheap ? ' — inside your cheap window' : ''}.</span></p>` : ''}
      ${kg ? `<p class="sub">Today's grid import so far: ${kg.kwh.toFixed(1)} kWh, about ${kg.kg.toFixed(1)} kg CO₂.</p>` : ''}`;
  }

  function draw(box) {
    if (!box || !data) return;
    const now = nowTs();
    const d0 = new Date(now); d0.setMinutes(0, 0, 0); const x0 = d0.getTime(); const x1 = x0 + 24 * 3600e3;
    const regions = [];
    for (let ts = x0; ts < x1; ts += 3600e3) if (HD.tariff.isOffPeak(ts)) { const last = regions[regions.length - 1]; if (last && last[1] === ts) last[1] = ts + 3600e3; else regions.push([ts, ts + 3600e3]); }
    HD.chart.line(box, {
      label: 'Grid carbon intensity, next 24 hours', height: 150, xMin: x0, xMax: x1, xTicks: 6, ticks: 3, yMin: 0, endLabels: false, regions,
      format: (v, tick) => (tick ? `${Math.round(v)}` : `${Math.round(v)} g/kWh`),
      series: [{ name: 'g CO₂/kWh', points: data.rows.filter((r) => r.to > x0 && r.from < x1).map((r) => [r.from + HALF / 2, r.g]), color: 'var(--s-grid)', area: true }],
    });
  }

  HD.carbon = { enabled, load, panelHtml, draw };
})();
