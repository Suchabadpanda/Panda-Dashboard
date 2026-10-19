/* Bootstrap: header, navigation, settings, event wiring, refresh loop. */
window.HD = window.HD || {};

(function () {
  const { esc, icon } = HD.u;
  const S = HD.store;
  const VIEWS = ['home', 'energy', 'climate', 'car', 'devices'];
  let current = null;

  const WEATHER_WORDS = {
    'clear-night': 'Clear', cloudy: 'Cloudy', fog: 'Fog', hail: 'Hail', lightning: 'Thunder', 'lightning-rainy': 'Thunderstorms',
    partlycloudy: 'Partly cloudy', pouring: 'Heavy rain', rainy: 'Rain', snowy: 'Snow', 'snowy-rainy': 'Sleet', sunny: 'Sunny', windy: 'Windy', 'windy-variant': 'Windy',
  };

  function headerHtml() {
    const now = new Date();
    const w = S.get(HD.config.weather);
    const people = HD.config.people.map((p) => {
      const st = S.state(p.id);
      const home = st === 'home';
      return `<li class="${home ? 'home' : ''}" title="${esc(p.name)}: ${home ? 'home' : esc(st === 'not_home' ? 'away' : st || 'unknown')}"><span class="avatar">${esc(p.name[0])}</span>${esc(p.name)}<small>${home ? 'Home' : st === 'not_home' ? 'Away' : esc(st || '–')}</small></li>`;
    }).join('');
    return `
      <div class="clock"><time>${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
        <span>${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
      ${w ? `<div class="weather"><strong>${Math.round(w.attributes.temperature)}°</strong><span>${esc(WEATHER_WORDS[w.state] || w.state)} · wind ${Math.round(w.attributes.wind_speed || 0)} ${esc(w.attributes.wind_speed_unit || '')}</span></div>` : ''}
      <ul class="people">${people}</ul>`;
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
    const p = (v) => `${(v * 100).toFixed(2).replace(/\.?0+$/, '')}p`;
    const hh = (n) => `${String(n).padStart(2, '0')}:00`;
    dlg.querySelector('#set-tariff').innerHTML = `<table><thead><tr><th>From</th><th>Cheap</th><th>Window</th><th>Peak</th><th>Export</th><th>Standing</th></tr></thead><tbody>${
      HD.config.tariffs.map((t) => `<tr><td>${esc(t.from)}</td><td>${p(t.offPeak)}</td><td>${hh(t.offPeakStart)}–${hh(t.offPeakEnd)}</td><td>${p(t.peak)}</td><td>${p(t.export)}</td><td>${p(t.standing)}/day</td></tr>`).join('')}</tbody></table>`;
    dlg.querySelector('#set-tariff-where').textContent = HD.config.tariffSource
      ? 'Change these in Home Assistant: Settings → Add-ons → Panda Dashboard → Configuration. Add a row when a rate changes, then reload.'
      : 'Running outside the add-on: change these in config.js.';
    dlg.showModal();
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
