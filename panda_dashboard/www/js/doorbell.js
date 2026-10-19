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

  // Days of battery left. Prefer the measured drain over the last 2+ weeks of
  // statistics; fall back to "% used since last charge ÷ days since charging".
  let drainPerDay = null;
  async function loadBatteryTrend() {
    if (!enabled() || S().mode !== 'live') return;
    try {
      const id = cfg().battery;
      const res = await HD.ha.stats([id], Date.now() - 21 * 864e5, null, 'hour', ['mean']);
      const pts = (res[id] || []).filter((r) => r.mean != null);
      if (pts.length < 72) return;                       // need ~3 days
      // Use the stretch since the last charge (where the level jumped up)
      let startIdx = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].mean - pts[i - 1].mean > 5) startIdx = i;
      const seg = pts.slice(startIdx);
      const days = (seg[seg.length - 1].start - seg[0].start) / 864e5;
      const used = seg[0].mean - seg[seg.length - 1].mean;
      if (days >= 3 && used > 0) drainPerDay = used / days;
    } catch (e) { /* statistics not available yet */ }
  }
  function batteryEstimate() {
    const c = cfg(); const bat = S().num(c.battery);
    if (bat == null || S().state(c.charging) === 'Charging') return null;
    let rate = drainPerDay;
    if (!rate) {
      const days = S().num(c.daysSinceCharge);
      if (days && days >= 1 && bat < 100) rate = (100 - bat) / days;
    }
    if (!rate || rate <= 0) return null;
    return { days: bat / rate, rate };
  }
  function estimateText() {
    const e = batteryEstimate(); if (!e) return '';
    const d = e.days;
    const left = d >= 60 ? `${Math.round(d / 30)} months` : d >= 14 ? `${Math.round(d / 7)} weeks` : `${Math.max(0, Math.round(d))} days`;
    return `≈ ${left} left`;
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
          <div><dt>Battery</dt><dd class="${low ? 'warn' : ''}">${bat == null ? '–' : `${Math.round(bat)}%`}${S().state(c.charging) === 'Charging' ? ' · charging' : estimateText() ? `<small>${estimateText()}</small>` : ''}</dd></div>
          <div><dt>Mode</dt><dd>${esc(S().state(c.guardMode) || '–')}</dd></div>
        </dl>
      </section>`;
  }

  function alerts() {
    if (!enabled()) return [];
    const c = cfg(); const out = [];
    const bat = S().num(c.battery);
    const est = batteryEstimate();
    if (bat != null && bat < (c.lowBattery || 20)) out.push(['alert', `Doorbell battery at ${Math.round(bat)}% — time to charge it`, 'warning']);
    else if (est && est.days < 7) out.push(['alert', `Doorbell battery runs out in about ${Math.max(1, Math.round(est.days))} days`, 'warning']);
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
  let p2pStarted = false;
  function stopP2P() {
    const c = cfg();
    if (p2pStarted && c.streamService && S().mode === 'live') HD.ha.callService(c.streamService, 'stop_p2p_livestream', { entity_id: c.camera }).catch(() => {});
    p2pStarted = false;
  }
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
      if (c.streamService) {
        try { await HD.ha.callService(c.streamService, 'start_p2p_livestream', { entity_id: c.camera }); }
        catch (e) { if (!/already_running|AlreadyRunning/i.test(e.message)) throw e; }  // already streaming is fine
        p2pStarted = true;
      }
      // The HomeBase needs a few seconds to open the stream; keep asking until HA has it
      let url = null; let lastErr = null;
      for (let i = 0; i < 15 && !url && dlg.open; i++) {
        try { ({ url } = await HD.ha.callWS({ type: 'camera/stream', entity_id: c.camera, format: 'hls' })); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2000)); }
      }
      if (!dlg.open) return;
      if (!url) throw lastErr || new Error('the doorbell did not start streaming');
      const src = `${HD.ha.baseUrl()}${url}`;
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
      } else {
        if (!window.Hls) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js');
        hls = new window.Hls({ liveSyncDurationCount: 2 });
        hls.loadSource(src); hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, (_, d) => { if (d.fatal) status.textContent = 'The stream stopped. Close and try again.'; });
      }
      let playing = false;
      video.addEventListener('playing', () => { playing = true; status.textContent = 'Live. Close this when you’re done to save the doorbell’s battery.'; }, { once: true });
      setTimeout(() => { if (!playing && dlg.open) startSnapshotFallback(dlg, status); }, 20000);
    } catch (e) {
      status.textContent = `Couldn't start live video (${e.message}).`;
      startSnapshotFallback(dlg, status);
    }
  }

  // While the doorbell is awake its picture refreshes; show that every 2 s instead of video
  let snapTimer = null;
  function startSnapshotFallback(dlg, status) {
    const cam = S().get(cfg().camera); const pic = cam && cam.attributes.entity_picture;
    if (!pic) return;
    const body = dlg.querySelector('.live-body');
    if (hls) { hls.destroy(); hls = null; }
    body.querySelector('video').replaceWith(Object.assign(document.createElement('img'), { className: 'live-snap', alt: 'Doorbell picture, refreshing' }));
    const img = body.querySelector('.live-snap');
    const tick = () => { img.src = `${HD.ha.baseUrl()}${pic}${pic.includes('?') ? '&' : '?'}t=${Date.now()}`; };
    tick(); clearInterval(snapTimer); snapTimer = setInterval(tick, 2000);
    status.textContent = `${status.textContent} Showing the doorbell's picture, refreshed every 2 seconds, instead.`.trim();
  }
  function closeLive() {
    const dlg = document.getElementById('doorbell-live');
    if (hls) { hls.destroy(); hls = null; }
    const v = dlg.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    stopP2P(); clearInterval(snapTimer);
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
    document.getElementById('doorbell-live').addEventListener('close', () => { if (hls) { hls.destroy(); hls = null; } stopP2P(); clearInterval(snapTimer); });
    // Don't leave the doorbell streaming if the page is closed mid-view
    window.addEventListener('pagehide', stopP2P);
    S().on((id) => {
      const c = cfg();
      if (id === c.ringing && S().state(c.ringing) === 'on') { last.ring = Date.now(); showRing(); }
      else if (id === c.person && S().state(c.person) === 'on') { last.person = Date.now(); if (document.getElementById('doorbell-alert').hidden) HD.app.toast(`Person at the ${(c.name || 'front door').toLowerCase()}`); }
      else if (id === c.motion && S().state(c.motion) === 'on') last.motion = Date.now();
    });
    loadHistory(); loadBatteryTrend();
    setInterval(() => { loadHistory(); loadBatteryTrend(); }, 15 * 60 * 1000);
  }

  HD.doorbell = { init, cardHtml, alerts, enabled, showRing, last };
})();
