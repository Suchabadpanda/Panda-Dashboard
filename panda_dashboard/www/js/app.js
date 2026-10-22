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
      <div class="clock"><time>${HD.u.time(now)}</time>
        <span>${HD.u.fmt(now, { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      ${w ? `<div class="weather"><strong>${Math.round(w.attributes.temperature)}°</strong><span>${esc(WEATHER_WORDS[w.state] || w.state)} · wind ${Math.round(w.attributes.wind_speed || 0)} ${esc(w.attributes.wind_speed_unit || '')}</span></div>` : ''}`;
  }

  function statusHtml() {
    return `<button class="status ${S.mode}" id="open-settings" title="${esc(S.message)}">${icon('cog')}<span>${esc(S.mode === 'live' ? 'Live' : S.mode === 'demo' ? 'Demo' : S.mode === 'error' ? 'Offline' : 'Connecting')}</span></button>`;
  }

  function renderHeader() {
    HD.u.setHTML(document.getElementById('top'), headerHtml());
    HD.u.setHTML(document.getElementById('status-slot'), statusHtml());
  }

  const NAV_ICONS = { home: 'house', rooms: 'rooms', energy: 'bolt', car: 'car', devices: 'plug' };
  function navHtml() {
    return VIEWS.map((v) => `<a href="#${v}" class="${v === current ? 'active' : ''}" ${v === current ? 'aria-current="page"' : ''}>${HD.u.icon(NAV_ICONS[v])}<span>${HD.views[v].title}</span></a>`).join('');
  }

  function show(name) {
    name = ALIASES[name] || name;
    if (!VIEWS.includes(name)) name = 'home';
    const changed = current !== name;
    current = name;
    document.body.dataset.view = name;
    document.getElementById('nav').innerHTML = navHtml();
    const view = document.getElementById('view');
    // Panels rise in on a page change only (not on every live update)
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    clearTimeout(show.t); show.t = setTimeout(() => view.classList.remove('enter'), 900);
    HD.views[name].mount(view);
    if (changed) window.scrollTo({ top: 0 });
  }

  // Redraw at most once a second however many entities change; sensors like the
  // inverter's report every few seconds, and nothing on screen needs to be quicker.
  // While the page is hidden (a minimised tray window, a closed panel, the tablet asleep)
  // nothing is redrawn; the store keeps up and the page catches up when shown again.
  let pendingUpdate = false; let lastUpdate = 0; let missed = false;
  function scheduleUpdate() {
    if (document.hidden) { missed = true; return; }
    if (pendingUpdate) return;
    pendingUpdate = true;
    const wait = Math.max(0, lastUpdate + 1000 - Date.now());
    setTimeout(() => requestAnimationFrame(() => {
      pendingUpdate = false; lastUpdate = Date.now();
      renderHeader();
      HD.views[current] && HD.views[current].update();
    }), wait);
  }

  // ── Settings dialog ──
  function openSettings() {
    const dlg = document.getElementById('settings');
    dlg.querySelector('#set-url').value = HD.ha.savedUrl();
    dlg.querySelector('#set-token').value = '';
    dlg.querySelector('#set-status').textContent = S.message;
    dlg.querySelector('#set-token').placeholder = HD.ha.hasToken() ? 'Saved — paste a new one to replace it' : 'Paste a long-lived access token';
    const l = savedLook();
    dlg.querySelector(`input[name="theme"][value="${l.mode}"]`).checked = true;
    dlg.querySelector('#palettes').innerHTML = paletteHtml(l.palette);
    dlg.querySelector('#accent-on').checked = !!l.accent;
    dlg.querySelector('#accent').value = l.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8fb8ff';
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
    // Keep a copy in this browser too, as a fallback if Home Assistant can't be asked
    try { localStorage.setItem('hd.tariffs', JSON.stringify({ name, rows })); } catch (e) { /* ignore */ }
    where.textContent = `Saved ${saved}${saved === 'in this browser' ? ' only — other devices keep their own rates' : ', for every device'}.`;
    toast(`Tariff saved ${saved}`);
    HD.data.refresh();
    scheduleUpdate();
  }

  // ── Appearance: light/dark mode, a colour palette and an optional own accent ──
  // Each palette sets the surfaces and accent for dark and light; the energy colours
  // (solar, battery, grid…) stay the same in every palette, since they carry meaning.
  // Choices are kept on this screen (localStorage hd.theme / hd.palette / hd.accent);
  // config.theme = { mode, palette, accent } sets the default for screens with no choice.
  const PALETTES = {
    slate: { name: 'Slate', dark: {}, light: {} },
    midnight: { name: 'Midnight', dark: { bg: '#0d1117', panel: '#161b22', room: '#1f2630', line: '#2d3743', accent: '#7aa2ff' },
      light: { bg: '#eef1f6', panel: '#ffffff', room: '#f3f5f9', line: '#d5dbe5', accent: '#3b5bdb' } },
    ocean: { name: 'Ocean', dark: { bg: '#0f2027', panel: '#14303a', room: '#1a3c48', line: '#275262', accent: '#4fd1c5' },
      light: { bg: '#e6f2f3', panel: '#ffffff', room: '#eef7f8', line: '#c9e0e3', accent: '#0f7c80' } },
    forest: { name: 'Forest', dark: { bg: '#141c17', panel: '#1b2620', room: '#233229', line: '#304437', accent: '#7bd88f' },
      light: { bg: '#ecf1ec', panel: '#ffffff', room: '#f2f6f2', line: '#d2ded4', accent: '#2f7d45' } },
    plum: { name: 'Plum', dark: { bg: '#1b1622', panel: '#251e2f', room: '#2f263c', line: '#3f3350', accent: '#c7a0ff' },
      light: { bg: '#f1edf5', panel: '#ffffff', room: '#f6f2fa', line: '#ddd3e8', accent: '#6b3fb5' } },
    ember: { name: 'Ember', dark: { bg: '#1e1714', panel: '#29201b', room: '#342923', line: '#463830', accent: '#ffb37a' },
      light: { bg: '#f5efe9', panel: '#ffffff', room: '#faf5f0', line: '#e5d8cb', accent: '#b5541f' } },
    graphite: { name: 'Graphite', dark: { bg: '#141414', panel: '#1f1f1f', room: '#292929', line: '#3a3a3a', accent: '#d0d0d0' },
      light: { bg: '#ececec', panel: '#ffffff', room: '#f4f4f4', line: '#d6d6d6', accent: '#3d3d3d' } },
  };
  // The stylesheet's own colours (Slate), for drawing its swatch
  const SLATE = { dark: { bg: '#17212c', panel: '#1f2b38', accent: '#8fb8ff' }, light: { bg: '#e9eef3', panel: '#ffffff', accent: '#2a5fbf' } };
  const VARS = ['bg', 'panel', 'room', 'line', 'accent'];
  const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
  function savedLook() {
    const d = HD.config.theme || {};
    return { mode: ls('hd.theme') || d.mode || 'auto', palette: ls('hd.palette') || d.palette || 'slate', accent: ls('hd.accent') ?? (d.accent || '') };
  }
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let look = null;
  function applyLook(l) {
    look = l;
    const root = document.documentElement;
    if (l.mode === 'light' || l.mode === 'dark') root.dataset.theme = l.mode; else delete root.dataset.theme;
    const dark = l.mode === 'dark' || (l.mode !== 'light' && (!darkQuery || darkQuery.matches));
    const pal = (PALETTES[l.palette] || PALETTES.slate)[dark ? 'dark' : 'light'];
    VARS.forEach((v) => { if (pal[v]) root.style.setProperty(`--${v}`, pal[v]); else root.style.removeProperty(`--${v}`); });
    if (l.accent) root.style.setProperty('--accent', l.accent);
    root.dataset.palette = l.palette;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || meta.content;
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => look && applyLook(look));

  // Settings: swatches showing each palette's surfaces and accent in the current mode
  function paletteHtml(sel) {
    const dark = document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && (!darkQuery || darkQuery.matches));
    return Object.entries(PALETTES).map(([id, p]) => {
      const c = { ...SLATE[dark ? 'dark' : 'light'], ...p[dark ? 'dark' : 'light'] };
      const { bg, panel, accent } = c;
      return `<label class="swatch ${sel === id ? 'on' : ''}" style="--sw-bg:${bg};--sw-panel:${panel};--sw-accent:${accent}">
        <input type="radio" name="palette" value="${id}" ${sel === id ? 'checked' : ''}><i></i><span>${p.name}</span></label>`;
    }).join('');
  }
  function formLook(dlg) {
    return {
      mode: dlg.querySelector('input[name="theme"]:checked').value,
      palette: (dlg.querySelector('input[name="palette"]:checked') || {}).value || 'slate',
      accent: dlg.querySelector('#accent-on').checked ? dlg.querySelector('#accent').value : '',
    };
  }

  function wireEvents() {
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-toggle],[data-hvac],[data-press],#open-settings');
      if (!t || t.disabled) return;
      if (t.id === 'open-settings') return openSettings();
      if (t.dataset.toggle) {
        t.classList.toggle('on'); // optimistic
        HD.ha.toggle(t.dataset.toggle).catch((e) => { toast(`Couldn't switch that: ${e.message}`); HD.u.invalidate(); scheduleUpdate(); });
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
      const l = formLook(dlg);
      lsSet('hd.theme', l.mode); lsSet('hd.palette', l.palette); lsSet('hd.accent', l.accent || null);
      applyLook(l);
      if (token || url !== HD.ha.savedUrl()) {
        HD.ha.saveCredentials(url, token || (HD.ha.hasToken() ? localStorage.getItem('hd.token') : ''));
        dlg.querySelector('#set-status').textContent = 'Connecting…';
        location.reload();
        return;
      }
      dlg.close();
    });
    // Live preview of mode, palette and accent; closing without saving puts them back
    const preview = () => {
      applyLook(formLook(dlg));
      const sel = formLook(dlg).palette;
      dlg.querySelector('#palettes').innerHTML = paletteHtml(sel);
      if (!dlg.querySelector('#accent-on').checked) dlg.querySelector('#accent').value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    };
    dlg.addEventListener('change', (ev) => { if (ev.target.matches('input[name="theme"], input[name="palette"], #accent-on')) preview(); });
    dlg.querySelector('#accent').addEventListener('input', () => { dlg.querySelector('#accent-on').checked = true; applyLook(formLook(dlg)); });
    dlg.addEventListener('close', () => applyLook(savedLook()));
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
  // ── Tariffs: where saved rates live ──
  // Rates saved from the dashboard go into the add-on's options (Supervisor keeps those
  // across updates). They're read back over the Home Assistant connection; options.json
  // and this browser's copy are fallbacks. Options still at the add-on's shipped
  // default count as "never saved", so config.js's own rows are kept.
  const SHIPPED = JSON.stringify([{ from: '2025-10-29', off_peak: 0.076, peak: 0.2666, export: 0.165, standing: 0.6, off_peak_start: 0, off_peak_end: 6 }]);
  function applyOptions(o, source) {
    if (!o || !Array.isArray(o.tariffs) || !o.tariffs.length) return false;
    const norm = JSON.stringify(o.tariffs.map((t) => ({ from: t.from, off_peak: +t.off_peak, peak: +t.peak, export: +t.export, standing: +t.standing, off_peak_start: +t.off_peak_start, off_peak_end: +t.off_peak_end })));
    if (norm === SHIPPED && !o.tariff_name) return false;
    HD.config.tariffs = o.tariffs
      .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.from))
      .map((t) => ({ from: t.from, offPeak: +t.off_peak, peak: +t.peak, export: +t.export, standing: +t.standing, offPeakStart: +t.off_peak_start, offPeakEnd: +t.off_peak_end }))
      .sort((x, y) => x.from.localeCompare(y.from));
    if (o.tariff_name) HD.config.tariffName = o.tariff_name;
    HD.config.tariffSource = source;
    return true;
  }
  function applyBrowserCopy() {
    try {
      const saved = JSON.parse(localStorage.getItem('hd.tariffs') || 'null');
      if (saved && Array.isArray(saved.rows) && saved.rows.length) {
        HD.config.tariffs = saved.rows; if (saved.name) HD.config.tariffName = saved.name;
        HD.config.tariffSource = 'this browser';
        return true;
      }
    } catch (e) { /* storage blocked */ }
    return false;
  }
  // Before connecting: options.json if the add-on serves it, else this browser's copy
  async function loadAddonOptions() {
    try {
      const r = await fetch('options.json', { cache: 'no-store' });
      if (r.ok && applyOptions(await r.json(), 'add-on Configuration tab')) return;
    } catch (e) { /* not running as the add-on */ }
    applyBrowserCopy();
  }
  // Once connected: the add-on's options straight from the Supervisor (always current)
  async function loadSupervisorOptions() {
    try {
      const slug = await addonSlug(); if (!slug) return false;
      const info = await HD.ha.callWS({ type: 'supervisor/api', endpoint: `/addons/${slug}/info`, method: 'get' });
      return applyOptions(info && info.options, 'add-on Configuration tab');
    } catch (e) { return false; }   // not an admin, or not running under Supervisor
  }

  async function start() {
    applyLook(savedLook());
    document.title = HD.config.title;
    wireEvents();
    await loadAddonOptions();
    S.on(scheduleUpdate);
    HD.data.on(() => { const v = HD.views[current]; if (v && v.redraw) v.redraw(); scheduleUpdate(); });

    const params = new URLSearchParams(location.search);
    let live = false;
    if (!params.has('demo') && !window.HD_FORCE_DEMO) live = await HD.ha.connect();
    if (live) await loadSupervisorOptions();
    if (!live) {
      const why = S.mode === 'error' ? S.message : '';
      // The demo snapshot is only fetched when it's needed
      if (!HD.demo) await new Promise((ok, fail) => { const sc = document.createElement('script'); sc.src = 'js/demo.js'; sc.onload = ok; sc.onerror = () => fail(new Error('demo data missing')); document.head.appendChild(sc); });
      HD.demo.start();
      if (why) toast(`${why} Showing the demo snapshot.`);
    }
    renderHeader();
    show(location.hash.slice(1) || 'home');
    HD.data.refresh();
    if (HD.doorbell) HD.doorbell.init();
    if (HD.tracker) HD.tracker.init();
    let dataAt = Date.now();
    const refreshData = () => { if (document.hidden) return; dataAt = Date.now(); HD.data.refresh(); };
    setInterval(refreshData, 5 * 60 * 1000);
    setInterval(() => { if (!document.hidden) renderHeader(); }, 20 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (Date.now() - dataAt > 5 * 60 * 1000) refreshData();
      if (missed) { missed = false; HD.u.invalidate(); scheduleUpdate(); }
    });
    keepAwake();
  }

  HD.app = { start, toast, refresh: () => { const v = HD.views[current]; if (v) v.update(); } };
  document.addEventListener('DOMContentLoaded', start);
})();
