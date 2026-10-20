/*
 * Small dependency-free SVG charts with hover tooltips.
 *   HD.chart.line(el, opts)   – time series, one shared y-axis
 *   HD.chart.bars(el, opts)   – categories, optional diverging (up/down) pair
 * Colours are CSS custom properties so light/dark themes swap them.
 */
window.HD = window.HD || {};

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  function niceTicks(min, max, count = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    if (parent) parent.appendChild(n);
    return n;
  }

  function mount(container, render) {
    if (container._ro) container._ro.disconnect();
    const draw = () => { container.innerHTML = ''; if (container.clientWidth > 0) render(container.clientWidth); };
    draw();
    container._ro = new ResizeObserver(() => { if (Math.abs((container._w || 0) - container.clientWidth) > 4) { container._w = container.clientWidth; draw(); } });
    container._w = container.clientWidth;
    container._ro.observe(container);
  }

  function tooltip(container) {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
    return {
      show(x, y, html) {
        tip.innerHTML = html; tip.hidden = false;
        const w = tip.offsetWidth; const cw = container.clientWidth;
        tip.style.left = `${Math.min(cw - w - 4, Math.max(4, x + 12))}px`;
        tip.style.top = `${Math.max(0, y - tip.offsetHeight - 8)}px`;
      },
      hide() { tip.hidden = true; },
    };
  }

  function legend(container, series) {
    if (series.length < 2) return;
    const lg = document.createElement('div');
    lg.className = 'chart-legend';
    series.forEach((s) => {
      const i = document.createElement('span');
      i.innerHTML = `<i style="background:${s.color}${s.dashed ? ';background:none;border-top:2px dashed ' + s.color + ';height:0' : ''}"></i>${s.name}`;
      lg.appendChild(i);
    });
    container.appendChild(lg);
  }

  // ── Line chart ──
  function line(container, o) {
    const H = o.height || 200;
    const fmtV = o.format || ((v) => v.toFixed(1));
    const fmtX = o.xFormat || fmtTime;
    mount(container, (W) => {
      const series = o.series.filter((s) => s.points && s.points.length);
      if (!series.length) { container.innerHTML = `<p class="empty">${o.empty || 'No data yet.'}</p>`; return; }
      legend(container, series);
      // Names at the line ends only when asked for (endLabels: true): the legend says which is which
      const labelRoom = o.endLabels === true ? 74 : (o.padRight ?? 8);
      const m = { t: 10, r: labelRoom, b: 22, l: 40 };
      const xs = series.flatMap((s) => s.points.map((p) => p[0]));
      const ys = series.flatMap((s) => s.points.map((p) => p[1]).filter((v) => v != null));
      const x0 = o.xMin ?? Math.min(...xs); const x1 = o.xMax ?? Math.max(...xs);
      let yMin = Math.min(...ys, o.yMin ?? Infinity, o.band ? o.band[0] : Infinity);
      let yMax = Math.max(...ys, o.yMax ?? -Infinity, o.band ? o.band[1] : -Infinity);
      if (o.zero) { yMin = Math.min(0, yMin); yMax = Math.max(0, yMax); }
      const ticks = niceTicks(yMin, yMax, o.ticks || 4);
      yMin = ticks[0]; yMax = ticks[ticks.length - 1];
      const sx = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
      const sy = (v) => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);

      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': o.label || '' }, container);
      if (o.band) el('rect', { x: m.l, y: sy(o.band[1]), width: W - m.l - m.r, height: Math.max(1, sy(o.band[0]) - sy(o.band[1])), class: 'band' }, svg);
      ticks.forEach((t) => {
        el('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: t === 0 && o.zero ? 'axis-zero' : 'grid' }, svg);
        el('text', { x: m.l - 6, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = fmtV(t, true);
      });
      // x ticks
      const xt = o.xTicks || 5;
      for (let i = 0; i <= xt; i++) {
        const v = x0 + ((x1 - x0) * i) / xt;
        el('text', { x: sx(v), y: H - 6, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === xt ? 'end' : 'middle' }, svg).textContent = fmtX(v);
      }
      // shading regions (e.g. off-peak window)
      (o.regions || []).forEach((r) => {
        const a = Math.max(x0, r[0]); const b = Math.min(x1, r[1]);
        if (b > a) el('rect', { x: sx(a), y: m.t, width: sx(b) - sx(a), height: H - m.t - m.b, class: 'region' }, svg);
      });

      const labels = [];
      series.forEach((s) => {
        let d = ''; let pen = false;
        s.points.forEach(([x, y]) => {
          if (y == null) { pen = false; return; }
          d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`; pen = true;
        });
        if (s.area) {
          const pts = s.points.filter((p) => p[1] != null);
          const base = sy(Math.max(yMin, 0));
          el('path', { d: `${d}L${sx(pts[pts.length - 1][0])},${base}L${sx(pts[0][0])},${base}Z`, fill: s.color, class: 'area' }, svg);
        }
        el('path', { d, stroke: s.color, class: `line${s.dashed ? ' dashed' : ''}` }, svg);
        const last = [...s.points].reverse().find((p) => p[1] != null);
        if (last && o.endLabels === true) labels.push({ y: sy(last[1]), x: sx(last[0]), s, v: last[1] });
      });
      // direct end labels, nudged apart
      labels.sort((a, b) => a.y - b.y);
      for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
      labels.forEach((l) => {
        el('circle', { cx: l.x, cy: sy(l.v), r: 3, fill: l.s.color, class: 'end-dot' }, svg);
        el('text', { x: l.x + 7, y: l.y + 4, class: 'end-label' }, svg).textContent = l.s.short || l.s.name;
      });

      // hover
      const tip = tooltip(container);
      const cross = el('line', { y1: m.t, y2: H - m.b, class: 'crosshair', visibility: 'hidden' }, svg);
      const dots = series.map((s) => el('circle', { r: 4, fill: s.color, class: 'hover-dot', visibility: 'hidden' }, svg));
      const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg);
      const move = (e) => {
        const r = svg.getBoundingClientRect();
        const px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
        const xv = x0 + ((px - m.l) / (W - m.l - m.r)) * (x1 - x0);
        let rows = '';
        let tx = null;
        series.forEach((s, i) => {
          let best = null;
          s.points.forEach((p) => { if (p[1] != null && (!best || Math.abs(p[0] - xv) < Math.abs(best[0] - xv))) best = p; });
          if (!best) return;
          tx = tx ?? best[0];
          dots[i].setAttribute('cx', sx(best[0])); dots[i].setAttribute('cy', sy(best[1])); dots[i].setAttribute('visibility', 'visible');
          rows += `<div><i style="background:${s.color}"></i>${s.name}<b>${fmtV(best[1])}</b></div>`;
        });
        if (tx == null) return;
        cross.setAttribute('x1', sx(tx)); cross.setAttribute('x2', sx(tx)); cross.setAttribute('visibility', 'visible');
        tip.show(sx(tx), m.t + 30, `<header>${(o.tipX || fmtX)(tx)}</header>${rows}`);
      };
      const leave = () => { tip.hide(); cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
      hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true });
      hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', leave);
    });
  }

  // ── Bar chart (optionally diverging: series with down:true draw below zero) ──
  function bars(container, o) {
    const H = o.height || 200;
    const fmtV = o.format || ((v) => v.toFixed(1));
    mount(container, (W) => {
      const cats = o.categories;
      if (!cats.length) { container.innerHTML = `<p class="empty">${o.empty || 'No data yet.'}</p>`; return; }
      legend(container, o.series);
      const m = { t: 10, r: 8, b: 22, l: 44 };
      const up = o.series.filter((s) => !s.down); const dn = o.series.filter((s) => s.down);
      const maxUp = Math.max(0, ...up.flatMap((s) => s.values.map((v) => v || 0)));
      const maxDn = Math.max(0, ...dn.flatMap((s) => s.values.map((v) => v || 0)));
      const ticks = niceTicks(-maxDn, maxUp, o.ticks || 4);
      const yMin = ticks[0]; const yMax = ticks[ticks.length - 1];
      const sy = (v) => m.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - m.t - m.b);
      const band = (W - m.l - m.r) / cats.length;
      const perSide = Math.max(up.length, dn.length) || 1;
      const barW = Math.max(2, Math.min(28, (band - 2) / perSide - 2));

      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img', 'aria-label': o.label || '' }, container);
      ticks.forEach((t) => {
        el('line', { x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t), class: t === 0 ? 'axis-zero' : 'grid' }, svg);
        el('text', { x: m.l - 6, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, svg).textContent = fmtV(Math.abs(t), true);
      });
      const every = Math.ceil(cats.length / Math.max(1, Math.floor((W - m.l) / 46)));
      cats.forEach((c, i) => {
        const lastOk = i === cats.length - 1 && (cats.length - 1) % every >= Math.ceil(every / 2);
        if (i % every === 0 || lastOk) el('text', { x: m.l + band * (i + 0.5), y: H - 6, class: 'tick', 'text-anchor': 'middle' }, svg).textContent = c;
      });
      const r = 3;
      const drawSide = (list, sign) => list.forEach((s, j) => {
        s.values.forEach((v, i) => {
          if (!v) return;
          const x = m.l + band * i + (band - (barW + 2) * list.length) / 2 + j * (barW + 2) + 1;
          const y0 = sy(0); const y1 = sy(sign * v);
          const h = Math.abs(y1 - y0);
          const top = Math.min(y0, y1);
          // rounded end away from the baseline
          const p = sign > 0
            ? `M${x},${y0}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${y0}Z`
            : `M${x},${y0}V${top + h - r}Q${x},${top + h} ${x + r},${top + h}H${x + barW - r}Q${x + barW},${top + h} ${x + barW},${top + h - r}V${y0}Z`;
          el('path', { d: h < r * 2 ? `M${x},${top}h${barW}v${h}h${-barW}Z` : p, fill: s.color, class: `bar${s.faded && s.faded[i] ? ' faded' : ''}` }, svg);
        });
      });
      drawSide(up, 1); drawSide(dn, -1);
      (o.overlays || []).forEach((ov) => {
        let d = '';
        ov.values.forEach((v, i) => { if (v != null) d += `${d ? 'L' : 'M'}${m.l + band * (i + 0.5)},${sy(v)}`; });
        el('path', { d, stroke: ov.color, class: 'line' }, svg);
      });

      const tip = tooltip(container);
      const hl = el('rect', { y: m.t, height: H - m.t - m.b, width: band, class: 'hover-band', visibility: 'hidden' }, svg);
      svg.insertBefore(hl, svg.firstChild);
      const hit = el('rect', { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: 'transparent' }, svg);
      const move = (e) => {
        const rc = svg.getBoundingClientRect();
        const px = (e.touches ? e.touches[0].clientX : e.clientX) - rc.left;
        const i = Math.max(0, Math.min(cats.length - 1, Math.floor((px - m.l) / band)));
        hl.setAttribute('x', m.l + band * i); hl.setAttribute('visibility', 'visible');
        const rows = [...o.series, ...(o.overlays || [])].map((s) => `<div><i style="background:${s.color}"></i>${s.name}<b>${s.values[i] == null ? '–' : fmtV(s.values[i])}</b></div>`).join('');
        tip.show(m.l + band * (i + 0.5), m.t + 30, `<header>${(o.tipLabels || cats)[i]}</header>${rows}${o.tipExtra ? o.tipExtra(i) : ''}`);
      };
      const leave = () => { tip.hide(); hl.setAttribute('visibility', 'hidden'); };
      hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true });
      hit.addEventListener('mouseleave', leave); hit.addEventListener('touchend', leave);
    });
  }

  HD.chart = { line, bars, niceTicks };
})();
