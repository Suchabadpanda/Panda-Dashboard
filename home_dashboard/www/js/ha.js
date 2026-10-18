/*
 * Minimal Home Assistant WebSocket client + state store. No dependencies.
 *
 * Auth, in order of preference:
 *   1. Served by HA (add-on sidebar panel or /local/...): reuse the HA frontend's
 *      own session — the parent frame's auth, else localStorage.hassTokens.
 *   2. A long-lived access token entered in Settings (kept in this browser only).
 *   3. Neither → demo mode with a snapshot of real data.
 */
window.HD = window.HD || {};

(function () {
  const listeners = new Set();
  const store = {
    states: {},
    mode: 'connecting',            // connecting | live | demo | error
    message: '',
    get(id) { return id ? this.states[id] : undefined; },
    state(id) { const s = this.get(id); return s ? s.state : undefined; },
    num(id) {
      const s = this.get(id);
      if (!s) return null;
      const v = parseFloat(s.state);
      return Number.isFinite(v) ? v : null;
    },
    attr(id, key) { const s = this.get(id); return s ? s.attributes[key] : undefined; },
    available(id) { const s = this.state(id); return s !== undefined && s !== 'unavailable' && s !== 'unknown'; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(changed) { listeners.forEach((fn) => { try { fn(changed); } catch (e) { console.error(e); } }); },
    setStatus(mode, message = '') { this.mode = mode; this.message = message; this.emit(null); },
  };
  HD.store = store;

  const LS_TOKEN = 'hd.token';
  const LS_URL = 'hd.url';

  function baseUrl() {
    let u = '';
    try { u = localStorage.getItem(LS_URL) || ''; } catch (e) { /* storage blocked */ }
    u = u || HD.config.haUrl || location.origin;
    return u.replace(/\/+$/, '');
  }

  function readHassTokens() {
    try {
      const t = JSON.parse(localStorage.getItem('hassTokens') || 'null');
      return t && t.access_token ? t : null;
    } catch (e) { return null; }
  }

  async function refreshHassTokens(t) {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: t.clientId });
    const r = await fetch(`${t.hassUrl || baseUrl()}/auth/token`, { method: 'POST', body });
    if (!r.ok) throw new Error(`Session refresh failed (${r.status})`);
    const j = await r.json();
    const next = { ...t, access_token: j.access_token, expires_in: j.expires_in, expires: Date.now() + j.expires_in * 1000 };
    try { localStorage.setItem('hassTokens', JSON.stringify(next)); } catch (e) { /* ignore */ }
    return next;
  }

  // Inside the HA sidebar (add-on ingress) the page is an iframe on HA's own origin:
  // borrow the frontend's live auth, which refreshes itself.
  async function parentFrameAuth() {
    try {
      if (window.parent === window) return null;
      const hass = window.parent.document.querySelector('home-assistant')?.hass;
      const auth = hass && hass.auth;
      if (!auth) return null;
      if (auth.expired) await auth.refreshAccessToken();
      return auth.accessToken ? { token: auth.accessToken, kind: 'Home Assistant session' } : null;
    } catch (e) { return null; }   // cross-origin parent, e.g. an artifact preview
  }

  async function getAccessToken() {
    let manual = '';
    try { manual = localStorage.getItem(LS_TOKEN) || ''; } catch (e) { /* ignore */ }
    if (manual) return { token: manual, kind: 'long-lived token' };
    const sameOrigin = baseUrl() === location.origin;
    if (sameOrigin) { const pa = await parentFrameAuth(); if (pa) return pa; }
    let t = sameOrigin ? readHassTokens() : null;
    if (!t) return null;
    if (!t.expires || t.expires - Date.now() < 60_000) t = await refreshHassTokens(t);
    return { token: t.access_token, kind: 'Home Assistant session' };
  }

  // ── WebSocket connection ──
  let ws = null;
  let msgId = 1;
  const pending = new Map();
  let retry = 0;
  let authKind = '';

  function send(msg) {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== 1) return reject(new Error('Not connected'));
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  function onMessage(ev) {
    const m = JSON.parse(ev.data);
    if (m.type === 'result') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.success ? p.resolve(m.result) : p.reject(new Error((m.error && m.error.message) || 'Request failed'));
    } else if (m.type === 'event' && m.event && m.event.event_type === 'state_changed') {
      const d = m.event.data;
      if (d.new_state) store.states[d.entity_id] = d.new_state; else delete store.states[d.entity_id];
      store.emit(d.entity_id);
    }
  }

  async function connect() {
    let auth;
    try { auth = await getAccessToken(); } catch (e) { auth = null; console.warn(e); }
    if (!auth) return false;
    authKind = auth.kind;
    store.setStatus('connecting', `Connecting with ${authKind}…`);
    const url = baseUrl().replace(/^http/, 'ws') + '/api/websocket';

    return new Promise((resolve) => {
      ws = new WebSocket(url);
      let authed = false;
      ws.onmessage = async (ev) => {
        const m = JSON.parse(ev.data);
        if (!authed) {
          if (m.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: auth.token }));
          else if (m.type === 'auth_invalid') { store.setStatus('error', 'Home Assistant rejected the token. Open Settings to enter a new one.'); ws.close(); resolve(false); }
          else if (m.type === 'auth_ok') {
            authed = true; retry = 0;
            ws.onmessage = onMessage;
            try {
              const states = await send({ type: 'get_states' });
              states.forEach((s) => { store.states[s.entity_id] = s; });
              await send({ type: 'subscribe_events', event_type: 'state_changed' });
              store.setStatus('live', `Live · ${authKind}`);
              resolve(true);
            } catch (e) { store.setStatus('error', e.message); resolve(false); }
          }
        }
      };
      ws.onerror = () => { if (!authed) { store.setStatus('error', `Can't reach Home Assistant at ${baseUrl()}.`); resolve(false); } };
      ws.onclose = () => {
        pending.forEach((p) => p.reject(new Error('Connection closed')));
        pending.clear();
        if (authed) {
          store.setStatus('connecting', 'Reconnecting…');
          const delay = Math.min(30000, 1000 * 2 ** retry++);
          setTimeout(connect, delay);
        }
      };
    });
  }

  HD.ha = {
    connect,
    baseUrl,
    isLive: () => store.mode === 'live',
    callWS: (msg) => (store.mode === 'demo' ? HD.demo.callWS(msg) : send(msg)),
    callService(domain, service, data) {
      if (store.mode === 'demo') return HD.demo.callService(domain, service, data);
      return send({ type: 'call_service', domain, service, service_data: data });
    },
    toggle(entityId) {
      const [domain] = entityId.split('.');
      const on = store.state(entityId) === 'on';
      if (domain === 'select') return this.callService('select', 'select_option', { entity_id: entityId, option: on ? 'off' : 'on' });
      if (domain === 'button') return this.callService('button', 'press', { entity_id: entityId });
      return this.callService(domain === 'light' || domain === 'switch' || domain === 'input_boolean' || domain === 'climate' ? domain : 'homeassistant',
        on ? 'turn_off' : 'turn_on', { entity_id: entityId });
    },
    // Long-term statistics (5minute | hour | day | week | month)
    stats(ids, start, end, period, types) {
      return this.callWS({
        type: 'recorder/statistics_during_period',
        start_time: new Date(start).toISOString(),
        end_time: new Date(end || Date.now()).toISOString(),
        statistic_ids: ids, period, types, units: { energy: 'kWh' },
      });
    },
    saveCredentials(url, token) {
      try {
        url ? localStorage.setItem(LS_URL, url.trim()) : localStorage.removeItem(LS_URL);
        token ? localStorage.setItem(LS_TOKEN, token.trim()) : localStorage.removeItem(LS_TOKEN);
      } catch (e) { /* ignore */ }
    },
    savedUrl() { try { return localStorage.getItem(LS_URL) || ''; } catch (e) { return ''; } },
    hasToken() { try { return !!localStorage.getItem(LS_TOKEN); } catch (e) { return false; } },
  };
})();
