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
    radiator: '<path d="M4 7v11M8 6v13M12 6v13M16 6v13M20 7v11M3 10h18M3 16h18"/>',
    tap: '<path d="M4 9h9a3 3 0 0 1 3 3v1M7 9V6M4 6h6M16 16v.01M16 19.5v.01"/>',
    car: '<path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v1.5M17 19v1.5"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    gauge: '<path d="M12 14l4-6M3.5 17a9 9 0 1 1 17 0"/>',
  };
  const kwh = (v) => (v == null ? '–' : `${v.toFixed(1)} kWh`);
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
      ${s.weather ? `<p class="weather"><strong>${s.weather.temp != null ? `${Math.round(s.weather.temp)}°` : ''}</strong> ${esc(s.weather.text)}</p>` : ''}
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
      </section>
      ${heatPumpHtml(s.heatPump)}
      ${carHtml(s.car)}
      ${s.vacuum ? `<p class="line">${icon('gauge')}<span>Robot vacuum ${esc(s.vacuum.state)}${s.vacuum.battery != null ? ` · ${Math.round(s.vacuum.battery)}%` : ''}</span></p>` : ''}
      ${s.today ? `<h2>Today so far</h2><section class="today">
        <div><span>Solar</span><strong>${kwh(s.today.pv)}</strong></div><div><span>Used</span><strong>${kwh(s.today.load)}</strong></div>
        <div><span>Bought</span><strong>${kwh(s.today.bought)}</strong></div><div><span>Sold</span><strong>${kwh(s.today.sold)}</strong></div></section>` : ''}
      ${s.attention && s.attention.length ? `<h2>Attention</h2><ul class="attention">${s.attention.map((a) => `<li class="${esc(a.level)}">${icon('alert')}${esc(a.text)}</li>`).join('')}</ul>` : ''}
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

  // Heat pump: what it's doing, with the dashboard's two lamps (radiator, tap)
  function heatPumpHtml(h) {
    if (!h) return '';
    const heatCls = h.heating ? 'on' : h.heatingOn ? 'armed' : '';
    const sub = [h.running ? kw(h.kw) : '', h.heating && h.flow != null ? `flow ${Math.round(h.flow)}°` : '', h.tank != null ? `tank ${Math.round(h.tank)}°` : '', h.today != null ? `${h.today.toFixed(1)} kWh today` : ''].filter(Boolean).join(' · ');
    return `<section class="hp hp-${esc(h.key)}">
      <div><span>Heat pump</span><strong>${esc(h.label)}${h.legionella ? ' · legionella' : ''}</strong><small>${esc(sub)}</small></div>
      <div class="lamps"><span class="lamp heat ${heatCls}">${icon('radiator')}Heating</span><span class="lamp water ${h.hotWater ? 'on' : ''}">${icon('tap')}Hot water</span></div>
    </section>`;
  }

  function carHtml(c) {
    if (!c) return '';
    const what = !c.live ? 'No live data' : c.chargingKw ? `Charging ${kw(c.chargingKw)}` : c.plugged ? 'Plugged in' : c.asleep ? 'Asleep' : 'Awake';
    return `<p class="line car">${icon('car')}<span><strong>${esc(c.name)}</strong> ${c.soc != null ? `${Math.round(c.soc)}%${c.limit ? ` of ${Math.round(c.limit)}%` : ''} · ` : ''}${esc(what)}${c.live && c.via ? ` <small>via ${esc(c.via)}</small>` : ''}</span></p>`;
  }

  // The height the panel wants: header + everything in the middle + footer. Measured from the
  // content itself (main's scrollHeight), not from the window, so resizing the window can't
  // feed back into the next measurement. The main process caps it to the screen.
  let lastAsked = 0;
  function fit() {
    requestAnimationFrame(() => {
      const bar = document.querySelector('.bar'); const foot = document.querySelector('.foot'); const main = $('body');
      // Bottom of the last thing in the middle (scrollHeight would never report less than the
      // current window, so the panel could only ever grow)
      const top = main.getBoundingClientRect().top - main.scrollTop;
      const kids = [...main.children];
      const content = kids.length ? Math.max(...kids.map((k) => k.getBoundingClientRect().bottom + parseFloat(getComputedStyle(k).marginBottom || 0))) - top : 0;
      const want = Math.ceil(bar.offsetHeight + content + parseFloat(getComputedStyle(main).paddingBottom || 0) + foot.offsetHeight + 2);
      if (Math.abs(want - lastAsked) < 3) return;
      lastAsked = want;
      window.panda.resize(want);
    });
  }

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
