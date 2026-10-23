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
 * SmartThings sometimes stops sending anything for hours (it did through the whole reheat
 * on the night of 22–23 Oct 2026: water heater "off", heating "off", tank frozen at 16°,
 * while the SigenStor showed 4.7 kW). So: with the heating not switched on, a heat pump
 * drawing at least `hotWaterAbove` kW (default 0.5) for 10 minutes is counted as reheating
 * the tank — it's the only long, heavy job it does with the heating off (defrosts are short).
 * If the tank reading hasn't moved for 20 min while that's happening, Samsung's data is
 * flagged as delayed.
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
    const id = HD.config.heatPump.tankTemp; const pid = HD.config.heatPump.power;
    const ids = [id, pid].filter(Boolean); if (!ids.length) return;
    try {
      const r = await HD.ha.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - 3600e3).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true });
      const rows = (e) => (r[e] || []).map((x) => [((x.lu || x.lc) * 1000) || Date.parse(x.last_changed), parseFloat(x.s ?? x.state)]).filter(([, v]) => !isNaN(v));
      if (id) tank.unshift(...rows(id).filter(([t]) => !tank.length || t < tank[0][0]));
      if (pid) power.unshift(...rows(pid).filter(([t]) => !power.length || t < power[0][0]));
    } catch (e) { console.warn('Heat pump history unavailable', e); }
  }
  // Recent power readings, to tell a sustained heavy run from a short burst
  const power = [];
  function notePower(now, kw) {
    const last = power[power.length - 1];
    if (!last || last[1] !== kw || now - last[0] > 60e3) power.push([now, kw]);
    while (power.length && now - power[0][0] > 3600e3) power.shift();
  }
  // Power has stayed at or above `kw` for the last `mins` minutes
  function sustained(now, kw, mins) {
    const since = now - mins * 60e3;
    const before = power.filter(([t]) => t <= since);
    if (!before.length) return false;   // not watched long enough yet
    const from = before[before.length - 1][0];
    return power.filter(([t]) => t >= from).every(([, v]) => v >= kw);
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
    const kw = S().num(c.power) || 0;
    notePower(now, kw);
    const running = kw > (c.runningAbove ?? 0.1);
    const rise = tankRise(now);
    const heatingOn = cl != null && HEATING_ON.has(cl);
    const reported = (wh != null && !OFF.has(wh)) || (running && rise >= 1);
    // Heating off, yet a long heavy run: it's reheating the tank, whatever Samsung says
    const likely = !reported && !heatingOn && sustained(now, c.hotWaterAbove ?? 0.5, 10);
    const hotWater = reported || likely;
    const tankAt = c.tankTemp && S().get(c.tankTemp) ? Date.parse(S().get(c.tankTemp).last_updated) : null;
    const delayed = likely && tankAt != null && S().mode !== 'demo' && now - tankAt > 20 * 60e3;
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
      note = likely ? `Heating's off and it's drawing ${kw.toFixed(1)} kW, so it's reheating the tank${delayed ? ' · Samsung data delayed' : ''}`
        : rise >= 0.5 ? `Tank up ${rise.toFixed(1)}° in 30 min` : 'Reheating the tank';
    } else if (heatingOn) {
      key = 'heat'; label = 'Heating';
      note = flow != null ? `Flow ${Math.round(flow)}°${flowTarget != null ? ` → ${Math.round(flowTarget)}°` : ''}` : 'Radiators';
    } else {
      key = 'other'; label = 'Running'; note = 'Defrost or pump run';
    }
    return { key, label, note, running, power: kw, hotWater, likely, delayed, heatingOn, waterKnown: wh != null, heatingKnown: cl != null, flow, flowTarget, rise };
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
