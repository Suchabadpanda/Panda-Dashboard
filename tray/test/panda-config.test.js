'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const panda = require('../src/panda-config');

test('evaluates the dashboard example config.js', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', 'panda_dashboard', 'www', 'js', 'config.js'), 'utf8');
  const c = panda.evaluate(code);
  assert.ok(c.energy && c.energy.soc);
  assert.ok(Array.isArray(c.shortcuts) && c.shortcuts.length >= 1);
  assert.ok(Array.isArray(c.tariffs) && c.tariffs.length >= 1);
});

test('config.js cannot reach Node', () => {
  assert.throws(() => panda.evaluate("require('fs'); window.HD = { config: {} };"));
  assert.throws(() => panda.evaluate('while (true) {}'), /timed out/i);
});

test('shipped default options count as never saved', () => {
  assert.equal(panda.tariffsFrom({ tariff_name: '', tariffs: [{ from: '2025-10-29', off_peak: 0.076, peak: 0.2666, export: 0.165, standing: 0.6, off_peak_start: 0, off_peak_end: 6 }] }), null);
  const saved = panda.tariffsFrom({ tariff_name: 'E.ON', tariffs: [{ from: '2026-01-01', off_peak: 0.08, peak: 0.28, export: 0.15, standing: 0.62, off_peak_start: 0, off_peak_end: 6 }] });
  assert.deepEqual(saved, [{ from: '2026-01-01', offPeak: 0.08, peak: 0.28, export: 0.15, standing: 0.62, offPeakStart: 0, offPeakEnd: 6 }]);
});

test('rate now and the next switch', () => {
  const tariffs = [{ from: '2025-10-29', offPeak: 0.076, peak: 0.2666, export: 0.165, standing: 0.6, offPeakStart: 0, offPeakEnd: 6 }];
  const night = panda.rateNow(tariffs, new Date(2026, 9, 19, 3, 15));
  assert.equal(night.offPeak, true); assert.equal(night.rate, 0.076);
  assert.equal(new Date(night.until).getHours(), 6);
  const day = panda.rateNow(tariffs, new Date(2026, 9, 19, 15, 0));
  assert.equal(day.offPeak, false); assert.equal(day.rate, 0.2666);
  const u = new Date(day.until); assert.equal(u.getHours(), 0); assert.equal(u.getDate(), 20);
  // A window that crosses midnight
  const wrap = [{ ...tariffs[0], offPeakStart: 23, offPeakEnd: 5 }];
  assert.equal(panda.rateNow(wrap, new Date(2026, 9, 19, 23, 30)).offPeak, true);
  assert.equal(panda.rateNow(wrap, new Date(2026, 9, 19, 12, 0)).offPeak, false);
});
