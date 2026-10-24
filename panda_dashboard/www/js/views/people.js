/*
 * People view: where everyone's phone is, on a street map.
 *
 * Each entry in config.people is a person (person.* from Home Assistant, which follows
 * the HA Companion app on their phone) or any device_tracker with GPS. Shown per phone:
 * home / away / which zone and since when, distance from home and whether it's heading
 * home, phone battery, and today's trail from the recorder history.
 *
 * Adding a phone: one more line in config.people, e.g.
 *   { id: 'person.rosalyn', name: 'Rosalyn' }
 * The GPS tracker (the person's `source`) and the phone's battery sensors
 * (sensor.<tracker>_battery_level / _battery_state) are found automatically; set
 * `tracker`, `phoneBattery`, `batteryState` or `colour` to override.
 *
 * The map is Leaflet (bundled in vendor/, loaded only on this page) with OpenStreetMap
 * tiles, the one thing on the dashboard that loads from outside: the browser fetches the
 * map squares around the people it shows. config.map.tiles can point at another server.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, icon } = HD.u;
  const S = () => HD.store;
  const COLOURS = ['var(--c1)', 'var(--c5)', 'var(--c3)', 'var(--c4)', 'var(--c2)', 'var(--c6)'];
  const now = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());
  const mapCfg = () => ({
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    maxAccuracy: 150,          // metres: fixes less accurate than this are left out of trails
    ...(HD.config.map || {}),
  });

  // ── Who's tracked, and from which entities ──
  const hasGps = (id) => { const s = S().get(id); return !!(s && s.attributes.latitude != null && s.attributes.longitude != null); };
  function locEntity(p) {
    if (p.tracker) return p.tracker;
    const src = S().attr(p.id, 'source');
    if (src && hasGps(src)) return src;
    return p.id;
  }
  // The Companion app names its sensors after the device: device_tracker.nans_iphone →
  // sensor.nans_iphone_battery_level and sensor.nans_iphone_battery_state
  function guessSensor(p, suffix) {
    const loc = locEntity(p);
    if (!loc.startsWith('device_tracker.')) return null;
    const id = `sensor.${loc.split('.')[1]}_${suffix}`;
    return S().get(id) ? id : null;
  }
  function people() {
    return (HD.config.people || []).filter((p) => p && p.id).map((p, i) => ({
      ...p,
      name: p.name || S().attr(p.id, 'friendly_name') || p.id,
      colour: p.colour || COLOURS[i % COLOURS.length],
      loc: locEntity(p),
      battery: p.phoneBattery || guessSensor(p, 'battery_level'),
      batteryState: p.batteryState || guessSensor(p, 'battery_state'),
    }));
  }

  // ── Geometry ──
  const R_MI = 3958.8;
  function miles(a, b) {
    const r = (d) => (d * Math.PI) / 180;
    const dLat = r(b[0] - a[0]); const dLon = r(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
    return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const homeLL = () => { const z = S().get('zone.home'); return z && z.attributes.latitude != null ? [z.attributes.latitude, z.attributes.longitude] : null; };
  const posOf = (id) => { const s = S().get(id); return s && s.attributes.latitude != null ? [s.attributes.latitude, s.attributes.longitude] : null; };
  const fmtMi = (d) => (d == null ? '–' : d < 0.1 ? `${Math.round(d * 1760)} yd` : `${d < 10 ? d.toFixed(1) : Math.round(d)} mi`);

  // ── Today's trails ──
  // From the recorder (every location update since midnight, plus where they were at
  // midnight), reloaded every 3 minutes while the page is open; live updates are added
  // in between.
  const trails = {};               // loc entity → [{ t, ll, acc }]
  let trailsAt = 0; let trailsLoading = false;
  const dayStart = () => { const d = new Date(now()); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function keepPoint(list, pt, maxAcc) {
    if (pt.acc != null && pt.acc > maxAcc && list.length) return;
    const last = list[list.length - 1];
    if (last && pt.t <= last.t) return;
    if (last && miles(last.ll, pt.ll) < 0.01) { last.t = pt.t; return; }   // under ~15 m: the same spot
    list.push(pt);
  }

  async function loadTrails() {
    const ids = [...new Set(people().map((p) => p.loc))];
    if (!ids.length || trailsLoading) return;
    trailsLoading = true;
    try {
      const t0 = dayStart();
      const res = await HD.ha.callWS({
        type: 'history/history_during_period',
        start_time: new Date(t0).toISOString(), end_time: new Date(now()).toISOString(),
        entity_ids: ids, include_start_time_state: true,
        significant_changes_only: false, minimal_response: false, no_attributes: false,
      });
      const maxAcc = mapCfg().maxAccuracy;
      ids.forEach((id) => {
        const list = [];
        let attrs = {};
        ((res && res[id]) || []).forEach((r) => {
          if (r.a) attrs = r.a;             // attributes are only sent when they change
          if (attrs.latitude == null) return;
          const t = Math.max(t0, ((r.lu || r.lc) || 0) * 1000);
          keepPoint(list, { t, ll: [attrs.latitude, attrs.longitude], acc: attrs.gps_accuracy }, maxAcc);
        });
        trails[id] = list;
      });
      trailsAt = Date.now();
    } catch (e) { console.warn('People: no history', e); trailsAt = Date.now(); } finally { trailsLoading = false; }
  }

  // Add the live position to the trail as it moves
  function addLive(p) {
    const ll = posOf(p.loc); if (!ll) return;
    const list = trails[p.loc] || (trails[p.loc] = []);
    const s = S().get(p.loc);
    const t = Math.min(now(), Date.parse(s.last_updated) || now());
    keepPoint(list, { t, ll, acc: s.attributes.gps_accuracy }, mapCfg().maxAccuracy);
  }

  function travelled(list) {
    let d = 0;
    for (let i = 1; i < list.length; i++) d += miles(list[i - 1].ll, list[i].ll);
    return d;
  }

  // Heading home: away, and at least 0.15 mi nearer home than 10–20 minutes ago
  function headingHome(p, dist, list) {
    const home = homeLL();
    if (!home || dist == null || dist < 0.3 || !list.length) return false;
    const t = now();
    if (t - list[list.length - 1].t > 20 * 60e3) return false;   // hasn't moved lately
    const then = [...list].reverse().find((x) => t - x.t >= 10 * 60e3);
    if (!then || t - then.t > 40 * 60e3) return false;
    return miles(home, then.ll) - dist >= 0.15;
  }

  // ── Per-person summary ──
  function info(p) {
    const st = S().get(p.id);
    const state = st ? st.state : undefined;
    const ll = posOf(p.loc) || posOf(p.id);
    const home = homeLL();
    const dist = ll && home ? miles(home, ll) : null;
    const list = trails[p.loc] || [];
    const locSt = S().get(p.loc) || st;
    const seen = locSt ? Date.parse(locSt.last_updated) : null;
    const stale = seen != null && now() - seen > 2 * 3600e3;
    const where = state === 'home' ? 'Home' : state === 'not_home' ? 'Away' : !state || state === 'unknown' || state === 'unavailable' ? 'Unknown' : HD.u.cap(state.replace(/_/g, ' '));
    const bat = S().num(p.battery);
    const bs = String(S().state(p.batteryState) || '').toLowerCase();
    const charging = /charg|full/.test(bs) && !/not|dis/.test(bs);
    return {
      p, state, where, ll, dist, list, stale, seen, bat, charging,
      since: st && st.last_changed ? Date.parse(st.last_changed) : null,
      acc: locSt ? locSt.attributes.gps_accuracy : null,
      heading: state !== 'home' && headingHome(p, dist, list),
      miles: travelled(list),
      picture: st && st.attributes.entity_picture,
    };
  }

  const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  function avatarHtml(x, cls = '') {
    const pic = x.picture ? `<img src="${esc(HD.ha.baseUrl() + x.picture)}" alt="" onerror="this.remove()">` : '';
    return `<span class="pp-avatar ${cls}" style="--who:${x.p.colour}"><b>${esc(initials(x.p.name))}</b>${pic}</span>`;
  }

  const sinceText = (x) => {
    if (!x.since) return '';
    const t = x.since; const d0 = dayStart();
    if (t >= d0) return `since ${HD.u.time(t)}`;
    if (t >= d0 - 864e5) return `since yesterday ${HD.u.time(t)}`;
    return `since ${HD.u.fmt(t, { weekday: 'short', day: 'numeric', month: 'short' })}`;
  };
  const agoText = (t) => {
    const m = (now() - t) / 60000;
    if (!Number.isFinite(m)) return '–';
    if (m < 1) return 'just now';
    if (m < 60) return `${Math.round(m)} min ago`;
    if (m < 1440) return `${Math.round(m / 60)} h ago`;
    return `${Math.round(m / 1440)} days ago`;
  };

  function cardHtml(x, i) {
    const statusCls = x.state === 'home' ? 'home' : x.where === 'Unknown' ? 'unknown' : x.where === 'Away' ? 'away' : 'zone';
    const line = x.where === 'Away' && x.dist != null ? `${fmtMi(x.dist)} from home` : x.where === 'Unknown' ? 'No location yet' : esc(sinceText(x));
    const batCls = x.bat == null ? '' : x.bat < 15 ? 'low' : x.bat < 30 ? 'mid' : '';
    return `<li><button class="pp-card ${focus === x.p.id ? 'focus' : ''}" data-person="${i}" style="--who:${x.p.colour}" aria-label="Show ${esc(x.p.name)} on the map">
      ${avatarHtml(x)}
      <span class="pp-main">
        <strong>${esc(x.p.name)}</strong>
        <span class="pp-where"><i class="pp-dot ${statusCls}"></i>${esc(x.where)}${x.where !== 'Away' && x.where !== 'Home' && x.where !== 'Unknown' && x.dist != null ? ` · ${fmtMi(x.dist)}` : ''}</span>
        <small>${line}${x.where === 'Away' && x.since ? ` · ${esc(sinceText(x).replace(/^since/, 'left'))}` : ''}</small>
        <span class="pp-tags">
          ${x.heading ? `<em class="pp-tag go">${icon('house')}Heading home</em>` : ''}
          ${x.miles >= 0.1 ? `<em class="pp-tag">${fmtMi(x.miles)} today</em>` : ''}
          ${x.seen ? `<em class="pp-tag ${x.stale ? 'warn' : ''}">${icon('pin')}${x.stale ? 'Last seen ' : ''}${agoText(x.seen)}</em>` : ''}
        </span>
      </span>
      ${x.bat != null ? `<span class="pp-bat ${batCls} ${x.charging ? 'charging' : ''}" title="Phone battery${x.charging ? ', charging' : ''}">
        <i class="bat-meter"><b style="width:${Math.max(0, Math.min(100, x.bat))}%"></b></i><span>${x.charging ? icon('bolt') : ''}${Math.round(x.bat)}%</span></span>` : ''}
    </button></li>`;
  }

  // ── Map ──
  let L = null; let map = null; let tilesLayer = null;
  let markers = {}; let accs = {}; let lines = {}; let zoneLayer = null; let zonesKey = '';
  let fitted = false; let focus = null; let ro = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (loadLeaflet.p) return loadLeaflet.p;
    loadLeaflet.p = new Promise((resolve, reject) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'vendor/leaflet.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'vendor/leaflet.js';
      s.onload = () => resolve(window.L); s.onerror = () => { loadLeaflet.p = null; reject(new Error('map failed to load')); };
      document.head.appendChild(s);
    });
    return loadLeaflet.p;
  }

  async function makeMap(el) {
    try { L = await loadLeaflet(); } catch (e) { el.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
    if (!el.isConnected) return;
    if (map) { map.remove(); map = null; }
    markers = {}; accs = {}; lines = {}; zoneLayer = null; zonesKey = ''; fitted = false;
    const c = mapCfg();
    map = L.map(el, { zoomControl: true, attributionControl: true, zoomSnap: 0.5 });
    map.attributionControl.setPrefix(false);
    tilesLayer = L.tileLayer(c.tiles, { maxZoom: c.maxZoom, attribution: c.attribution, referrerPolicy: 'strict-origin-when-cross-origin', crossOrigin: false });
    tilesLayer.addTo(map);
    const home = homeLL();
    map.setView(home || [51.5, -0.12], 14);
    if (ro) ro.disconnect();
    ro = new ResizeObserver(() => map && map.invalidateSize());
    ro.observe(el);
    drawMap();
  }

  function zonesOnMap() {
    const zones = Object.values(S().states).filter((s) => s.entity_id.startsWith('zone.') && s.attributes.latitude != null);
    const key = zones.map((z) => `${z.entity_id}:${z.attributes.latitude},${z.attributes.longitude},${z.attributes.radius}`).join('|');
    if (key === zonesKey) return;
    zonesKey = key;
    if (zoneLayer) zoneLayer.remove();
    zoneLayer = L.layerGroup().addTo(map);
    zones.forEach((z) => {
      const a = z.attributes; const isHome = z.entity_id === 'zone.home';
      L.circle([a.latitude, a.longitude], { radius: a.radius || 100, className: `pp-zone ${isHome ? 'home' : ''} ${a.passive ? 'passive' : ''}`, interactive: false }).addTo(zoneLayer);
      L.marker([a.latitude, a.longitude], {
        interactive: false, keyboard: false, zIndexOffset: -1000,
        icon: L.divIcon({ className: 'pp-zone-label', html: isHome ? `<span class="home">${icon('house')}</span>` : `<span>${esc(a.friendly_name || z.entity_id)}</span>`, iconSize: null }),
      }).addTo(zoneLayer);
    });
  }

  function drawMap() {
    if (!map || !L) return;
    zonesOnMap();
    const list = people().map(info);
    const seen = new Set();
    list.forEach((x) => {
      const id = x.p.id; seen.add(id);
      // Trail
      const pts = x.list.map((pt) => pt.ll);
      if (pts.length > 1) {
        const k = `${pts.length}:${pts[pts.length - 1]}:${focus === id}`;
        if (!lines[id]) lines[id] = L.polyline(pts, { className: 'pp-trail', interactive: false }).addTo(map);
        if (lines[id]._k !== k) { lines[id].setLatLngs(pts); lines[id]._k = k; }
        const el = lines[id].getElement();
        if (el) { el.style.setProperty('--who', x.p.colour); el.classList.toggle('focus', focus === id); el.classList.toggle('dim', !!focus && focus !== id); }
      } else if (lines[id]) { lines[id].remove(); delete lines[id]; }
      // Marker
      if (!x.ll) { if (markers[id]) { markers[id].remove(); delete markers[id]; } if (accs[id]) { accs[id].remove(); delete accs[id]; } return; }
      const html = `${avatarHtml(x, `pin ${x.state === 'home' ? 'home' : ''} ${x.stale ? 'stale' : ''} ${x.heading ? 'heading' : ''}`)}<span class="pp-name">${esc(x.p.name)}</span>`;
      if (!markers[id]) {
        markers[id] = L.marker(x.ll, { keyboard: false, riseOnHover: true }).addTo(map);
        markers[id].on('click', () => setFocus(id, true));
      } else markers[id].setLatLng(x.ll);
      if (markers[id]._html !== html) { markers[id].setIcon(L.divIcon({ className: 'pp-marker', html, iconSize: [44, 44], iconAnchor: [22, 22] })); markers[id]._html = html; }
      markers[id].setZIndexOffset(focus === id ? 1000 : 0);
      if (x.acc && x.acc > 25) {
        if (!accs[id]) accs[id] = L.circle(x.ll, { radius: x.acc, className: 'pp-acc', interactive: false }).addTo(map);
        else { accs[id].setLatLng(x.ll); accs[id].setRadius(x.acc); }
        const el = accs[id].getElement(); if (el) el.style.setProperty('--who', x.p.colour);
      } else if (accs[id]) { accs[id].remove(); delete accs[id]; }
    });
    Object.keys(markers).forEach((id) => { if (!seen.has(id)) { markers[id].remove(); delete markers[id]; } });
    Object.keys(lines).forEach((id) => { if (!seen.has(id)) { lines[id].remove(); delete lines[id]; } });
    if (!fitted && list.some((x) => x.ll)) { fitAll(false); fitted = true; }
  }

  // Everyone (and home) in view; just home, close up, when everyone's in
  function fitAll(animate = true) {
    if (!map) return;
    const pts = people().map(info).filter((x) => x.ll).map((x) => x.ll);
    const home = homeLL(); if (home) pts.push(home);
    if (!pts.length) return;
    const b = L.latLngBounds(pts);
    if (b.getNorthEast().equals(b.getSouthWest(), 1e-4)) map.setView(b.getCenter(), 16, { animate });
    else map.fitBounds(b, { padding: [48, 48], maxZoom: 16, animate });
  }

  function setFocus(id, fly) {
    focus = focus === id && !fly ? null : id;
    const x = people().map(info).find((y) => y.p.id === id);
    if (fly && x && x.ll && map) {
      const pts = x.list.map((pt) => pt.ll);
      if (pts.length > 1) map.flyToBounds(L.latLngBounds(pts.concat([x.ll])), { padding: [48, 48], maxZoom: 16, duration: 0.8 });
      else map.flyTo(x.ll, 16, { duration: 0.8 });
    }
    HD.views.people.update();
  }

  function render() {
    const list = people().map(info);
    const el = document.getElementById('pp-list');
    if (!el) return;
    if (!list.length) {
      HD.u.setHTML(el, '<p class="note">Add people to <code>people</code> in config.js, e.g. <code>{ id: \'person.rosalyn\', name: \'Rosalyn\' }</code>.</p>');
      return;
    }
    const home = list.filter((x) => x.state === 'home').length;
    HD.u.setHTML(document.getElementById('pp-sum'), `${home} of ${list.length} at home`);
    HD.u.setHTML(el, `<ul class="pp-list">${list.map(cardHtml).join('')}</ul>`);
  }

  HD.people = {
    // Phones' GPS trackers, battery sensors and every zone, so they're watched live
    extraIds() {
      const ids = new Set(Object.keys(S().states).filter((id) => id.startsWith('zone.')));
      people().forEach((p) => [p.loc, p.battery, p.batteryState].forEach((id) => id && ids.add(id)));
      return [...ids];
    },
    info: () => people().map(info),
  };

  HD.views.people = {
    title: 'People',
    mount(root) {
      root.innerHTML = `
        <div class="panel-grid people">
          <section class="panel pp-map-panel">
            <header><h2>Where everyone is</h2><p id="pp-sum"></p>
              <button type="button" class="btn ghost pp-fit" id="pp-fit">${icon('pin')}Show everyone</button></header>
            <div id="pp-map" class="pp-map" role="region" aria-label="Map of everyone's location"></div>
          </section>
          <section class="panel pp-people"><header><h2>Phones</h2><p>Tap one to follow today's trail</p></header>
            <div id="pp-list"></div></section>
        </div>`;
      document.getElementById('pp-fit').addEventListener('click', () => { focus = null; fitAll(true); this.update(); });
      document.getElementById('pp-list').addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-person]'); if (!b) return;
        const p = people()[+b.dataset.person]; if (p) setFocus(p.id, focus !== p.id);
      });
      render();
      makeMap(document.getElementById('pp-map'));
      if (Date.now() - trailsAt > 3 * 60e3) loadTrails().then(() => this.update());
    },
    update() {
      if (!document.getElementById('pp-map')) return;
      people().forEach(addLive);
      render();
      drawMap();
      if (Date.now() - trailsAt > 3 * 60e3) loadTrails().then(() => { render(); drawMap(); });
    },
  };
})();
