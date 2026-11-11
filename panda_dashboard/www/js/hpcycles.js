/*
 * Heat pump cycling (Energy page): hourly kWh bars and the 5-minute power trace under
 * them, so you can see how often the compressor starts and how long each run lasts.
 *
 * Data (config.heatPump):
 *   power      kW sensor; its 5-minute statistics give the trace and the runs. `subtract`
 *              loads on the same circuit are taken off each 5-minute reading.
 *   energy     kWh lifetime counter for the hourly bars (default energy.totals.heatPump).
 *              Hours the counter hasn't got yet (the current one) come from the power trace.
 *   runningAbove  kW above which a 5-minute reading counts as running (default 0.1)
 *   shortRun   minutes; runs this short or shorter count as short cycles (default 20)
 *
 * Runs are found from 5-minute averages, so a run is at least 5 minutes long and two runs
 * less than 5 minutes apart look like one. Home Assistant keeps 5-minute statistics for
 * as long as the recorder keeps history (10 days by default), plenty for 48 hours.
 */
window.HD = window.HD || {};

(function () {
  const S = () => HD.store;
  const C = () => HD.config.heatPump || {};
  const nowTs = () => (S().mode === 'demo' && HD.demo ? HD.demo.snapshotTime : Date.now());
  const H = 3600e3; const M5 = 5 * 60e3;

  let range = 24;            // hours: 24 | 48
  let data = null; let at = 0; let loading = false; let loadedRange = null;

  const energyId = () => C().energy || ((HD.config.energy || {}).totals || {}).heatPump;
  const subtractIds = () => [].concat(C().subtract || []).filter(Boolean);

  async function load(force) {
    if (loading || !C().power) return;
    if (!force && data && loadedRange === range && Date.now() - at < 5 * 60e3) return;
    loading = true;
    const want = range;                         // the range can be switched while this is loading
    const ts = nowTs();
    const end = Math.ceil(ts / H) * H;          // to the end of this hour
    const start = end - want * H;
    const pid = C().power; const sub = subtractIds(); const eid = energyId();
    try {
      const [fine, hourly] = await Promise.all([
        HD.ha.stats([pid, ...sub], start, ts, '5minute', ['mean']),
        eid ? HD.ha.stats([eid], start, ts, 'hour', ['change']).catch(() => ({})) : Promise.resolve({}),
      ]);
      // 5-minute heat pump power, the other loads on its circuit taken off
      const others = sub.map((id) => new Map((fine[id] || []).map((r) => [r.start, r.mean || 0])));
      const pts = (fine[pid] || []).filter((r) => r.mean != null)
        .map((r) => [r.start, Math.max(0, r.mean - others.reduce((a, m) => a + (m.get(r.start) || 0), 0))]);

      // Runs: consecutive 5-minute readings above the running line
      const on = C().runningAbove ?? 0.1;
      const runs = []; let cur = null;
      pts.forEach(([t, kw], i) => {
        const gap = i > 0 && t - pts[i - 1][0] > M5;    // missing readings end a run
        if (kw > on && cur && !gap) { cur.end = t + M5; cur.kwh += kw / 12; cur.peak = Math.max(cur.peak, kw); }
        else if (kw > on) { cur = { start: t, end: t + M5, kwh: kw / 12, peak: kw, open: i === 0 }; runs.push(cur); }
        else cur = null;
      });
      // A run still going at the last reading hasn't finished yet
      if (runs.length && pts.length && runs[runs.length - 1].end === pts[pts.length - 1][0] + M5 && ts - pts[pts.length - 1][0] < 15 * 60e3) runs[runs.length - 1].ongoing = true;

      // Hourly bars: the counter where it has the hour, otherwise the power trace
      const counter = new Map(((hourly || {})[eid] || []).map((r) => [r.start, Math.max(0, r.change || 0)]));
      const hours = [];
      for (let t = start; t < end; t += H) {
        const p = pts.filter(([x]) => x >= t && x < t + H);
        const est = p.length ? p.reduce((a, [, v]) => a + v / 12, 0) : null;
        const hrRuns = runs.filter((r) => r.start >= t && r.start < t + H && !r.open);
        const runMin = p.filter(([, v]) => v > on).length * 5;
        hours.push({ t, kwh: counter.has(t) ? counter.get(t) : est, fromCounter: counter.has(t), starts: hrRuns.length, runMin, current: t <= ts && ts < t + H });
      }
      data = { pts, runs, hours, start, end, ts };
      loadedRange = want; at = Date.now();
    } catch (e) { console.warn('Heat pump cycling unavailable', e); } finally { loading = false; }
  }

  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`);
  const runMins = (r) => (r.end - r.start) / 60e3;

  function summary() {
    const shortRun = C().shortRun ?? 20;
    const done = data.runs.filter((r) => !r.open);
    const finished = done.filter((r) => !r.ongoing);
    const lens = finished.map(runMins);
    const kwhTotal = data.hours.reduce((a, h) => a + (h.kwh || 0), 0);
    const short = lens.filter((m) => m <= shortRun).length;
    const offs = [];
    for (let i = 1; i < data.runs.length; i++) offs.push((data.runs[i].start - data.runs[i - 1].end) / 60e3);
    const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const busiest = data.hours.reduce((b, h) => (h.starts > (b ? b.starts : 0) ? h : b), null);
    return { kwhTotal, starts: done.length, avgRun: avg(lens), longest: lens.length ? Math.max(...lens) : null, short, shortRun, avgOff: avg(offs), busiest, onMin: data.hours.reduce((a, h) => a + h.runMin, 0) };
  }

  function html() {
    if (!C().power) return '';
    const { esc, kwh } = HD.u;
    const seg = `<div class="seg pv-range" role="radiogroup" aria-label="Range">${[[24, '24 hours'], [48, '48 hours']].map(([k, t]) =>
      `<button class="${range === k ? 'on' : ''}" role="radio" aria-checked="${range === k}" data-hpc-range="${k}">${t}</button>`).join('')}</div>`;
    let body = '<p class="sub">Loading…</p>';
    if (data && loadedRange === range) {
      const s = summary();
      const m = HD.heatpump ? HD.heatpump.mode() : null;
      const cyc = (s.starts / range).toFixed(1);
      body = `<dl class="kv hpc-kv">
          <div><dt>Now</dt><dd>${m ? esc(m.label) : '–'} <small>${HD.u.kw(HD.heatpump ? HD.heatpump.kw() : S().num(C().power))}</small></dd></div>
          <div><dt>Used</dt><dd>${kwh(s.kwhTotal, 1)}</dd></div>
          <div><dt>Starts</dt><dd>${s.starts} <small>${cyc} an hour</small></dd></div>
          <div><dt>Average run</dt><dd>${s.avgRun != null ? mins(s.avgRun) : '–'}</dd></div>
          <div><dt>Longest run</dt><dd>${s.longest != null ? mins(s.longest) : '–'}</dd></div>
          <div><dt>Average rest</dt><dd>${s.avgOff != null ? mins(s.avgOff) : '–'}</dd></div>
          <div class="${s.short >= 3 ? 'warn' : ''}"><dt>Short runs</dt><dd>${s.short} <small>${s.shortRun} min or less</small></dd></div>
          <div><dt>Running</dt><dd>${mins(s.onMin)} <small>${Math.round((s.onMin / (range * 60)) * 100)}% of the time</small></dd></div>
        </dl>
        <div id="chart-hpc" class="chart-box"></div>
        <div id="chart-hpc-power" class="chart-box"></div>`;
    }
    return `<header><h2>Heat pump cycling</h2>${seg}</header>${body}`;
  }

  // Fills the page's <section id="hpc">. Live values re-render it every second or so; the
  // charts are carried over rather than redrawn each time, and only redrawn when their data changes.
  const IDS = ['chart-hpc', 'chart-hpc-power'];
  function render() {
    const host = document.getElementById('hpc'); if (!host) return;
    const old = IDS.map((id) => host.querySelector(`#${id}`));
    if (HD.u.setHTML(host, html())) IDS.forEach((id, i) => { const fresh = host.querySelector(`#${id}`); if (fresh && old[i]) fresh.replaceWith(old[i]); });
    draw();
    // Reload only when no load is running, and after a failed one wait before trying again.
    // render() runs on every live update: chaining another render onto a load that returned
    // straight away (one already running, or Home Assistant not connected) made a loop that
    // never let go of the page, so the answer being waited for could never arrive.
    if (stale() && !loading && Date.now() - triedAt > RETRY) {
      triedAt = Date.now();
      load().then(() => { if (document.getElementById('hpc')) render(); });
    }
  }
  const RETRY = 30e3; let triedAt = 0;
  const stale = () => !data || loadedRange !== range || Date.now() - at > 5 * 60e3;

  function draw() {
    const box = document.getElementById('chart-hpc'); const pbox = document.getElementById('chart-hpc-power');
    if (!box || !pbox || !data) return;
    const key = `${range}|${data.ts}|${at}`;
    if (box._key === key) return;
    box._key = key;
    const hrs = data.hours;
    const twoDays = range > 24;
    const cats = hrs.map((h) => HD.u.fmt(h.t, { hour: '2-digit' }));
    const tips = hrs.map((h) => `${HD.u.fmt(h.t, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}–${HD.u.fmt(h.t + H, { hour: '2-digit', minute: '2-digit' })}${h.current ? ' (so far)' : ''}`);
    HD.chart.bars(box, {
      label: `Heat pump energy per hour, last ${range} hours`, height: 190, categories: cats, tipLabels: tips,
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(2)} kWh`),
      series: [{ name: 'Heat pump', values: hrs.map((h) => h.kwh), color: 'var(--c2)',
        colors: hrs.map((h) => (h.starts >= 3 ? 'var(--warning)' : null)),
        faded: hrs.map((h) => h.current) }],
      tipExtra: (i) => {
        const h = hrs[i];
        return `<div class="tip-note">${h.starts} start${h.starts === 1 ? '' : 's'} · running ${h.runMin} min</div>`;
      },
      empty: 'No heat pump data for this period yet.',
    });
    HD.chart.line(pbox, {
      label: `Heat pump power, 5-minute averages, last ${range} hours`, height: 150, endLabels: false, ticks: 3,
      xMin: data.start, xMax: data.end, xTicks: window.innerWidth <= 820 ? 4 : twoDays ? 8 : 6, zero: true,
      xFormat: (t) => HD.u.fmt(t, twoDays ? { weekday: 'short', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' }),
      tipX: (t) => HD.u.fmt(t, { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
      format: (v, tick) => (tick ? `${v}` : `${v.toFixed(2)} kW`),
      series: [(() => { const g = gapped(data.pts); return { name: 'Power', points: g, color: 'var(--c2)', area: g.every((p) => p[1] != null) }; })()],
      empty: 'No heat pump power readings for this period yet.',
    });
  }

  // Break the line where readings are missing rather than drawing across the gap
  function gapped(pts) {
    const out = [];
    pts.forEach((p, i) => { if (i && p[0] - pts[i - 1][0] > 2 * M5) out.push([pts[i - 1][0] + M5, null]); out.push(p); });
    return out;
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hpc-range]'); if (!b) return;
    const r = Number(b.dataset.hpcRange); if (r === range) return;
    range = r; triedAt = 0;
    render();
  });

  HD.hpCycles = { render, enabled: () => !!C().power };
})();
