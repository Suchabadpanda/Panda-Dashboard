'use strict';
/*
 * The quick panel's view of the house: plain values worked out from Home Assistant's state
 * map and Panda Dashboard's config.js. Kept free of Electron so it can be tested with node.
 * The rules match the dashboard's own (heatpump.js, car.js, home.js), so the two agree.
 */

const UNKNOWN = new Set(['unavailable', 'unknown', '']);
const OFF = new Set(['off', 'idle', 'standby', 'none', 'false', '0']);
const HEATING_ON = new Set(['heat', 'heat_cool', 'auto', 'heating', 'on']);

function reader(states) {
  const get = (id) => (id ? states[id] : undefined);
  const st = (id) => (get(id) ? get(id).state : null);
  const num = (id) => { const v = get(id) ? parseFloat(get(id).state) : NaN; return Number.isFinite(v) ? v : null; };
  const attr = (id, k) => (get(id) && get(id).attributes ? get(id).attributes[k] : undefined);
  const available = (id) => { const s = st(id); return s != null && !UNKNOWN.has(String(s)); };
  const ids = () => Object.keys(states);
  return { get, st, num, attr, available, ids };
}

// Heat pump draw: config.heatPump.power minus anything else measured on the same circuit
// (heatPump.subtract, e.g. the Wall Connector on SigenStor smart-load port 1), never below 0
function heatPumpKw(hp, r) {
  const kw = r.num(hp.power);
  if (kw == null) return null;
  const others = [].concat(hp.subtract || []).reduce((t, id) => t + (r.num(id) || 0), 0);
  return Math.max(0, kw - others);
}

// Heating, hot water, or both called for at once (the Samsung has one compressor and a
// diverter valve, so "both" means the tank is being reheated and the heating waits)
function heatPumpMode(c, r) {
  const hp = c.heatPump || {};
  if (!hp.power && !hp.waterHeater && !hp.climate) return null;
  const read = (id) => { const v = r.st(id); return v == null || UNKNOWN.has(String(v).toLowerCase()) ? null : String(v).toLowerCase(); };
  const wh = read(hp.waterHeater); const cl = read(hp.climate);
  const kw = heatPumpKw(hp, r);
  const running = kw != null && kw > (hp.runningAbove ?? 0.1);
  const heatingOn = cl != null && HEATING_ON.has(cl);
  // SmartThings can go quiet for hours while the tank reheats; with the heating off, a heavy
  // draw can only be the tank (the dashboard also wants it held for 10 min; the tray can't see history)
  const hotWater = (wh != null && !OFF.has(wh)) || (!heatingOn && kw != null && kw >= (hp.hotWaterAbove ?? 0.5));
  const flow = hp.climate ? r.attr(hp.climate, 'current_temperature') : null;
  let key = 'rest'; let label = 'Resting';
  if (hotWater && heatingOn) { key = 'both'; label = 'Hot water + heating'; }
  else if (hotWater) { key = 'water'; label = 'Hot water'; }
  else if (running && heatingOn) { key = 'heat'; label = 'Heating'; }
  else if (running) { key = 'other'; label = 'Running'; }
  return {
    key, label, kw, running, hotWater, heatingOn,
    heating: key === 'heat', flow: typeof flow === 'number' ? flow : null,
    tank: r.num(hp.tankTemp), today: r.num(hp.energyToday),
    legionella: !!hp.legionella && r.st(hp.legionella) === 'on',
  };
}

// The car from whichever source has heard from it (Bluetooth bridge first, then Tesla Fleet)
function carSummary(c, r) {
  const ev = c.ev || {};
  const sources = (ev.car && ev.car.sources) || [];
  if (!sources.length && !ev.power) return null;
  const heard = (src) => { const s = src.awake || src.asleep; return !s || !r.get(s) || r.available(s); };
  const pick = (key) => { for (const src of sources) { const id = src[key]; if (id && heard(src) && r.available(id)) return { id, src: src.name }; } return null; };
  const soc = pick('soc');
  const asleepE = pick('asleep'); const awakeE = pick('awake');
  const asleep = asleepE ? r.st(asleepE.id) === 'on' : awakeE ? r.st(awakeE.id) !== 'on' : null;
  const wc = r.num(ev.power) || 0;
  const plugged = r.st(ev.connected) === 'on' || (pick('cable') && r.st(pick('cable').id) === 'on');
  const limit = pick('limit');
  return {
    name: ev.name || 'Car',
    live: !!soc, via: soc ? soc.src : null,
    soc: soc ? r.num(soc.id) : null,
    limit: limit ? r.num(limit.id) : null,
    asleep, plugged: !!plugged, chargingKw: wc > 0.1 ? wc : null,
  };
}

function weatherNow(c, r) {
  const id = c.weather; if (!id || !r.get(id)) return null;
  const cond = r.st(id);
  if (!cond || UNKNOWN.has(cond)) return null;
  const words = {
    'clear-night': 'Clear', cloudy: 'Cloudy', exceptional: 'Unusual weather', fog: 'Fog', hail: 'Hail', lightning: 'Thunder',
    'lightning-rainy': 'Thunder and rain', partlycloudy: 'Partly cloudy', pouring: 'Heavy rain', rainy: 'Rain', snowy: 'Snow',
    'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy',
  };
  const t = r.attr(id, 'temperature');
  return { condition: cond, text: words[cond] || cond, temp: typeof t === 'number' ? t : null };
}

// The dashboard's Attention list, minus the bits that need the add-ons' own APIs
function attention(c, r, now = Date.now()) {
  const out = [];
  const e = c.energy || {};
  (e.alarms || []).filter((id) => r.available(id) && r.st(id) !== 'No Problem')
    .forEach((id) => out.push({ level: 'critical', text: `${r.attr(id, 'friendly_name') || id}: ${r.st(id)}` }));
  const v = c.vpp || {};
  if (v.inProgress && r.st(v.inProgress) === 'on') out.push({ level: 'warning', text: 'Axle VPP event running' });
  else if (v.later && r.st(v.later) === 'on') out.push({ level: 'info', text: 'Axle VPP event later today' });
  else if (v.tomorrow && r.st(v.tomorrow) === 'on') out.push({ level: 'info', text: 'Axle VPP event tomorrow' });
  const d = c.devices || {};
  const last = r.st(d.backupLast);
  if (last && now - Date.parse(last) > 8 * 864e5) out.push({ level: 'warning', text: 'No Home Assistant backup for over a week' });
  const hp = c.heatPump || {};
  if (hp.legionella && r.st(hp.legionella) === 'on') out.push({ level: 'info', text: 'Legionella cycle running' });
  const db = c.doorbell || {};
  if (db.ringing && r.st(db.ringing) === 'on') out.push({ level: 'warning', text: 'Someone is at the door' });
  (d.sensorBatteries || []).forEach((id) => {
    const b = r.num(id);
    if (b != null && b < 15) out.push({ level: 'warning', text: `${r.attr(id, 'friendly_name') || id} is at ${Math.round(b)}%` });
  });
  return out;
}

function today(c, r) {
  const e = c.energy || {};
  const vals = { pv: r.num(e.pvToday), load: r.num(e.loadToday), bought: r.num(e.importToday), sold: r.num(e.exportToday) };
  return Object.values(vals).some((x) => x != null) ? vals : null;
}

// Robot vacuum, only while it's out cleaning (as on the dashboard's Home page)
function vacuum(c, r) {
  const id = (c.vacuum && c.vacuum.entity) || r.ids().find((x) => x.startsWith('vacuum.'));
  if (!id || !r.get(id)) return null;
  const s = r.st(id);
  if (!['cleaning', 'returning', 'error'].includes(s)) return null;
  return { state: s, battery: r.attr(id, 'battery_level') ?? null };
}

module.exports = { reader, heatPumpMode, carSummary, weatherNow, attention, today, vacuum };
