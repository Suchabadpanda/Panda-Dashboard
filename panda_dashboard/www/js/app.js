/* Bootstrap: header, navigation, settings, event wiring, refresh loop. */
window.HD = window.HD || {};

(function () {
  const { esc, icon } = HD.u;
  const S = HD.store;
  const VIEWS = ['home', 'rooms', 'energy', 'car', 'devices'];
  const ALIASES = { plan: 'rooms', climate: 'rooms' }; // old bookmarks
  let current = null;

  const WEATHER_WORDS = {
    'clear-night': 'Clear', cloudy: 'Cloudy', fog: 'Fog', hail: 'Hail', lightning: 'Thunder', 'lightning-rainy': 'Thunderstorms',
    partlycloudy: 'Partly cloudy', pouring: 'Heavy rain', rainy: 'Rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy',
  };

  function headerHtml() {
    const now = new Date();
    const w = S.get(HD.config.weather);
    return `
      <div class="clock"><time>${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
        <span>${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      ${w ? `<div class="weather"><strong>${Math.round(w.attributes.temperature)}°</strong><span>${esc(WEATHER_WORDS[w.state] || w.state)} · wind ${Math.round(w.attributes.wind_speed || 0)} ${esc(w.attributes.wind_speed_unit || '')}</span></div>` : ''}`;
  }

  function statusHtml() {
    return `<button class="status ${S.mode}" id="open-settings" title="${esc(S.message)}">${icon('cog')}<span>${esc(S.mode === 'live' ? 'Live' : S.mode === 'demo' ? 'Demo' : S.mode === 'error' ? 'Offline' : 'Connecting')}</span></button>`;
  }

  function renderHeader() {
    document.getElementById('top').innerHTML = headerHtml();
    document.getElementById('status-slot').innerHTML = statusHtml();
  }

  function navHtml() {
    return VIEWS.map((v) => `<a href="#${v}" class="${v === current ? 'active' : ''}" ${v === current ? 'aria-current="page"' : ''}>${HD.views[v].title}</a>`).join('');
  }

  function show(name) {
    name = ALIASES[name] || name;
    if (!VIEWS.includes(name)) name = 'home';
    current = name;
    document.getElementById('nav').innerHTML = navHtml();
    HD.views[name].mount(document.getElementById('view'));
  }

  let pendingUpdate = false;
  function scheduleUpdate() {
    if (pendingUpdate) return;
    pendingUpdate = true;
    requestAnimationFrame(() => setTimeout(() => {
      pendingUpdate = false;
      renderHeader();
      HD.views[current] && HD.views[current].update();
    }, 250));
  }

  // ── Settings dialog ──
  function openSettings() {
    const dlg = document.getElementById('settings');
    dlg.querySelector('#set-url').value = HD.ha.savedUrl();
    dlg.querySelector('#set-token').value = '';
    dlg.querySelector('#set-status').textContent = S.message;
    dlg.querySelector('#set-token').placeholder = HD.ha.hasToken() ? 'Saved — paste a new one to replace it' : 'Paste a long-lived access token';
    let theme = 'auto'; try { theme = localStorage.getItem('hd.theme') || 'auto'; } catch (e) { /* ignore */ }
    dlg.querySelector(`input[name="theme"][value="${theme}"]`).checked = true;
    renderTariffEditor(HD.config.tariffs);
    dlg.querySelector('#tariff-name').value = HD.config.tariffName || '';
    dlg.showModal();
  }

  // ── Tariff editor ──
  // Rows are edited in pence and whole hours; saved as £/kWh like the add-on options.
  const pen = (v) => (v == null ? '' : parseFloat((v * 100).toFixed(3)));
  function renderTariffEditor(rows) {
    const box = document.getElementById('set-tariff');
    box.innerHTML = `<table class="tariff-edit"><thead><tr><th>From</th><th>Cheap p</th><th>Cheap from</th><th>to</th><th>Peak p</th><th>Export p</th><th>Standing p/day</th><th></th></tr></thead><tbody>${
      rows.map((t, i) => `<tr data-row="${i}">
        <td><input type="date" name="from" value="${esc(t.from)}" required aria-label="Applies from"></td>
        <td><input type="number" name="offPeak" step="0.01" min="0" value="${pen(t.offPeak)}" aria-label="Cheap rate, pence per kWh"></td>
        <td><input type="number" name="offPeakStart" step="1" min="0" max="23" value="${t.offPeakStart}" aria-label="Cheap rate starts, hour"></td>
        <td><input type="number" name="offPeakEnd" step="1" min="0" max="24" value="${t.offPeakEnd}" aria-label="Cheap rate ends, hour"></td>
        <td><input type="number" name="peak" step="0.01" min="0" value="${pen(t.peak)}" aria-label="Peak rate, pence per kWh"></td>
        <td><input type="number" name="export" step="0.01" min="0" value="${pen(t.export)}" aria-label="Export rate, pence per kWh"></td>
        <td><input type="number" name="standing" step="0.01" min="0" value="${pen(t.standing)}" aria-label="Standing charge, pence per day"></td>
        <td>${rows.length > 1 ? `<button type="button" class="row-del" data-del="${i}" aria-label="Remove this row">×</button>` : ''}</td>
      </tr>`).join('')}</tbody></table>`;
    const where = document.getElementById('set-tariff-where');
    where.textContent = 'Each row applies from its date until the next row. When your rates change, add a row instead of editing the old one, so past months keep the prices you paid.';
  }

  function readTariffEditor() {
    const rows = [...document.querySelectorAll('#set-tariff tbody tr')].map((tr) => {
      const v = (n) => tr.querySelector(`[name="${n}"]`).value;
      return {
        from: v('from'), offPeak: +v('offPeak') / 100, peak: +v('peak') / 100, export: +v('export') / 100,
        standing: +v('standing') / 100, offPeakStart: parseInt(v('offPeakStart'), 10), offPeakEnd: parseInt(v('offPeakEnd'), 10),
      };
    });
    const bad = rows.find((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.from) || [r.offPeak, r.peak, r.export, r.standing].some((x) => !Number.isFinite(x) || x < 0)
      || !(r.offPeakStart >= 0 && r.offPeakStart <= 23) || !(r.offPeakEnd >= 0 && r.offPeakEnd <= 24));
    if (bad) throw new Error('Check every row has a date, rates of 0 or more, and hours between 0 and 24.');
    const dates = rows.map((r) => r.from);
    if (new Set(dates).size !== dates.length) throw new Error('Two rows start on the same date.');
    return rows.sort((x, y) => x.from.localeCompare(y.from));
  }

  async function addonSlug() {
    const res = await HD.ha.callWS({ type: 'supervisor/api', endpoint: '/addons', method: 'get' });
    const a = (res.addons || []).find((x) => /(^|_)panda_dashboard$/.test(x.slug));
    return a && a.slug;
  }

  async function saveTariff() {
    const where = document.getElementById('set-tariff-where');
    let rows;
    try { rows = readTariffEditor(); } catch (e) { where.textContent = e.message; return; }
    const name = document.getElementById('tariff-name').value.trim();
    HD.config.tariffs = rows; HD.config.tariffName = name;
    renderTariffEditor(rows);
    let saved = 'in this browser';
    if (S.mode === 'live') {
      try {
        const slug = await addonSlug();
        if (slug) {
          await HD.ha.callWS({
            type: 'supervisor/api', endpoint: `/addons/${slug}/options`, method: 'post',
            data: { options: { tariff_name: name, tariffs: rows.map((t) => ({ from: t.from, off_peak: +t.offPeak.toFixed(5), peak: +t.peak.toFixed(5), export: +t.export.toFixed(5), standing: +t.standing.toFixed(5), off_peak_start: t.offPeakStart, off_peak_end: t.offPeakEnd })) } },
          });
          saved = 'in Home Assistant';
          HD.config.tariffSource = 'add-on Configuration tab';
        }
      } catch (e) { console.warn('Could not save to the add-on', e); }
    }
    if (saved !== 'in Home Assistant') { try { localStorage.setItem('hd.tariffs', JSON.stringify({ name, rows })); } catch (e) { /* ignore */ } }
    where.textContent = `Saved ${saved}${saved === 'in this browser' ? ' only — other devices keep their own rates' : ', for every device'}.`;
    toast(`Tariff saved ${saved}`);
    HD.data.refresh();
    scheduleUpdate();
  }

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  function wireEvents() {
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-toggle],[data-hvac],[data-press],#open-settings');
      if (!t || t.disabled) return;
      if (t.id === 'open-settings') return openSettings();
      if (t.dataset.toggle) {
        t.classList.toggle('on'); // optimistic
        HD.ha.toggle(t.dataset.toggle).catch((e) => toast(`Couldn't switch that: ${e.message}`));
      } else if (t.dataset.hvac) {
        HD.ha.callService('climate', 'set_hvac_mode', { entity_id: t.dataset.hvac, hvac_mode: t.dataset.mode }).catch((e) => toast(e.message));
      } else if (t.dataset.press) {
        HD.ha.callService('button', 'press', { entity_id: t.dataset.press }).then(() => toast('Wake signal sent')).catch((e) => toast(e.message));
      }
    });

    const dlg = document.getElementById('settings');
    dlg.querySelector('form').addEventListener('submit', async (ev) => {
      if (ev.submitter && ev.submitter.value === 'cancel') return;
      ev.preventDefault();
      const url = dlg.querySelector('#set-url').value;
      const token = dlg.querySelector('#set-token').value;
      const theme = dlg.querySelector('input[name="theme"]:checked').value;
      try { localStorage.setItem('hd.theme', theme); } catch (e) { /* ignore */ }
      applyTheme(theme);
      if (token || url !== HD.ha.savedUrl()) {
        HD.ha.saveCredentials(url, token || (HD.ha.hasToken() ? localStorage.getItem('hd.token') : ''));
        dlg.querySelector('#set-status').textContent = 'Connecting…';
        location.reload();
        return;
      }
      dlg.close();
    });
    dlg.querySelector('#tariff-add').addEventListener('click', () => {
      let rows; try { rows = readTariffEditor(); } catch (e) { rows = HD.config.tariffs; }
      const lastRow = rows[rows.length - 1] || { offPeak: 0.076, peak: 0.2666, export: 0.165, standing: 0.6, offPeakStart: 0, offPeakEnd: 6 };
      renderTariffEditor([...rows, { ...lastRow, from: new Date().toISOString().slice(0, 10) }]);
    });
    dlg.querySelector('#set-tariff').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-del]'); if (!b) return;
      let rows; try { rows = readTariffEditor(); } catch (e) { rows = HD.config.tariffs; }
      rows.splice(+b.dataset.del, 1); renderTariffEditor(rows);
    });
    dlg.querySelector('#tariff-save').addEventListener('click', saveTariff);
    dlg.querySelector('#set-forget').addEventListener('click', () => { HD.ha.saveCredentials('', ''); location.reload(); });
    dlg.querySelector('#set-demo').addEventListener('click', () => { location.href = `${location.pathname}?demo#${current}`; });

    window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  }

  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(el._t); el._t = setTimeout(() => { el.hidden = true; }, 4000);
  }

  async function keepAwake() {
    if (!new URLSearchParams(location.search).has('kiosk') || !navigator.wakeLock) return;
    try { await navigator.wakeLock.request('screen'); } catch (e) { /* user gesture may be required */ }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {}); });
  }

  // Tariffs set in the add-on's Configuration tab replace the ones in config.js
  async function loadAddonOptions() {
    try {
      const r = await fetch('options.json', { cache: 'no-store' });
      if (!r.ok) return;
      const o = await r.json();
      if (Array.isArray(o.tariffs) && o.tariffs.length) {
        HD.config.tariffs = o.tariffs
          .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.from))
          .map((t) => ({ from: t.from, offPeak: +t.off_peak, peak: +t.peak, export: +t.export, standing: +t.standing, offPeakStart: +t.off_peak_start, offPeakEnd: +t.off_peak_end }))
          .sort((x, y) => x.from.localeCompare(y.from));
        HD.config.tariffSource = 'add-on Configuration tab';
      }
      if (o.tariff_name) HD.config.tariffName = o.tariff_name;
    } catch (e) { /* not running as the add-on */ }
    if (!HD.config.tariffSource) {
      try {
        const saved = JSON.parse(localStorage.getItem('hd.tariffs') || 'null');
        if (saved && Array.isArray(saved.rows) && saved.rows.length) { HD.config.tariffs = saved.rows; if (saved.name) HD.config.tariffName = saved.name; HD.config.tariffSource = 'this browser'; }
      } catch (e) { /* ignore */ }
    }
  }

  async function start() {
    try { applyTheme(localStorage.getItem('hd.theme') || 'auto'); } catch (e) { /* ignore */ }
    document.title = HD.config.title;
    wireEvents();
    await loadAddonOptions();
    S.on(scheduleUpdate);
    HD.data.on(() => { const v = HD.views[current]; if (v && v.redraw) v.redraw(); scheduleUpdate(); });

    const params = new URLSearchParams(location.search);
    let live = false;
    if (!params.has('demo') && !window.HD_FORCE_DEMO) live = await HD.ha.connect();
    if (!live) {
      const why = S.mode === 'error' ? S.message : '';
      HD.demo.start();
      if (why) toast(`${why} Showing the demo snapshot.`);
    }
    renderHeader();
    show(location.hash.slice(1) || 'home');
    HD.data.refresh();
    if (HD.doorbell) HD.doorbell.init();
    setInterval(() => HD.data.refresh(), 5 * 60 * 1000);
    setInterval(renderHeader, 20 * 1000);
    keepAwake();
  }

  HD.app = { start, toast };
  document.addEventListener('DOMContentLoaded', start);
})();
