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

  function init() {
    load();
    setInterval(load, 15 * 60 * 1000);   // the tracker works in half hours; no need to ask often
  }

  HD.tracker = { init, load, get cop() { return state.cop; } };
})();
