/*
 * What the heat pump is doing right now: heating, hot water, or both called for at once.
 *
 * Signals (config.heatPump):
 *   waterHeater  water_heater.*  Samsung shows "heat_pump" (anything but off) only while it
 *                                is reheating the tank; "off" the rest of the time.
 *   climate      climate.*       "heat" (or auto) means space heating is switched on;
 *                                current_temperature is the flow temperature.
 *   power        live electrical power (kW); above runningAbove the compressor is running.
 *   tankTemp     tank sensor; a rise of ≥ 1 °C over the last 30 min backs up "hot water"
 *                if the water heater entity is slow or unavailable.
 *
 * A monobloc like the Samsung Mono has one compressor and a diverter valve, so it heats
 * the radiators OR the tank at any instant. "Both" therefore means both are calling: the
 * tank is being reheated and the heating is waiting (or sharing by switching back and forth).
 * Same rules as the Energy Tracker's heatpump.mode(), so the two agree.
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  const UNKNOWN = new Set(['unavailable', 'unknown', '']);
  const OFF = new Set(['off', 'idle', 'standby', 'none', 'false', '0']);
  const HEATING_ON = new Set(['heat', 'heat_cool', 'auto', 'heating', 'on']);

  // Recent tank temperatures, oldest first, to spot a reheat from the tank itself
  const tank = [];
  let seeded = false;
  function noteTank(now) {
    const id = HD.config.heatPump.tankTemp; if (!id) return;
    const v = S().num(id); if (v == null) return;
    const last = tank[tank.length - 1];
    if (!last || last[1] !== v) tank.push([now, v]);
    while (tank.length && now - tank[0][0] > 2 * 3600e3) tank.shift();
  }
  // One look back at the last hour so a reheat already under way shows straight after loading
  async function seed() {
    if (seeded || S().mode === 'demo') return; seeded = true;
    const id = HD.config.heatPump.tankTemp; if (!id) return;
    try {
      const r = await HD.ha.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - 3600e3).toISOString(), entity_ids: [id], minimal_response: true, no_attributes: true });
      const rows = (r[id] || []).map((x) => [((x.lu || x.lc) * 1000) || Date.parse(x.last_changed), parseFloat(x.s ?? x.state)]).filter(([, v]) => !isNaN(v));
      tank.unshift(...rows.filter(([t]) => !tank.length || t < tank[0][0]));
    } catch (e) { console.warn('Tank history unavailable', e); }
  }
  function tankRise(now) {
    const recent = tank.filter(([t]) => now - t <= 30 * 60e3);
    if (recent.length < 2) return 0;
    return recent[recent.length - 1][1] - Math.min(...recent.map(([, v]) => v));
  }

  function mode() {
    const c = HD.config.heatPump || {};
    const now = S().mode === 'demo' && HD.demo ? HD.demo.snapshotTime : Date.now();
    noteTank(now); seed();
    const read = (id) => { if (!id || !S().get(id)) return null; const v = String(S().state(id)).toLowerCase(); return UNKNOWN.has(v) ? null : v; };
    const wh = read(c.waterHeater); const cl = read(c.climate);
    const power = S().num(c.power) || 0;
    const running = power > (c.runningAbove ?? 0.1);
    const rise = tankRise(now);
    const hotWater = (wh != null && !OFF.has(wh)) || (running && rise >= 1);
    const heatingOn = cl != null && HEATING_ON.has(cl);
    const flow = c.climate ? S().attr(c.climate, 'current_temperature') : null;
    const flowTarget = c.climate ? S().attr(c.climate, 'temperature') : null;
    const legionella = c.legionella && S().state(c.legionella) === 'on';

    // What it's doing now
    let key; let label; let note = '';
    if (!running && !hotWater) {
      key = 'rest'; label = 'Resting';
      note = heatingOn ? 'Heating on, not needed right now' : 'Heating off';
    } else if (hotWater && heatingOn) {
      key = 'both'; label = 'Hot water + heating';
      note = 'Tank first, then the heating';
    } else if (hotWater) {
      key = 'water'; label = legionella ? 'Hot water · legionella' : 'Hot water';
      note = rise >= 0.5 ? `Tank up ${rise.toFixed(1)}° in 30 min` : 'Reheating the tank';
    } else if (heatingOn) {
      key = 'heat'; label = 'Heating';
      note = flow != null ? `Flow ${Math.round(flow)}°${flowTarget != null ? ` → ${Math.round(flowTarget)}°` : ''}` : 'Radiators';
    } else {
      key = 'other'; label = 'Running'; note = 'Defrost or pump run';
    }
    return { key, label, note, running, power, hotWater, heatingOn, waterKnown: wh != null, heatingKnown: cl != null, flow, flowTarget, rise };
  }

  // Two small lamps: radiator and tap. Lit = that job is active now; dim outline = switched on but idle.
  function lampsHtml(m) {
    const { icon, esc } = HD.u;
    const heatCls = m.key === 'heat' ? 'on' : m.heatingOn ? 'armed' : '';
    const waterCls = m.hotWater ? 'on' : '';
    return `<span class="hp-mode hp-${m.key}" title="${esc(m.note)}">
      <span class="hp-lamp heat ${heatCls}">${icon('radiator')}Heating</span>
      <span class="hp-lamp water ${waterCls}">${icon('tap')}Hot water</span>
    </span>`;
  }

  HD.heatpump = { mode, lampsHtml };
})();
