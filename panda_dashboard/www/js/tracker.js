/*
 * Figures from the Energy Tracker add-on (github.com/Suchabadpanda/ha-energy-tracker).
 *
 * The tracker estimates the heat pump's COP without a heat meter: hot water heat from the
 * cylinder's temperature rise in each reheat, space heating from a Carnot model scaled by
 * this heat pump's own measured efficiency (eta). Rather than repeat that here, the
 * dashboard asks the tracker for its figures through Home Assistant's ingress, which
 * the browser is already signed in to when the dashboard runs as an add-on panel.
 *
 * HD.tracker.cop → { today, yesterday, month, design, hotWater, heating, eta } or null
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  let base = null;          // the tracker's ingress path, once found
  let tried = false;
  const state = { cop: null, loadedAt: 0 };

  async function findTracker() {
    if (base || tried) return base;
    tried = true;
    const want = (HD.config.tracker && HD.config.tracker.slug) || null;
    try {
      const res = await HD.ha.callWS({ type: 'supervisor/api', endpoint: '/addons', method: 'get' });
      const a = (res.addons || []).find((x) => (want ? x.slug === want : /(^|_)energy_tracker$/.test(x.slug)));
      if (!a || a.state !== 'started') return null;
      const info = await HD.ha.callWS({ type: 'supervisor/api', endpoint: `/addons/${a.slug}/info`, method: 'get' });
      base = info.ingress_entry ? info.ingress_entry.replace(/\/$/, '') : null;
    } catch (e) { base = null; }   // not an admin, or not under Supervisor
    return base;
  }

  async function getJson(path) {
    const r = await fetch(`${base}${path}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function load() {
    if (HD.config.tracker === false) return;
    if (S().mode === 'demo') { state.cop = HD.demo.trackerCop || null; HD.store.emit(null); return; }
    if (S().mode !== 'live' || !(await findTracker())) return;
    try {
      const [today, heating] = await Promise.all([getJson('/api/today'), getJson('/api/heating')]);
      const t = today && today.by_device && today.by_device.parts && today.by_device.parts.heat_pump;
      const eff = heating && heating.efficiency;
      const tEff = t && t.efficiency;
      state.cop = {
        today: tEff ? tEff.scop : null,
        todayKwh: tEff ? tEff.kwh : null,
        todayHeat: tEff ? tEff.heat_kwh : null,
        heating: tEff ? tEff.heating_scop : null,
        hotWater: tEff ? tEff.hot_water_cop : null,
        yesterday: eff && eff.yesterday ? eff.yesterday.scop : null,
        month: eff && eff.this_month ? eff.this_month.scop : null,
        design: heating && heating.design ? heating.design.design_scop : null,
        eta: eff ? eff.eta : null,
        measured: eff ? eff.eta_source === 'measured' : false,
      };
      state.loadedAt = Date.now();
      HD.store.emit(null);
    } catch (e) { console.warn('Energy tracker unavailable', e); }
  }

  // The tracker's tariff history: every period with its import bands and VAT, back to
  // whenever Nan entered them (the dashboard's own tariffs only start in Oct 2025).
  // → [{ from (ms, local midnight), vat (multiplier), dynamic, bands: [{ s, e (minutes), p (£/kWh ex VAT) }] }]
  let tariffCache = null; let tariffAt = 0;
  async function tariffs() {
    if (HD.config.tracker === false || S().mode !== 'live') return null;
    if (tariffCache && Date.now() - tariffAt < 6 * 3600e3) return tariffCache;
    if (!(await findTracker())) return null;
    try {
      const res = await getJson('/api/tariffs');
      const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
      tariffCache = (res.periods || []).map((p) => ({
        from: Date.parse(`${p.effective_from}T00:00:00`), name: p.name, dynamic: p.dynamic || '',
        vat: 1 + (Number(p.vat_percent) || 0) / 100,
        bands: (p.import_bands || []).map((b) => ({ s: mins(b.start), e: mins(b.end), p: b.p_per_kwh / 100 })),
      })).filter((p) => Number.isFinite(p.from) && p.bands.length).sort((a, b) => a.from - b.from);
      tariffAt = Date.now();
    } catch (e) { console.warn('Energy tracker tariffs unavailable', e); }
    return tariffCache && tariffCache.length ? tariffCache : null;
  }

  // Import rate helpers over a tariff history from tariffs(). Rates include VAT, £/kWh.
  // A dynamic (half-hourly priced) period has no fixed bands to use, so it returns null
  // and the caller falls back to the dashboard's own tariff for those hours.
  function rates(periods) {
    const periodAt = (ts) => { let cur = null; for (const p of periods) { if (p.from <= ts) cur = p; else break; } return cur; };
    const band = (p, ts) => { const d = new Date(ts); const m = d.getHours() * 60 + d.getMinutes();
      return p.bands.find((b) => (b.s <= b.e ? m >= b.s && m < b.e : m >= b.s || m < b.e)); };
    return {
      periodAt,
      rate(ts) { const p = periodAt(ts); if (!p || p.dynamic) return null; const b = band(p, ts); return b ? b.p * p.vat : null; },
      cheapest(ts) { const p = periodAt(ts); return p && !p.dynamic ? Math.min(...p.bands.map((b) => b.p)) * p.vat : null; },
      isCheap(ts) { const p = periodAt(ts); if (!p || p.dynamic) return null; const b = band(p, ts); return !!b && b.p === Math.min(...p.bands.map((x) => x.p)); },
    };
  }

  function init() {
    load();
    setInterval(() => { if (!document.hidden) load(); }, 15 * 60 * 1000);   // the tracker works in half hours; no need to ask often
  }

  HD.tracker = { init, load, tariffs, rates, get cop() { return state.cop; } };
})();
