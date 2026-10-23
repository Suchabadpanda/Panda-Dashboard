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


  // ── Solar strings: roof vs ground mount ──
  // Each string's energy comes from its own lifetime counter in the long-term statistics
  // (Sigenergy: sensor.sigen_inverter_pv1_accumulated_energy, found from pv1Power by name),
  // or, with no counter, from the hourly average of its power sensor. config.energy.strings
  // can list them explicitly: [{ name, power, energy, kwp, colour }]. kwp (the string's
  // panel rating) adds kWh per kWp, which compares strings of different sizes fairly.
  const nowTs = () => (S().mode === 'demo' ? HD.demo.snapshotTime : Date.now());
  function strings() {
    const e = HD.config.energy || {};
    const list = e.strings || [
      { name: 'Roof', power: e.pv1Power, energy: e.pv1Energy, kwp: e.pv1Kwp, colour: 'var(--s-solar)' },
      { name: 'Ground mount', power: e.pv2Power, energy: e.pv2Energy, kwp: e.pv2Kwp, colour: 'var(--c3)' },
    ];
    return list.filter((x) => x.power || x.energy).map((x, i) => {
      const guess = x.power && x.power.replace(/_power$/, '_accumulated_energy');
      const energy = x.energy || (guess && guess !== x.power && S().get(guess) ? guess : null);
      return { ...x, energy, colour: x.colour || ['var(--s-solar)', 'var(--c3)', 'var(--c1)', 'var(--c5)'][i % 4] };
    });
  }

  const dayKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const monthKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}`; };
  // kWh in a statistics row: the counter's change, or the power average × the row's hours
  const rowKwh = (r, counter) => (counter ? Math.max(0, r.change || 0) : Math.max(0, r.mean || 0) * ((r.end - r.start) / 3600e3 || 1));

  let pv = null; let pvAt = 0; let pvLoading = false;
  let pvRange = 'days';          // days | months
  async function loadStrings() {
    if (pvLoading || (pv && Date.now() - pvAt < 10 * 60e3)) return;
    const list = strings(); if (!list.length) return;
    pvLoading = true;
    const ts = nowTs();
    const today0 = new Date(ts); today0.setHours(0, 0, 0, 0);
    const days0 = today0.getTime() - 30 * 864e5;
    const months0 = new Date(today0); months0.setDate(1); months0.setMonth(months0.getMonth() - 12);
    const ids = list.map((x) => x.energy || x.power);
    try {
      const counters = list.filter((x) => x.energy).map((x) => x.energy);
      const powers = list.filter((x) => !x.energy).map((x) => x.power);
      const q = (arr, start, period, types) => (arr.length ? HD.ha.stats(arr, start, ts, period, types) : Promise.resolve({}));
      const [hc, hp, dc, dp, lp] = await Promise.all([
        q(counters, days0, 'hour', ['change']), q(powers, days0, 'hour', ['mean']),
        q(counters, months0.getTime(), 'day', ['change']), q(powers, months0.getTime(), 'day', ['mean']),
        // Lifetime for a string with no counter: all the monthly averages Home Assistant has
        q(powers, Date.UTC(2015, 0, 1), 'month', ['mean']),
      ]);
      const hourly = { ...hc, ...hp }; const daily = { ...dc, ...dp };
      // Last 31 days (30 whole days + today) from hourly rows, so today is included
      const dayList = []; for (let t = days0; t <= today0.getTime(); t += 864e5) { const d = new Date(t); d.setHours(0, 0, 0, 0); if (!dayList.some((x) => x === d.getTime())) dayList.push(d.getTime()); }
      const out = list.map((x, i) => {
        const id = ids[i]; const counter = !!x.energy;
        const byDay = new Map();
        (hourly[id] || []).forEach((r) => { const k = dayKey(r.start); byDay.set(k, (byDay.get(k) || 0) + rowKwh(r, counter)); });
        const days = dayList.map((d) => byDay.get(dayKey(d)) ?? null);
        // Months from daily rows before today, plus today from the hourly rows
        const byMonth = new Map();
        (daily[id] || []).forEach((r) => { if (r.start >= today0.getTime()) return; const k = monthKey(r.start); byMonth.set(k, (byMonth.get(k) || 0) + rowKwh(r, counter)); });
        const todayKwh = days[days.length - 1] || 0;
        byMonth.set(monthKey(ts), (byMonth.get(monthKey(ts)) || 0) + todayKwh);
        const lifetimeRec = counter ? null : (lp[id] || []).reduce((a, r) => a + rowKwh(r, false), 0);
        return { ...x, days, byMonth, today: todayKwh, lifetimeRec };
      });
      // Month list: from the first month any string has data to this month
      const keys = new Set(); out.forEach((x) => x.byMonth.forEach((v, k) => { if (v > 0.05) keys.add(k); }));
      const months = [];
      const m = new Date(months0);
      while (m.getTime() <= ts) { if (keys.has(monthKey(m)) || months.length) months.push(m.getTime()); m.setMonth(m.getMonth() + 1); }
      out.forEach((x) => { x.months = months.map((t) => x.byMonth.get(monthKey(t)) ?? null); });
      pv = { list: out, days: dayList, months, at: ts };
      pvAt = Date.now();
    } catch (e) { console.warn('Solar strings unavailable', e); } finally { pvLoading = false; }
  }

  // Averages: whole days of the last 30 (not today), and whole calendar months — skipping
  // each string's first month with any output, which is usually part-month (it was
  // installed, or Home Assistant started recording, part-way through).
  function averages(x) {
    const whole = x.days.slice(0, -1).filter((v) => v != null);
    const firstM = x.months.findIndex((v) => v != null && v > 0.05);
    const mWhole = firstM < 0 ? [] : x.months.slice(firstM + 1, -1).filter((v) => v != null);
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const best = whole.length ? Math.max(...whole) : null;
    return { day: avg(whole), dayN: whole.length, month: avg(mWhole), monthN: mWhole.length, best,
      thisMonth: x.months.length ? x.months[x.months.length - 1] : null };
  }

  // Lifetime: the inverter's own counter (live, so it includes anything from before Home
  // Assistant recorded it); with no counter, what the recorded power averages add up to
  const lifetime = (x) => (x.energy && S().num(x.energy) != null ? S().num(x.energy) : x.lifetimeRec || null);
  const big = (v) => (v == null ? '–' : v >= 10000 ? `${(v / 1000).toFixed(1)} MWh` : kwh(v, 0));

  function stringsHtml() {
    const list = strings();
    if (!list.length) return '';
    const seg = `<div class="seg pv-range" role="radiogroup" aria-label="Range">${[['days', '30 days'], ['months', 'Months']].map(([k, t]) =>
      `<button class="${pvRange === k ? 'on' : ''}" role="radio" aria-checked="${pvRange === k}" data-pv-range="${k}">${t}</button>`).join('')}</div>`;
    let body = '<p class="sub">Loading…</p>';
    if (pv) {
      const av = pv.list.map((x) => ({ x, a: averages(x) }));
      const anyKwp = pv.list.some((x) => x.kwp);
      const perK = (v, x) => (x.kwp && v != null ? `<small>${(v / x.kwp).toFixed(v / x.kwp >= 20 ? 0 : 2)} kWh/kWp</small>` : '');
      const cards = av.map(({ x, a }) => `<div class="pv-card" style="--tone:${x.colour}">
          <h3><i></i>${esc(x.name)}${x.kwp ? ` <small>${x.kwp} kWp</small>` : ''}</h3>
          <dl class="kv">
            <div><dt>Now</dt><dd>${HD.u.kw(S().num(x.power))}</dd></div>
            <div><dt>Today</dt><dd>${kwh(x.today, 1)}</dd></div>
            <div><dt>Daily average</dt><dd>${kwh(a.day, 1)}${perK(a.day, x)}</dd></div>
            <div><dt>Monthly average</dt><dd>${kwh(a.month, 0)}${perK(a.month, x)}</dd></div>
            <div><dt>This month</dt><dd>${kwh(a.thisMonth, 0)}</dd></div>
            <div><dt>Best day</dt><dd>${kwh(a.best, 1)}</dd></div>
            <div><dt>Lifetime</dt><dd>${big(lifetime(x))}${perK(lifetime(x), x)}</dd></div>
          </dl></div>`).join('');
      const lifes = pv.list.map(lifetime);
      const total = lifes.every((v) => v != null) && lifes.length > 1 ? lifes.reduce((a, v) => a + v, 0) : null;
      // How the strings compare: share of the total, and per kWp when sizes are known
      let compare = '';
      if (av.length === 2 && av[0].a.day && av[1].a.day != null) {
        const [r, g] = av;
        const ratio = Math.round((g.a.day / r.a.day) * 100);
        const yieldCmp = r.x.kwp && g.x.kwp ? Math.round(((g.a.day / g.x.kwp) / (r.a.day / r.x.kwp)) * 100) : null;
        compare = `<p class="sub pv-compare">Over the last ${r.a.dayN} days the ${esc(g.x.name.toLowerCase())} made ${ratio}% as much as the ${esc(r.x.name.toLowerCase())}${yieldCmp != null ? `; per kWp of panels it made ${yieldCmp}% as much` : ''}.${!anyKwp ? ' Add pv1Kwp / pv2Kwp to the energy settings to compare per kWp.' : ''}</p>`;
      }
      const n = av[0] ? av[0].a : null;
      body = `<div class="pv-cards">${cards}</div>
        <div id="chart-pv" class="chart-box"></div>
        ${compare}
        ${total != null ? `<p class="sub pv-total">Lifetime, all strings: <strong>${big(total)}</strong>${pv.list.every((x) => x.energy) ? ", from the inverter's own counters" : ''}.</p>` : ''}
        <p class="sub">Daily average: the last ${n ? n.dayN : 30} whole days. Monthly average: whole calendar months, leaving out each string's first month (part-month) and this one.</p>`;
    }
    return `<section class="panel wide pv-panel"><header><h2>Solar strings</h2>${seg}</header>${body}</section>`;
  }

  function drawStrings() {
    const box = document.getElementById('chart-pv'); if (!box || !pv) return;
    const key = `${pvRange}|${pv.at}`;
    if (box._key === key) return;   // already drawn: live updates don't redraw the chart
    box._key = key;
    const days = pvRange === 'days';
    const ts = days ? pv.days : pv.months;
    const cats = ts.map((t) => HD.u.fmt(t, days ? { day: 'numeric', month: 'short' } : { month: 'short', year: '2-digit' }));
    const tips = ts.map((t, i) => {
      const last = i === ts.length - 1;
      return HD.u.fmt(t, days ? { weekday: 'short', day: 'numeric', month: 'short' } : { month: 'long', year: 'numeric' }) + (last ? ' (so far)' : '');
    });
    HD.chart.bars(box, {
      label: days ? 'Solar per string, last 30 days' : 'Solar per string by month', height: 210, categories: cats, tipLabels: tips,
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(days ? 1 : 0)} kWh`),
      series: pv.list.map((x) => ({ name: x.name, values: days ? x.days : x.months, color: x.colour,
        faded: (days ? x.days : x.months).map((_, i, a) => i === a.length - 1) })),
    });
  }

  // Live values re-render the page every second or so; the chart is carried over
  // rather than redrawn each time, and only redrawn when its data or range changes.
  function render() {
    const root = document.getElementById('devices'); if (!root) return;
    const oldBox = root.querySelector('#chart-pv');
    if (HD.u.setHTML(root, html()) && oldBox) { const fresh = root.querySelector('#chart-pv'); if (fresh) fresh.replaceWith(oldBox); }
    drawStrings();
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pv-range]'); if (!b) return;
    pvRange = b.dataset.pvRange;
    render();
  });

  // ── Home Assistant's own storage (Supervisor host info, GB) ──
  // Needs an admin user (the panel is admin-only), refreshed every 30 minutes.
  let disk = null; let diskAt = 0;
  async function loadDisk() {
    if (Date.now() - diskAt < 30 * 60e3) return;
    diskAt = Date.now();
    try {
      const h = await HD.ha.callWS({ type: 'supervisor/api', endpoint: '/host/info', method: 'get' });
      if (h && h.disk_total) disk = { total: h.disk_total, used: h.disk_used, free: h.disk_free };
    } catch (e) { disk = null; }   // not under Supervisor, or not an admin
  }
  function diskHtml() {
    if (!disk) return '';
    const p = Math.round((disk.used / disk.total) * 100);
    const cls = disk.free < 3 ? 'low' : disk.free < 6 ? 'mid' : '';
    return `<div class="disk ${cls}"><dt>Storage</dt><dd>${disk.free.toFixed(1)} GB free <small>of ${Math.round(disk.total)} GB</small></dd>
      <i class="bat-meter" role="img" aria-label="${p}% used"><b style="width:${p}%"></b></i></div>`;
  }

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
            ${diskHtml()}
          </dl></section>
        ${bats.length ? `<section class="panel"><header><h2>Sensor batteries</h2><p>Lowest first</p></header><ul class="bat-list">${batRows}</ul></section>` : ''}
        ${stringsHtml()}
      </div>`;
  }

  HD.views.devices = {
    title: 'Devices',
    mount(root) { root.innerHTML = '<div id="devices"></div>'; this.update(); },
    update() {
      render();
      if (!pv || Date.now() - pvAt > 10 * 60e3) loadStrings().then(render);
      if (Date.now() - diskAt > 30 * 60e3) loadDisk().then(render);
    },
  };
})();
