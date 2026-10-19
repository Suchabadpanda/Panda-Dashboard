'use strict';
/*
 * Reads Panda Dashboard's own settings from Home Assistant, so the tray app uses the
 * same entities, shortcuts and tariffs as the dashboard without being set up twice.
 *
 *   1. find the Panda Dashboard add-on (Supervisor API over the WebSocket)
 *   2. open an ingress session and fetch its config.js (your personal one from the
 *      add-on's config folder, else the example that ships with it)
 *   3. run config.js in a sandbox to get HD.config
 *   4. take tariffs saved from the dashboard (the add-on's options) over config.js's
 */
const http = require('node:http');
const https = require('node:https');
const vm = require('node:vm');

// The add-on's shipped default options: these mean "never saved", so config.js's rows win
const SHIPPED = JSON.stringify([{ from: '2025-10-29', off_peak: 0.076, peak: 0.2666, export: 0.165, standing: 0.6, off_peak_start: 0, off_peak_end: 6 }]);

function get(url, headers) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers, timeout: 15000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

function evaluate(code) {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { timeout: 1000, filename: 'config.js' });
  if (!ctx.HD || !ctx.HD.config) throw new Error('config.js did not set HD.config');
  // Plain data only from here on
  return JSON.parse(JSON.stringify(ctx.HD.config));
}

function tariffsFrom(options) {
  if (!options || !Array.isArray(options.tariffs) || !options.tariffs.length) return null;
  const norm = JSON.stringify(options.tariffs.map((t) => ({ from: t.from, off_peak: +t.off_peak, peak: +t.peak, export: +t.export, standing: +t.standing, off_peak_start: +t.off_peak_start, off_peak_end: +t.off_peak_end })));
  if (norm === SHIPPED && !options.tariff_name) return null;
  return options.tariffs
    .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.from))
    .map((t) => ({ from: t.from, offPeak: +t.off_peak, peak: +t.peak, export: +t.export, standing: +t.standing, offPeakStart: +t.off_peak_start, offPeakEnd: +t.off_peak_end }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

async function load(ha, baseUrl) {
  const supervisor = (endpoint, method = 'get', data) => ha.call({ type: 'supervisor/api', endpoint, method, ...(data ? { data } : {}) });
  const list = await supervisor('/addons');
  const addon = (list.addons || []).find((a) => /(^|_)panda_dashboard$/.test(a.slug));
  if (!addon) throw new Error('Panda Dashboard add-on not found in Home Assistant');
  const info = await supervisor(`/addons/${addon.slug}/info`);
  const entry = (info.ingress_entry || '').replace(/\/$/, '');
  const { session } = await supervisor('/ingress/session', 'post');
  const headers = { Cookie: `ingress_session=${session}` };

  let res = await get(`${baseUrl}${entry}/data/config.js?t=${Date.now()}`, headers);
  let personal = true;
  if (res.status !== 200) { res = await get(`${baseUrl}${entry}/js/config.js`, headers); personal = false; }
  if (res.status !== 200) throw new Error(`couldn't read the dashboard's settings (HTTP ${res.status})`);

  const config = evaluate(res.body);
  const saved = tariffsFrom(info.options);
  if (saved) { config.tariffs = saved; if (info.options.tariff_name) config.tariffName = info.options.tariff_name; }
  return { config, slug: addon.slug, panelUrl: `${baseUrl}/${addon.slug}`, personal, tariffSource: saved ? 'dashboard' : 'config.js' };
}

// ── Tariff maths (same rules as the dashboard's tariff.js) ──
function tariffAt(tariffs, when = new Date()) {
  if (!tariffs || !tariffs.length) return null;
  let t = tariffs[0];
  tariffs.forEach((row) => { if (when >= new Date(`${row.from}T00:00:00`)) t = row; });
  return t;
}
function isOffPeak(t, when = new Date()) {
  const h = when.getHours();
  return t.offPeakStart <= t.offPeakEnd ? h >= t.offPeakStart && h < t.offPeakEnd : h >= t.offPeakStart || h < t.offPeakEnd;
}
function rateNow(tariffs, when = new Date()) {
  const t = tariffAt(tariffs, when); if (!t) return null;
  const off = isOffPeak(t, when);
  // Next switch: the start or end of the cheap window
  const next = new Date(when); next.setMinutes(0, 0, 0);
  const target = off ? t.offPeakEnd : t.offPeakStart;
  next.setHours(target);
  if (next <= when) next.setDate(next.getDate() + 1);
  return { offPeak: off, rate: off ? t.offPeak : t.peak, export: t.export, until: next.getTime(), tariff: t };
}

module.exports = { load, evaluate, tariffsFrom, tariffAt, isOffPeak, rateNow };
