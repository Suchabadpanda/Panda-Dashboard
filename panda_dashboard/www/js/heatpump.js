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
 *                if the water heater entity is slow or unavailable — unless the water
 *                heater turned off after the tank's last rise (the reheat has finished).
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
 * Flow climb (same rule as the Energy Tracker's flow_reheats, 0.42.1+): space heating keeps
 * the flow below 48 °C, so while the flow is climbing past 48 °C it's reheating the tank,
 * whatever the mode entities say — unless the heating itself asked for 48 °C or more when the
 * flow got there (27 Oct 2026: a plumber's radiator test at 50–64 °C). SmartThings sometimes
 * stops sending the water heater's changes while the flow keeps coming (28 Oct 2026: flow
 * 42 → 54.5 °C 05:59–06:20 with the water heater stuck "off"). Only the climb counts: the
 * flow stays hot for half an hour afterwards while it cools.
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
    const id = HD.config.heatPump.tankTemp; const pid = HD.config.heatPump.power; const sub = subtractIds();
    const ids = [id, pid, ...sub].filter(Boolean); if (!ids.length) return;
    try {
      const r = await HD.ha.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - 3600e3).toISOString(), entity_ids: ids, minimal_response: true, no_attributes: true });
      const rows = (e) => (r[e] || []).map((x) => [((x.lu || x.lc) * 1000) || Date.parse(x.last_changed), parseFloat(x.s ?? x.state)]).filter(([, v]) => !isNaN(v));
      if (id) tank.unshift(...rows(id).filter(([t]) => !tank.length || t < tank[0][0]));
      if (pid) {
        // Take the other loads off at each reading (their last value at or before it)
        const others = sub.map(rows);
        const at = (pts, t) => { let v = 0; for (const [ts, x] of pts) { if (ts > t) break; v = x; } return v; };
        const net = rows(pid).map(([t, v]) => [t, Math.max(0, v - others.reduce((a, pts) => a + at(pts, t), 0))]);
        power.unshift(...net.filter(([t]) => !power.length || t < power[0][0]));
      }
    } catch (e) { console.warn('Heat pump history unavailable', e); }
    const cl = HD.config.heatPump.climate; if (!cl) return;
    try {
      const r = await HD.ha.callWS({ type: 'history/history_during_period', start_time: new Date(Date.now() - 3600e3).toISOString(), entity_ids: [cl], minimal_response: false, no_attributes: false, significant_changes_only: false });
      const old = (r[cl] || []).map((x) => [((x.lu || x.lc) * 1000), x.a && x.a.current_temperature, x.a && x.a.temperature])
        .filter(([t, v]) => t && Number.isFinite(v) && (!flowPts.length || t < flowPts[0][0]));
      flowPts.unshift(...old);
    } catch (e) { console.warn('Heat pump flow history unavailable', e); }
  }
  // Other loads measured on the same circuit as heatPump.power (e.g. the Wall Connector on
  // SigenStor smart-load port 1, like the Energy Tracker's ev_on_smart_load)
  const subtractIds = () => [].concat((HD.config.heatPump || {}).subtract || []).filter(Boolean);
  // The heat pump's own draw now in kW: power minus the subtract loads, never below 0
  function kwNow() {
    const kw = S().num((HD.config.heatPump || {}).power);
    if (kw == null) return null;
    return Math.max(0, kw - subtractIds().reduce((t, id) => t + (S().num(id) || 0), 0));
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
  // Recent flow readings [ms, °C, target °C], oldest first, for the flow-climb rule
  const REHEAT_FLOW = 48;             // °C: heating stays below, a tank reheat climbs past
  const STEP = 10 * 60e3;             // readings further apart than this say nothing
  const WINDOW = 5 * 60e3;            // the climb is over once it hasn't risen for this long
  const flowPts = [];
  function noteFlow(now, v, target) {
    if (v == null || !Number.isFinite(v)) return;
    const last = flowPts[flowPts.length - 1];
    if (!last || last[1] !== v || last[2] !== target) flowPts.push([now, v, target]);
    while (flowPts.length && now - flowPts[0][0] > 2 * 3600e3) flowPts.shift();
  }
  // The climb under way now: { since, crossed, target } or null
  function flowClimb(now) {
    const p = flowPts; const n = p.length;
    if (n < 2 || p[n - 1][1] < REHEAT_FLOW) return null;
    // Last rise, with no fall since
    let j = n - 1;
    while (j > 0 && p[j][1] === p[j - 1][1]) j--;
    if (j === 0 || p[j][1] < p[j - 1][1] || p[j][0] - p[j - 1][0] > STEP || now - p[j][0] > WINDOW) return null;
    // Back to where this run of rising readings began
    let k = j;
    while (k > 0 && p[k - 1][1] <= p[k][1] && p[k][0] - p[k - 1][0] <= STEP) k--;
    const cross = p.slice(k, j + 1).find(([, v]) => v >= REHEAT_FLOW);
    if (!cross || cross === p[k]) return null;   // already that hot when the run began: not a climb past 48
    // What the heating asked for when the flow reached 48 °C
    if (cross[2] != null && cross[2] >= REHEAT_FLOW) return null;
    return { since: p[k][0], crossed: cross[0], target: cross[2] };
  }

  // When the tank last went up (ms), or null
  function lastTankRise() {
    for (let i = tank.length - 1; i > 0; i--) if (tank[i][1] > tank[i - 1][1]) return tank[i][0];
    return null;
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
    const kw = kwNow() || 0;
    notePower(now, kw);
    const running = kw > (c.runningAbove ?? 0.1);
    const rise = tankRise(now);
    const heatingOn = cl != null && HEATING_ON.has(cl);
    // The tank-rise backup is for a water heater entity that's missing or lagging. If Samsung
    // switched it to off after the tank's last rise, the reheat has finished: trust the off,
    // even though the 30-minute rise is still large (27 Oct 2026: reheat ended 12:19, the
    // heat pump went straight back to the radiators, and the card said "Hot water + heating"
    // until the rise aged out ~12:45).
    const whOffAt = wh != null && OFF.has(wh) && S().get(c.waterHeater) ? Date.parse(S().get(c.waterHeater).last_changed) : null;
    const riseAt = lastTankRise();
    const offAfterRise = whOffAt != null && riseAt != null && whOffAt >= riseAt;
    const flow = c.climate ? S().attr(c.climate, 'current_temperature') : null;
    const flowTarget = c.climate ? S().attr(c.climate, 'temperature') : null;
    noteFlow(now, flow, flowTarget);
    const climbing = flowClimb(now);
    // A water heater switched off after the flow passed 48 °C has ended the reheat
    const climb = climbing && !(whOffAt != null && whOffAt >= climbing.crossed) ? climbing : null;
    const reported = (wh != null && !OFF.has(wh)) || (running && rise >= 1 && !offAfterRise) || !!climb;
    // Heating off, yet a long heavy run: it's reheating the tank, whatever Samsung says
    const likely = !reported && !heatingOn && sustained(now, c.hotWaterAbove ?? 0.5, 10);
    const hotWater = reported || likely;
    const tankAt = c.tankTemp && S().get(c.tankTemp) ? Date.parse(S().get(c.tankTemp).last_updated) : null;
    const delayed = likely && tankAt != null && S().mode !== 'demo' && now - tankAt > 20 * 60e3;
    const legionella = c.legionella && S().state(c.legionella) === 'on';

    // What it's doing now
    let key; let label; let note = '';
    if (!running && !hotWater) {
      key = 'rest'; label = 'Resting';
      note = heatingOn ? 'Heating on, not needed right now' : 'Heating off';
    } else if (hotWater && heatingOn) {
      key = 'both'; label = 'Hot water + heating';
      note = climb && (wh == null || OFF.has(wh)) ? `Flow climbing past ${REHEAT_FLOW}°: tank first, then the heating` : 'Tank first, then the heating';
    } else if (hotWater) {
      key = 'water'; label = legionella ? 'Hot water · legionella' : 'Hot water';
      note = climb && (wh == null || OFF.has(wh)) ? `Flow ${Math.round(flow)}° and climbing past ${REHEAT_FLOW}°, so it's reheating the tank`
        : likely ? `Heating's off and it's drawing ${kw.toFixed(1)} kW, so it's reheating the tank${delayed ? ' · Samsung data delayed' : ''}`
        : rise >= 0.5 ? `Tank up ${rise.toFixed(1)}° in 30 min` : 'Reheating the tank';
    } else if (heatingOn) {
      key = 'heat'; label = 'Heating';
      note = flow != null ? `Flow ${Math.round(flow)}°${flowTarget != null ? ` → ${Math.round(flowTarget)}°` : ''}` : 'Radiators';
    } else {
      key = 'other'; label = 'Running'; note = 'Defrost or pump run';
    }
    return { key, label, note, running, power: kw, hotWater, likely, delayed, heatingOn, waterKnown: wh != null, heatingKnown: cl != null, flow, flowTarget, rise, climb };
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

  HD.heatpump = { mode, lampsHtml, kw: kwNow, _flow: { noteFlow, flowClimb, reset: () => flowPts.splice(0) } };
})();
