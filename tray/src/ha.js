'use strict';
/*
 * Minimal Home Assistant WebSocket client for the main process.
 * - authenticates with a long-lived access token
 * - keeps the full state map up to date (get_states + state_changed events)
 * - reconnects with back-off, but stops for good if the token is rejected
 *   (so Home Assistant's login ban never triggers)
 */
const { EventEmitter } = require('node:events');

class HAClient extends EventEmitter {
  constructor() {
    super();
    this.url = null; this.token = null;
    this.ws = null; this.id = 1; this.pending = new Map();
    this.states = {};
    this.status = 'idle';          // idle | connecting | connected | offline | auth-failed
    this.backoff = 2000; this.timer = null; this.stopped = true;
  }

  setStatus(s, detail = '') { this.status = s; this.emit('status', s, detail); }

  start(url, token) {
    this.stop();
    this.url = url.replace(/\/+$/, ''); this.token = token; this.stopped = false; this.backoff = 2000;
    this.connect();
  }

  stop() {
    this.stopped = true; clearTimeout(this.timer);
    if (this.ws) { try { this.ws.close(); } catch (e) { /* closing anyway */ } }
    this.ws = null;
    this.pending.forEach(({ reject }) => reject(new Error('disconnected')));
    this.pending.clear();
  }

  connect() {
    if (this.stopped) return;
    this.setStatus('connecting');
    const wsUrl = `${this.url.replace(/^http/, 'ws')}/api/websocket`;
    let ws;
    try { ws = new WebSocket(wsUrl); } catch (e) { return this.retry(e.message); }
    this.ws = ws;
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.retry('connection closed'); } };
    ws.onerror = () => { /* onclose follows */ };
  }

  retry(why) {
    this.pending.forEach(({ reject }) => reject(new Error(why)));
    this.pending.clear();
    if (this.stopped || this.status === 'auth-failed') return;
    this.setStatus('offline', why);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 60000);
  }

  async onMessage(m) {
    if (m.type === 'auth_required') { this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token })); return; }
    if (m.type === 'auth_invalid') {
      this.setStatus('auth-failed', m.message || 'token rejected');
      this.stopped = true; try { this.ws.close(); } catch (e) { /* already closing */ }
      return;
    }
    if (m.type === 'auth_ok') {
      this.backoff = 2000;
      try {
        const states = await this.call({ type: 'get_states' });
        this.states = Object.fromEntries(states.map((s) => [s.entity_id, s]));
        await this.call({ type: 'subscribe_events', event_type: 'state_changed' });
        this.setStatus('connected');
        this.emit('states', this.states, null);
      } catch (e) { this.retry(e.message); }
      return;
    }
    if (m.type === 'event' && m.event && m.event.event_type === 'state_changed') {
      const d = m.event.data;
      if (d.new_state) this.states[d.entity_id] = d.new_state; else delete this.states[d.entity_id];
      this.emit('states', this.states, d.entity_id);
      return;
    }
    if (m.type === 'result' && this.pending.has(m.id)) {
      const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
      if (m.success) resolve(m.result); else reject(new Error((m.error && m.error.message) || 'request failed'));
    }
  }

  call(msg, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) { reject(new Error('not connected to Home Assistant')); return; }
      const id = this.id++;
      const t = setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('Home Assistant did not answer')); } }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ ...msg, id }));
    });
  }

  callService(domain, service, data) { return this.call({ type: 'call_service', domain, service, service_data: data }); }
}

module.exports = { HAClient };
