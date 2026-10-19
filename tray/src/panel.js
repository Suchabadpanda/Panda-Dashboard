'use strict';
/* Quick panel: draws the main process's snapshot; every action goes back through window.panda. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kw = (v) => (v == null ? '–' : Math.abs(v) < 1 ? `${Math.round(Math.abs(v) * 1000)} W` : `${Math.abs(v).toFixed(1)} kW`);
  const hhmm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const I = {
    lightsoff: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3zM3 3l18 18"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    snow: '<path d="M12 2v20M4.9 7l14.2 10M19.1 7L4.9 17"/>',
    power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    mute: '<path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
  };
  const icon = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${I[n] || I.power}</svg>`;

  let armed = null; let armTimer = null;   // shortcut waiting for its confirming second tap
  let last = null;

  function render(s) {
    last = s;
    $('dot').className = `dot ${s.status === 'connected' ? 'ok' : s.status === 'auth-failed' ? 'bad' : 'wait'}`;
    $('dot').title = s.status === 'connected' ? 'Connected' : s.status;
    if (s.title) $('title').textContent = s.title.replace(/ Dashboard$/, '');
    $('open-dash').disabled = !s.ready;
    if (!s.ready) {
      $('body').innerHTML = `<p class="message">${esc(s.error || 'Connecting to Home Assistant…')}</p>
        ${s.status === 'auth-failed' || !s.status || s.status === 'idle' ? '<button class="btn" data-act="settings">Open settings</button>' : ''}`;
      fit(); return;
    }
    const r = s.rate;
    const grid = s.grid == null ? '' : s.grid > 0.05 ? `Buying ${kw(s.grid)}` : s.grid < -0.05 ? `Selling ${kw(s.grid)}` : 'Grid idle';
    const bat = s.battery == null ? '' : s.battery > 0.05 ? `charging ${kw(s.battery)}` : s.battery < -0.05 ? `supplying ${kw(s.battery)}` : 'idle';
    $('body').innerHTML = `
      ${s.error ? `<p class="note">${esc(s.error)}</p>` : ''}
      <section class="now">
        ${r ? `<div class="rate ${r.offPeak ? 'cheap' : 'peak'}"><span>${r.offPeak ? 'Cheap rate' : 'Peak rate'}</span>
          <strong>${r.pence.toFixed(2).replace(/\.?0+$/, '')}p</strong><small>until ${hhmm(r.until)} · export ${r.exportPence.toFixed(1)}p</small></div>` : ''}
        <div class="stat"><span>Battery</span><strong>${s.soc == null ? '–' : `${Math.round(s.soc)}%`}</strong><small>${esc(bat)}</small>
          <i class="bar-meter"><b data-w="${Math.max(0, Math.min(100, s.soc || 0))}"></b></i></div>
      </section>
      <section class="flows">
        <div><span>Solar</span><strong>${kw(s.pv)}</strong></div>
        <div><span>House</span><strong>${kw(s.load)}</strong></div>
        <div><span>Grid</span><strong>${esc(grid || '–')}</strong></div>
        ${s.heatPump ? `<div><span>Heat pump</span><strong>${s.heatPump.running ? kw(s.heatPump.kw) : 'Resting'}</strong>${s.heatPump.tank != null ? `<small>tank ${s.heatPump.tank.toFixed(0)}°</small>` : ''}</div>` : ''}
      </section>
      ${s.shortcuts.length ? `<h2>Shortcuts</h2><section class="shortcuts">
        ${s.shortcuts.map((sc) => `<button class="sc ${sc.on ? 'on' : ''} ${sc.danger ? 'danger' : ''} ${armed === sc.i ? 'armed' : ''}" data-sc="${sc.i}" ${sc.ok ? '' : 'disabled'}>
          ${icon(sc.icon)}<strong>${armed === sc.i ? 'Tap again' : esc(sc.name)}</strong><small>${esc(armed === sc.i ? (sc.confirm || '') : sc.sub)}</small></button>`).join('')}
      </section>` : ''}
      ${s.lights.length ? `<h2>Lights</h2><section class="lights">
        ${s.lights.map((l) => `<button class="chip ${l.on ? 'on' : ''}" data-light="${esc(l.id)}" ${l.available ? '' : 'disabled'}>${icon('bulb')}${esc(l.name)}</button>`).join('')}
      </section>` : ''}
      ${s.personal === false ? '<p class="note">Using the example settings: Panda Dashboard has no config.js of your own yet.</p>' : ''}`;
    document.querySelectorAll('[data-w]').forEach((b) => { b.style.width = `${b.dataset.w}%`; });   // CSP-safe
    fit();
  }

  function fit() { requestAnimationFrame(() => window.panda.resize(document.body.scrollHeight)); }

  function flash(el, text) {
    const n = document.createElement('div'); n.className = 'toast'; n.textContent = text;
    document.body.appendChild(n); setTimeout(() => n.remove(), 2600);
    if (el) el.blur();
  }

  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button'); if (!t || t.disabled) return;
    if (t.id === 'open-dash') return window.panda.openDashboard();
    if (t.id === 'open-settings' || t.dataset.act === 'settings') return window.panda.openSettings();
    if (t.dataset.light) {
      t.classList.toggle('on');   // feels instant; the next state update confirms it
      try { await window.panda.toggleLight(t.dataset.light); } catch (e) { flash(t, `Couldn't switch it: ${e.message}`); }
      return;
    }
    if (t.dataset.sc != null) {
      const i = +t.dataset.sc; const sc = last.shortcuts.find((x) => x.i === i);
      if (sc.confirm && armed !== i) {   // first tap arms it, the second within 4 s runs it
        armed = i; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; render(last); }, 4000);
        render(last); return;
      }
      armed = null; clearTimeout(armTimer);
      t.disabled = true;
      try { await window.panda.shortcut(i); flash(null, `${sc.name}: done`); } catch (e) { flash(null, `${sc.name} didn't work: ${e.message}`); }
      render(last);
    }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') window.panda.hide(); });

  window.panda.onState(render);
})();
