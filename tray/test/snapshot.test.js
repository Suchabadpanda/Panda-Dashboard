'use strict';
const test = require('node:test');
const assert = require('node:assert');
const view = require('../src/snapshot');

const config = {
  heatPump: { power: 'sensor.hp', runningAbove: 0.3, waterHeater: 'water_heater.hp', climate: 'climate.hp', tankTemp: 'sensor.tank' },
  ev: { name: 'EV', power: 'sensor.wc', connected: 'binary_sensor.wc',
    car: { sources: [
      { name: 'Bluetooth', soc: 'sensor.ble_soc', asleep: 'binary_sensor.ble_asleep' },
      { name: 'Tesla Fleet', soc: 'sensor.fleet_soc', awake: 'binary_sensor.fleet_status', trunk: 'cover.fleet_boot' },
    ] } },
  weather: 'weather.home',
};
const S = (state, attributes = {}) => ({ state, attributes });

test('heat pump: heating, hot water, both, resting', () => {
  const base = { 'sensor.hp': S('1.1'), 'climate.hp': S('heat', { current_temperature: 33 }), 'water_heater.hp': S('off'), 'sensor.tank': S('45') };
  assert.equal(view.heatPumpMode(config, view.reader(base)).key, 'heat');
  assert.equal(view.heatPumpMode(config, view.reader({ ...base, 'water_heater.hp': S('heat_pump') })).key, 'both');
  assert.equal(view.heatPumpMode(config, view.reader({ ...base, 'water_heater.hp': S('heat_pump'), 'climate.hp': S('off') })).key, 'water');
  assert.equal(view.heatPumpMode(config, view.reader({ ...base, 'sensor.hp': S('0.2') })).key, 'rest');
  assert.equal(view.heatPumpMode(config, view.reader({ ...base, 'water_heater.hp': S('unavailable') })).key, 'heat');
  // SmartThings frozen mid-reheat: water heater and heating say off, but it's drawing 4.7 kW
  assert.equal(view.heatPumpMode(config, view.reader({ ...base, 'climate.hp': S('off'), 'sensor.hp': S('4.7') })).key, 'water');
  assert.equal(view.heatPumpMode(config, view.reader({ ...base, 'climate.hp': S('off'), 'sensor.hp': S('0.4') })).key, 'other');
});

test('heat pump: a car charging on the same smart-load port is taken off', () => {
  const c = { ...config, heatPump: { ...config.heatPump, subtract: ['sensor.wc'] } };
  // 31 Oct 00:28: port 6.348 kW, Wall Connector 6.24 kW, Samsung climate off
  const night = { 'sensor.hp': S('6.348'), 'sensor.wc': S('6.24'), 'climate.hp': S('off'), 'water_heater.hp': S('off') };
  const m = view.heatPumpMode(c, view.reader(night));
  assert.equal(m.key, 'rest');
  assert.ok(Math.abs(m.kw - 0.108) < 1e-9);
  // Car ramping down faster than the port reading: never below zero
  assert.equal(view.heatPumpMode(c, view.reader({ ...night, 'sensor.wc': S('7') })).kw, 0);
  // Wall Connector unavailable: nothing to take off
  assert.equal(view.heatPumpMode(c, view.reader({ ...night, 'sensor.hp': S('1.1'), 'climate.hp': S('heat'), 'sensor.wc': S('unavailable') })).key, 'heat');
  // A plain string works too
  assert.equal(view.heatPumpMode({ ...c, heatPump: { ...c.heatPump, subtract: 'sensor.wc' } }, view.reader(night)).key, 'rest');
});

test('car: a source that has not heard from the car does not count', () => {
  const states = {
    'sensor.ble_soc': S('unavailable'), 'binary_sensor.ble_asleep': S('unavailable'),
    'sensor.fleet_soc': S('unknown'), 'binary_sensor.fleet_status': S('unknown'), 'cover.fleet_boot': S('open'),
  };
  const c = view.carSummary(config, view.reader(states));
  assert.equal(c.live, false);
  const awake = view.carSummary(config, view.reader({ ...states, 'sensor.fleet_soc': S('79'), 'binary_sensor.fleet_status': S('off') }));
  assert.equal(awake.live, true); assert.equal(awake.soc, 79); assert.equal(awake.asleep, true); assert.equal(awake.via, 'Tesla Fleet');
});

test('weather in words', () => {
  const w = view.weatherNow(config, view.reader({ 'weather.home': S('rainy', { temperature: 11.3 }) }));
  assert.deepEqual(w, { condition: 'rainy', text: 'Rain', temp: 11.3 });
});
