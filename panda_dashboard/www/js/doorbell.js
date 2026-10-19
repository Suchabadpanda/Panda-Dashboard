/*
 * Doorbell (Eufy via the eufy_security integration):
 *  - front-door card with the latest picture, last ring / person, battery
 *  - full-screen alert when someone rings, on whichever view is open
 *  - live view on tap, using HA's own camera stream (HLS)
 *  - a "refresh" that wakes the doorbell just long enough to take a new picture
 * The S220 is battery powered, so live video only starts when asked for (or on a
 * ring, so the live view is ready sooner).
 */
window.HD = window.HD || {};

(function () {
  const { esc, ago, time, icon } = HD.u;
  const S = () => HD.store;
  const cfg = () => HD.config.doorbell;
  const last = { ring: null, person: null, motion: null };   // ms timestamps of the latest "on"
  let alertTimer = null;

  const enabled = () => !!(cfg() && cfg().camera && S().get(cfg().camera));

  // Two pictures are available:
  //  - the camera's own picture: the last frame grabbed while it streamed (live view,
  //    or a "Refresh" below). Its state flips idle↔streaming, so last_changed ≈ when.
  //  - the event image: the thumbnail Eufy sends with a ring / motion event.
  // Show whichever is newer; if the camera has never streamed since HA started its
  // picture can fail to load, and the <img> falls back to the event image.
  let picVersion = 0;
  function pictures() {
    const c = cfg();
    const img = S().get(c.image); const cam = S().get(c.camera);
    const camAt = cam ? Date.parse(cam.last_changed) : 0;
    const eventAt = Math.max(last.ring || 0, last.person || 0, last.motion || 0);
    const url = (e) => {
      const u = e && e.attributes.entity_picture; if (!u) return null;
      if (u.startsWith('data:')) return u;
      return `${HD.ha.baseUrl()}${u}${u.includes('?') ? '&' : '?'}v=${picVersion}-${Date.parse(e.last_updated) || 0}`;
    };
    const camUrl = url(cam); const evtUrl = url(img);
    const camFirst = camUrl && (!evtUrl || camAt >= eventAt);
    return {
      main: camFirst ? camUrl : evtUrl || camUrl, fallback: camFirst ? evtUrl : null,
      at: camFirst ? camAt : eventAt || null,
    };
  }
  const pictureUrl = () => pictures().main;
  const imgTag = (cls, alt) => {
    const p = pictures(); if (!p.main) return '';
    const fb = p.fallback ? ` onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${esc(p.fallback)}'}else{this.replaceWith(Object.assign(document.createElement('span'),{className:'no-pic',textContent:'No picture yet'}))}"`
      : ` onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'no-pic',textContent:'No picture yet'}))"`;
    return `<img class="${cls}" src="${esc(p.main)}" alt="${esc(alt)}"${fb}>`;
  };

  // ── Waiting for the doorbell to wake ──
  // The camera entity's state turns 'streaming' once the HomeBase has the P2P stream.
  function waitForStreaming(timeoutMs) {
    const c = cfg();
    if (S().state(c.camera) === 'streaming') return Promise.resolve(true);
    return new Promise((resolve) => {
      const off = S().on((id) => { if (id === c.camera && S().state(c.camera) === 'streaming') { off(); clearTimeout(t); resolve(true); } });
      const t = setTimeout(() => { off(); resolve(false); }, timeoutMs);
    });
  }
  async function startP2P() {
    const c = cfg(); if (!c.streamService || S().mode !== 'live') return;
    try { await HD.ha.callService(c.streamService, 'start_p2p_livestream', { entity_id: c.camera }); }
    catch (e) { if (!/already_running|AlreadyRunning/i.test(e.message)) throw e; }  // already streaming is fine
    p2pStarted = true;
  }
  // Grab a fresh frame while the stream is up; the camera's picture becomes that frame
  function grabFrame() {
    const c = cfg();
    return HD.ha.callService(c.streamService, 'generate_image', { entity_id: c.camera })
      .catch(() => {}).then(() => { picVersion++; HD.store.emit(c.camera); });
  }

  // "Refresh" on the card: wake the doorbell just long enough to take a picture
  let refreshing = false;
  async function refreshPicture() {
    if (refreshing || S().mode !== 'live') return;
    refreshing = true; HD.store.emit(null);
    try {
      await startP2P();
      if (await waitForStreaming(45000)) await grabFrame();
      else HD.app.toast("The doorbell didn't wake up in time. Try again.");
    } catch (e) { HD.app.toast(`Couldn't refresh the picture (${e.message})`); }
    if (!document.getElementById('doorbell-live').open) stopP2P();
    refreshing = false; HD.store.emit(null);
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
        <div class="door-media">
          <button class="door-pic" data-doorbell-live aria-label="Open live view of the ${esc(c.name || 'front door')}">
            ${pic ? imgTag('', 'Latest picture from the doorbell') : '<span class="no-pic">No picture yet</span>'}
            <span class="live-chip">${icon('tv')}Live view</span>
          </button>
          ${pictures().at ? `<span class="pic-age">${refreshing ? 'Waking the doorbell…' : since(pictures().at, '')}</span>` : refreshing ? '<span class="pic-age">Waking the doorbell…</span>' : ''}
          ${S().mode === 'live' && c.streamService ? `<button class="pic-refresh" data-doorbell-refresh ${refreshing ? 'disabled aria-busy="true"' : ''} aria-label="Take a new picture" title="Take a new picture (wakes the doorbell for a few seconds)">${refreshing ? '…' : '↻'}</button>` : ''}
        </div>
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
        <div class="ring-pic">${imgTag('', 'Picture from the doorbell')}</div>
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
  // On a ring, start waking the doorbell straight away so "Live view" opens quickly.
  // If nobody opens it within a minute, let it go back to sleep.
  function prewarm() {
    if (cfg().prewarmOnRing === false || S().mode !== 'live' || p2pStarted) return;
    startP2P().catch(() => {});
    clearTimeout(prewarmTimer);
    prewarmTimer = setTimeout(() => { if (!document.getElementById('doorbell-live').open) stopP2P(); }, 60000);
  }
  function hideRing() { const el = document.getElementById('doorbell-alert'); if (el) { el.hidden = true; el.innerHTML = ''; } }

  // ── Live view ──
  let hls = null;
  let p2pStarted = false;
  let liveReached = false;   // video actually played this session
  let prewarmTimer = null;
  function stopP2P() {
    const c = cfg();
    clearTimeout(prewarmTimer);
    if (p2pStarted && c.streamService && S().mode === 'live') HD.ha.callService(c.streamService, 'stop_p2p_livestream', { entity_id: c.camera }).catch(() => {});
    p2pStarted = false;
  }
  // Leaving the live view: keep a picture of what it showed, then let the doorbell sleep
  function endLive() {
    if (liveReached && p2pStarted && S().mode === 'live') { liveReached = false; grabFrame().finally(stopP2P); }
    else stopP2P();
  }
  async function openLive() {
    hideRing(); clearTimeout(prewarmTimer); liveReached = false;
    const dlg = document.getElementById('doorbell-live');
    const c = cfg();
    dlg.innerHTML = `
      <div class="live-head"><h2>${esc(c.name || 'Front door')}</h2><button class="btn ghost" data-doorbell-close>Close</button></div>
      <div class="live-body"><video id="door-video" playsinline muted autoplay controls poster="${esc(pictureUrl() || '')}"></video>
      <p class="sub" id="live-status">Connecting… the doorbell has to wake up first. Streaming uses a little of its battery.</p></div>`;
    dlg.showModal();
    if (S().mode !== 'live') { dlg.querySelector('#live-status').textContent = 'Live view needs a connection to Home Assistant.'; return; }
    const video = dlg.querySelector('#door-video');
    const status = dlg.querySelector('#live-status');
    const t0 = Date.now();
    const secs = () => `${Math.round((Date.now() - t0) / 1000)} s`;
    try {
      if (c.streamService) {
        await startP2P();
        // Ask HA for the stream the moment the doorbell is up, rather than polling blind
        status.textContent = 'Waking the doorbell…';
        await waitForStreaming(40000);
        if (!dlg.open) return;
        status.textContent = `Doorbell awake after ${secs()}. Starting video…`;
      }
      let url = null; let lastErr = null;
      for (let i = 0; i < 20 && !url && dlg.open; i++) {
        try { ({ url } = await HD.ha.callWS({ type: 'camera/stream', entity_id: c.camera, format: 'hls' })); } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1000)); }
      }
      if (!dlg.open) return;
      if (!url) throw lastErr || new Error('the doorbell did not start streaming');
      const src = `${HD.ha.baseUrl()}${url}`;
      // First video arrives ~20 s after waking (HA retries the stream after a fixed 10 s),
      // so be patient: generous loader timeouts, retry network errors, only say "Live" once frames move.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        let tries = 0;
        video.addEventListener('error', () => { if (dlg.open && tries++ < 5) setTimeout(() => { video.src = src; video.play().catch(() => {}); }, 3000); });
        video.src = src;
      } else {
        if (!window.Hls) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js');
        if (!dlg.open) return;
        let retries = 0;
        hls = new window.Hls({
          lowLatencyMode: true, liveSyncDurationCount: 1, maxLiveSyncPlaybackRate: 1.5,
          manifestLoadingTimeOut: 30000, manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 2000,
          levelLoadingTimeOut: 30000, levelLoadingMaxRetry: 6,
          fragLoadingTimeOut: 30000, fragLoadingMaxRetry: 6,
        });
        hls.loadSource(src); hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, (_, d) => {
          if (!d.fatal || !hls) return;
          if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR && retries++ < 5) { setTimeout(() => hls && hls.startLoad(), 3000); return; }
          if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          status.textContent = 'The stream stopped. Close and try again.';
        });
      }
      let live = false;
      video.addEventListener('timeupdate', () => {
        if (!live && video.currentTime > 0) { live = true; liveReached = true; status.textContent = `Live (took ${secs()}). Close this when you’re done to save the doorbell’s battery.`; }
      });
      setTimeout(() => { if (!live && dlg.open) { status.textContent = 'No video yet.'; startSnapshotFallback(dlg, status); } }, 45000);
    } catch (e) {
      status.textContent = `Couldn't start live video (${e.message}).`;
      startSnapshotFallback(dlg, status);
    }
  }

  // While the doorbell is awake its picture refreshes; show that every 2 s instead of video
  let snapTimer = null;
  function startSnapshotFallback(dlg, status) {
    const c = cfg();
    const cam = S().get(c.camera); const img = S().get(c.image);
    const camPic = cam && cam.attributes.entity_picture;
    const evtPic = img && img.attributes.entity_picture;
    if (!camPic && !evtPic) return;
    const body = dlg.querySelector('.live-body');
    if (hls) { hls.destroy(); hls = null; }
    const video = body.querySelector('video');
    if (video) video.replaceWith(Object.assign(document.createElement('img'), { className: 'live-snap', alt: 'Doorbell picture, refreshing' }));
    const el = body.querySelector('.live-snap');
    const withQ = (p, k, v) => `${HD.ha.baseUrl()}${p}${p.includes('?') ? '&' : '?'}${k}=${v}`;
    // The camera's picture 500s on a battery doorbell that isn't streaming; fall back to the event image
    el.onerror = () => { if (evtPic && !el.src.includes(evtPic.split('?')[0])) el.src = withQ(evtPic, 't', Date.now()); };
    const tick = () => { el.src = camPic ? withQ(camPic, 't', Date.now()) : withQ(evtPic, 't', Date.now()); };
    tick(); clearInterval(snapTimer); snapTimer = setInterval(tick, 2000);
    status.textContent = `${status.textContent} Showing the doorbell's picture, refreshed every 2 seconds, instead.`.trim();
  }

  function closeLive() {
    const dlg = document.getElementById('doorbell-live');
    if (hls) { hls.destroy(); hls = null; }
    const v = dlg.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    endLive(); clearInterval(snapTimer);
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
      else if (ev.target.closest('[data-doorbell-refresh]')) refreshPicture();
    });
    document.getElementById('doorbell-live').addEventListener('close', () => { if (hls) { hls.destroy(); hls = null; } endLive(); clearInterval(snapTimer); });
    // Don't leave the doorbell streaming if the page is closed mid-view
    window.addEventListener('pagehide', stopP2P);
    S().on((id) => {
      const c = cfg();
      if (id === c.ringing && S().state(c.ringing) === 'on') { last.ring = Date.now(); showRing(); prewarm(); }
      else if (id === c.person && S().state(c.person) === 'on') { last.person = Date.now(); if (document.getElementById('doorbell-alert').hidden) HD.app.toast(`Person at the ${(c.name || 'front door').toLowerCase()}`); }
      else if (id === c.motion && S().state(c.motion) === 'on') last.motion = Date.now();
    });
    loadHistory(); loadBatteryTrend();
    setInterval(() => { loadHistory(); loadBatteryTrend(); }, 15 * 60 * 1000);
  }

  HD.doorbell = { init, cardHtml, alerts, enabled, showRing, last };
})();
