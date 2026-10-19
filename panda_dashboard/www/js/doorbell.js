/*
 * Doorbell (Eufy via the eufy_security integration):
 *  - front-door card with the latest picture, last ring / person, battery
 *  - full-screen alert when someone rings, on whichever view is open
 *  - live view on tap, using HA's own camera stream (HLS)
 * The S220 is battery powered, so live video only starts when asked for.
 */
window.HD = window.HD || {};

(function () {
  const { esc, ago, time, icon } = HD.u;
  const S = () => HD.store;
  const cfg = () => HD.config.doorbell;
  const last = { ring: null, person: null, motion: null };   // ms timestamps of the latest "on"
  let alertTimer = null;

  const enabled = () => !!(cfg() && cfg().camera && S().get(cfg().camera));

  function pictureUrl() {
    const c = cfg();
    const img = S().get(c.image);
    const cam = S().get(c.camera);
    const pick = img && img.state !== 'unknown' && img.attributes.entity_picture ? img : cam;
    const url = pick && pick.attributes.entity_picture;
    if (!url) return null;
    return `${HD.ha.baseUrl()}${url}${url.includes('?') ? '&' : '?'}v=${Date.parse(pick.last_changed) || 0}`;
  }

  // Latest "on" times from history, so restarts don't reset "last rang"
  async function loadHistory() {
    if (!enabled() || S().mode !== 'live') return;
    const c = cfg();
    const ids = [c.ringing, c.person, c.motion];
    try {
      const res = await HD.ha.callWS({
        type: 'history/history_during_period', start_time: new Date(Date.now() - 14 * 864e5).toISOString(),
        entity_ids: ids, minimal_response: true, no_attributes: true,
      });
      const lastOn = (id) => {
        const rows = (res && res[id]) || [];
        for (let i = rows.length - 1; i >= 0; i--) {
          const st = rows[i].s ?? rows[i].state;
          if (st === 'on') return (rows[i].lu ?? Date.parse(rows[i].last_updated) / 1000) * 1000;
        }
        return null;
      };
      last.ring = lastOn(c.ringing); last.person = lastOn(c.person); last.motion = lastOn(c.motion);
      HD.store.emit(null);
    } catch (e) { console.warn('Doorbell history unavailable', e); }
  }

  function since(ts, none) { return ts ? ago(new Date(ts).toISOString()) : none; }

  function cardHtml() {
    if (!enabled()) return '';
    const c = cfg();
    const pic = pictureUrl();
    const bat = S().num(c.battery);
    const low = bat != null && bat < (c.lowBattery || 20);
    const ringing = S().state(c.ringing) === 'on';
    const who = S().state(c.personName);
    return `
      <section class="now-block doorbell ${ringing ? 'ringing' : ''}">
        <h2>${esc(c.name || 'Front door')}</h2>
        <button class="door-pic" data-doorbell-live aria-label="Open live view of the ${esc(c.name || 'front door')}">
          ${pic ? `<img src="${esc(pic)}" alt="Latest picture from the doorbell" loading="lazy">` : '<span class="no-pic">No picture yet</span>'}
          <span class="live-chip">${icon('tv')}Live view</span>
        </button>
        <dl class="door-facts">
          <div><dt>Last ring</dt><dd>${ringing ? 'Ringing now' : since(last.ring, '–')}</dd></div>
          <div><dt>Last person</dt><dd>${S().state(c.person) === 'on' ? 'Now' : since(last.person, '–')}${who && who !== 'No Person' && who !== 'unknown' ? ` · ${esc(who)}` : ''}</dd></div>
          <div><dt>Battery</dt><dd class="${low ? 'warn' : ''}">${bat == null ? '–' : `${Math.round(bat)}%`}</dd></div>
          <div><dt>Mode</dt><dd>${esc(S().state(c.guardMode) || '–')}</dd></div>
        </dl>
      </section>`;
  }

  function alerts() {
    if (!enabled()) return [];
    const c = cfg(); const out = [];
    const bat = S().num(c.battery);
    if (bat != null && bat < (c.lowBattery || 20)) out.push(['alert', `Doorbell battery at ${Math.round(bat)}% — time to charge it`, 'warning']);
    if (S().state(c.baseConnected) === 'off') out.push(['alert', 'Eufy HomeBase is disconnected', 'critical']);
    return out;
  }

  // ── Ring alert ──
  function showRing() {
    const el = document.getElementById('doorbell-alert');
    const c = cfg();
    el.innerHTML = `
      <div class="ring-card" role="alertdialog" aria-labelledby="ring-title">
        <p id="ring-title" class="ring-title">${icon('alert')}Someone's at the ${esc((c.name || 'front door').toLowerCase())}</p>
        <p class="sub">${time(Date.now())}</p>
        <div class="ring-pic">${pictureUrl() ? `<img src="${esc(pictureUrl())}" alt="Picture from the doorbell">` : ''}</div>
        <div class="ring-actions">
          <button class="btn" data-doorbell-live>${icon('tv')}Live view</button>
          <button class="btn ghost" data-doorbell-dismiss>Dismiss</button>
        </div>
      </div>`;
    el.hidden = false;
    clearTimeout(alertTimer);
    alertTimer = setTimeout(hideRing, 90 * 1000);
    // The event picture lands a moment after the ring; refresh it
    setTimeout(() => { const img = el.querySelector('.ring-pic img'); const u = pictureUrl(); if (img && u) img.src = u; else if (u) el.querySelector('.ring-pic').innerHTML = `<img src="${esc(u)}" alt="Picture from the doorbell">`; }, 4000);
  }
  function hideRing() { const el = document.getElementById('doorbell-alert'); if (el) { el.hidden = true; el.innerHTML = ''; } }

  // ── Live view ──
  let hls = null;
  async function openLive() {
    hideRing();
    const dlg = document.getElementById('doorbell-live');
    const c = cfg();
    dlg.innerHTML = `
      <div class="live-head"><h2>${esc(c.name || 'Front door')}</h2><button class="btn ghost" data-doorbell-close>Close</button></div>
      <div class="live-body"><video id="door-video" playsinline muted autoplay controls poster="${esc(pictureUrl() || '')}"></video>
      <p class="sub" id="live-status">Waking the doorbell — this takes a few seconds and uses a little of its battery.</p></div>`;
    dlg.showModal();
    if (S().mode !== 'live') { dlg.querySelector('#live-status').textContent = 'Live view needs a connection to Home Assistant.'; return; }
    const video = dlg.querySelector('#door-video');
    const status = dlg.querySelector('#live-status');
    try {
      const { url } = await HD.ha.callWS({ type: 'camera/stream', entity_id: c.camera, format: 'hls' });
      const src = `${HD.ha.baseUrl()}${url}`;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
      } else {
        if (!window.Hls) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js');
        hls = new window.Hls({ liveSyncDurationCount: 2 });
        hls.loadSource(src); hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, (_, d) => { if (d.fatal) status.textContent = 'The stream stopped. Close and try again.'; });
      }
      video.addEventListener('playing', () => { status.textContent = 'Live. Close this when you’re done to save the doorbell’s battery.'; }, { once: true });
    } catch (e) {
      status.textContent = `Couldn't start live view: ${e.message}. The picture above is the latest snapshot.`;
    }
  }
  function closeLive() {
    const dlg = document.getElementById('doorbell-live');
    if (hls) { hls.destroy(); hls = null; }
    const v = dlg.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    dlg.close(); dlg.innerHTML = '';
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('video player failed to load')); document.head.appendChild(s); });
  }

  function init() {
    if (!cfg()) return;
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-doorbell-live]')) openLive();
      else if (ev.target.closest('[data-doorbell-dismiss]')) hideRing();
      else if (ev.target.closest('[data-doorbell-close]')) closeLive();
    });
    document.getElementById('doorbell-live').addEventListener('close', () => { if (hls) { hls.destroy(); hls = null; } });
    S().on((id) => {
      const c = cfg();
      if (id === c.ringing && S().state(c.ringing) === 'on') { last.ring = Date.now(); showRing(); }
      else if (id === c.person && S().state(c.person) === 'on') { last.person = Date.now(); if (document.getElementById('doorbell-alert').hidden) HD.app.toast(`Person at the ${(c.name || 'front door').toLowerCase()}`); }
      else if (id === c.motion && S().state(c.motion) === 'on') last.motion = Date.now();
    });
    loadHistory();
    setInterval(loadHistory, 15 * 60 * 1000);
  }

  HD.doorbell = { init, cardHtml, alerts, enabled, showRing, last };
})();
