/*
 * Devices view: what isn't on the other pages — smart plugs and their use, the
 * dishwasher, the SigenStor hardware, sensor batteries and Home Assistant's own
 * housekeeping. (Lights, TVs, the washer and the PC are on Home and Rooms.)
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, kwh, pct, ago, until, icon } = HD.u;
  const S = () => HD.store;

  function html() {
    const d = HD.config.devices;
    const plugRows = d.plugs.map((p) => {
      const sw = p.switch || p.switchSelect;
      const on = S().state(sw) === 'on';
      const w = S().num(p.power);
      const extra = p.today ? `${kwh(S().num(p.today), 2)} today · ${kwh(S().num(p.month), 0)} this month` : p.total ? `${kwh(S().num(p.total), 1)} lifetime` : '';
      return `<li><button class="tile ${on ? 'on' : ''}" data-toggle="${sw}" aria-pressed="${on}" ${S().available(sw) ? '' : 'disabled'}>
        ${icon('plug')}<span><strong>${esc(p.name)}</strong><small>${extra}</small></span><em>${w != null ? `${Math.round(w)} W` : on ? 'On' : 'Off'}</em></button></li>`;
    }).join('');

    // Battery-powered sensors, lowest first
    const bats = (d.sensorBatteries || []).map((id) => ({ id, v: S().num(id), name: (S().attr(id, 'friendly_name') || id).replace(/\s*battery( percentage| level)?$/i, '') }))
      .filter((b) => S().get(b.id)).sort((a, b) => (a.v ?? 101) - (b.v ?? 101));
    const batRows = bats.map((b) => `<li class="${b.v != null && b.v < 15 ? 'low' : b.v != null && b.v < 30 ? 'mid' : ''}"><span>${esc(b.name)}</span>
      <i class="bat-meter"><b style="width:${b.v ?? 0}%"></b></i><strong>${b.v == null ? '–' : `${Math.round(b.v)}%`}</strong></li>`).join('');

    const e = HD.config.energy;
    return `
      <div class="panel-grid devices">
        <section class="panel"><header><h2>Smart plugs</h2></header><ul class="tiles">${plugRows}</ul></section>
        ${HD.dishwasher ? HD.dishwasher.cardHtml() : ''}
        <section class="panel"><header><h2>Solar and battery hardware</h2></header>
          <dl class="kv">
            <div><dt>EMS mode</dt><dd>${esc(S().state(e.emsMode) || '–')}</dd></div>
            <div><dt>Battery health</dt><dd>${pct(S().num(e.soh))}</dd></div>
            <div><dt>Cell temp</dt><dd>${S().num(e.cellTemp) ?? '–'}°C</dd></div>
            <div><dt>Inverter temp</dt><dd>${S().num(e.inverterTemp) ?? '–'}°C</dd></div>
            <div><dt>Roof strings now</dt><dd>${HD.u.kw(S().num(e.pv1Power))}</dd></div>
            <div><dt>Ground mount now</dt><dd>${HD.u.kw(S().num(e.pv2Power))}</dd></div>
          </dl></section>
        <section class="panel"><header><h2>Home Assistant</h2></header>
          <dl class="kv">
            <div><dt>Last backup</dt><dd>${S().state(d.backupLast) ? ago(S().state(d.backupLast)) : '–'}</dd></div>
            <div><dt>Next backup</dt><dd>${S().state(d.backupNext) ? until(S().state(d.backupNext)) : '–'}</dd></div>
            <div><dt>Connection</dt><dd>${esc(S().message)}</dd></div>
          </dl></section>
        ${bats.length ? `<section class="panel"><header><h2>Sensor batteries</h2><p>Lowest first</p></header><ul class="bat-list">${batRows}</ul></section>` : ''}
      </div>`;
  }

  HD.views.devices = {
    title: 'Devices',
    mount(root) { root.innerHTML = '<div id="devices"></div>'; this.update(); },
    update() { HD.u.setHTML(document.getElementById('devices'), html()); },
  };
})();
