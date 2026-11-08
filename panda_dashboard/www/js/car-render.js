// Car picture from Tesla's own configurator (config.ev.render), shown on the Car page in
// place of the drawing. The pictures are rendered live by Tesla for the car's option codes
// and fetched from static-assets.tesla.com; nothing is stored in the add-on. Each view is
// cropped to the car (Tesla's canvas is mostly empty) and kept as a blob URL for the session.
// Swipe (or the dots / arrows) between views. If Tesla returns nothing usable, the Car page
// falls back to its own drawing (HD.carRender.ok() is false).
//
//   ev.render: { options: '$MTY62,$PN01,$WY19P,$IPB10', model: 'my', views: ['3qtr', 'side', 'rear'] }
(function () {
  const C = () => HD.config.ev || {};
  const BASE = 'https://static-assets.tesla.com/configurator/compositor';
  const VIEWS = { '3qtr': ['STUD_3QTR', 'Front three-quarter'], side: ['STUD_SIDE', 'Side'], rear: ['STUD_REAR', 'Rear'], front: ['STUD_FRONT34', 'Front'], interior: ['STUD_SEAT', 'Interior'] };
  const RETRY = 10 * 60e3;

  let key = '';           // config the pictures were made for
  let pics = [];          // [{ view, label, url|null, state: 'loading'|'ok'|'fail' }]
  let triedAt = 0;
  let node = null;        // the persistent figure, moved into each new card markup
  let index = 0;

  function cfg() {
    const r = C().render; if (!r) return null;
    const o = typeof r === 'string' ? { options: r } : r;
    if (!o.options) return null;
    const opts = String(o.options).split(',').map((s) => s.trim()).filter(Boolean).map((s) => (s[0] === '$' ? s : `$${s}`)).join(',');
    const views = (o.views || ['3qtr', 'side', 'rear']).map((v) => String(v).toLowerCase()).filter((v) => VIEWS[v]);
    return { model: o.model || 'my', options: opts, views: views.length ? views : ['3qtr'], size: o.size || 1200 };
  }
  const urlFor = (c, view) => `${BASE}?context=design_studio_2&model=${encodeURIComponent(c.model)}&options=${encodeURIComponent(c.options)}&view=${VIEWS[view][0]}&size=${c.size}&bkba_opt=1`;

  // Load one view and crop it to the car and its shadow. A missing or wrong option code gives an
  // HTTP error, or an image with only a faint shadow in it: both count as a failure.
  function loadView(src) {
    return new Promise((resolve) => {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
      const timer = setTimeout(() => resolve(null), 20e3);
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.onload = () => {
        clearTimeout(timer);
        try {
          const w = img.naturalWidth; const h = img.naturalHeight;
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
          const px = x.getImageData(0, 0, w, h).data;
          let x0 = w; let y0 = h; let x1 = -1; let y1 = -1; let solid = 0; let seen = 0;
          for (let y = 0; y < h; y += 2) {
            for (let xx = 0; xx < w; xx += 2) {
              const a = px[(y * w + xx) * 4 + 3]; seen++;
              if (a > 200) solid++;
              if (a > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            }
          }
          if (x1 < 0 || solid / seen < 0.01) { resolve(null); return; }
          const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
          x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
          const out = document.createElement('canvas'); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
          out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
          out.toBlob((b) => resolve(b ? { url: URL.createObjectURL(b), w: out.width, h: out.height } : null), 'image/png');
        } catch (e) { resolve(null); }   // no CORS: can't check or crop it
      };
      img.src = src;
    });
  }

  function load() {
    const c = cfg(); if (!c) return;
    const k = JSON.stringify(c);
    if (k === key && (pics.some((p) => p.state !== 'fail') || Date.now() - triedAt < RETRY)) return;
    pics.forEach((p) => p.url && URL.revokeObjectURL(p.url));
    key = k; triedAt = Date.now(); index = 0;
    pics = c.views.map((v) => ({ view: v, label: VIEWS[v][1], url: null, state: 'loading' }));
    const mine = pics;
    c.views.forEach((v, i) => loadView(urlFor(c, v)).then((r) => {
      if (pics !== mine) { if (r) URL.revokeObjectURL(r.url); return; }
      Object.assign(pics[i], r ? { url: r.url, w: r.w, h: r.h, state: 'ok' } : { state: 'fail' });
      build();
      if (HD.views.car && document.getElementById('car-card')) HD.views.car.update();
    }));
  }

  const shown = () => pics.filter((p) => p.state === 'ok');
  // On while configured and either still loading or at least one view worked
  const ok = () => !!cfg() && pics.length > 0 && (shown().length > 0 || pics.some((p) => p.state === 'loading'));
  const loading = () => !shown().length && pics.some((p) => p.state === 'loading');

  function build() {
    const list = shown();
    if (!node) {
      node = document.createElement('figure'); node.className = 'car-render';
      node.innerHTML = '<div class="crv-track" tabindex="0" aria-label="Pictures of the car, swipe for more views"></div><div class="crv-state"></div><button class="crv-arrow prev" data-crv="-1" aria-label="Previous view"></button><button class="crv-arrow next" data-crv="1" aria-label="Next view"></button><div class="crv-dots"></div><div class="crv-tyres"></div>';
      node.querySelector('.prev').innerHTML = HD.u.icon('chevron-left');
      node.querySelector('.next').innerHTML = HD.u.icon('chevron-right');
      const track = node.querySelector('.crv-track');
      track.addEventListener('scroll', () => {
        const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        if (i !== index) { index = i; dots(); }
      }, { passive: true });
      track.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); go(index + (e.key === 'ArrowLeft' ? -1 : 1)); } });
      node.addEventListener('click', (e) => {
        const b = e.target.closest('[data-crv], [data-crv-to]'); if (!b) return;
        go(b.dataset.crvTo != null ? +b.dataset.crvTo : index + +b.dataset.crv);
      });
    }
    const track = node.querySelector('.crv-track');
    const html = list.length
      ? list.map((p) => `<div class="crv-slide"><img src="${p.url}" width="${p.w}" height="${p.h}" alt="The car, ${p.label.toLowerCase()} view" draggable="false"></div>`).join('')
      : '<div class="crv-slide crv-wait"><span>Loading the car…</span></div>';
    if (track._html !== html) { track.innerHTML = html; track._html = html; index = Math.min(index, Math.max(0, list.length - 1)); }
    node.classList.toggle('single', list.length < 2);
    dots();
  }
  function dots() {
    if (!node) return;
    const list = shown();
    const d = node.querySelector('.crv-dots');
    const html = list.length > 1 ? list.map((p, i) => `<button data-crv-to="${i}" class="${i === index ? 'on' : ''}" aria-label="${p.label} view" ${i === index ? 'aria-current="true"' : ''}></button>`).join('') : '';
    if (d._html !== html) { d.innerHTML = html; d._html = html; }
    node.querySelector('.prev').disabled = index <= 0;
    node.querySelector('.next').disabled = index >= list.length - 1;
  }
  function go(i) {
    const list = shown(); if (!node || !list.length) return;
    index = Math.max(0, Math.min(list.length - 1, i));
    const track = node.querySelector('.crv-track');
    track.scrollTo({ left: index * track.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    dots();
  }

  // What the drawing used to show on the car itself, as badges over the picture, plus the
  // tyre pressures underneath. Locks, doors, windows and climate are in the chips beside it;
  // asleep is the header pill (the picture dims too).
  function overlay(st, tyres, target) {
    if (!node) return;
    const { icon, esc } = HD.u;
    const badge = (cls, ic, text) => `<span class="crv-badge ${cls}">${icon(ic)}${esc(text)}</span>`;
    const b = [
      st.charging ? badge('charge', 'plug', st.chargeText || 'Charging') : st.plugged ? badge('plug', 'plug', 'Plugged in') : '',
      st.frunk ? badge('warn', 'box', 'Frunk open') : '',
      st.trunk ? badge('warn', 'box', 'Boot open') : '',
      st.sentry ? badge('sentry', 'eye', 'Sentry') : '',
    ].join('');
    const s = node.querySelector('.crv-state');
    if (s._html !== b) { s.innerHTML = b; s._html = b; }
    const low = (v) => v != null && v < target - 3;
    const names = ['Front left', 'Front right', 'Rear left', 'Rear right'];
    const t = tyres.some((v) => v != null)
      ? names.map((n, i) => `<div class="${low(tyres[i]) ? 'low' : ''}"><span>${n}</span><b>${tyres[i] == null ? '–' : Math.round(tyres[i])}<small> psi</small></b></div>`).join('')
      : '';
    const ty = node.querySelector('.crv-tyres');
    if (ty._html !== t) { ty.innerHTML = t; ty._html = t; }
    ['asleep', 'charging', 'flashing'].forEach((k) => node.classList.toggle(k, !!st[k]));
    node.classList.toggle('loading', loading());
  }

  // Called after the car card is (re)written: move the persistent figure into its slot
  function place(card, st, tyres, target) {
    if (!ok()) return;
    build(); overlay(st, tyres, target);
    const slot = card && card.querySelector('.car-render-slot');
    if (slot && node.parentNode !== slot) {
      const keep = index; slot.appendChild(node);
      requestAnimationFrame(() => { const tr = node.querySelector('.crv-track'); tr.scrollLeft = keep * tr.clientWidth; });
    }
  }

  // Keep the shown view lined up when the frame changes width (scroll-snap alone can drift)
  window.addEventListener('resize', () => { if (node && node.isConnected) { const tr = node.querySelector('.crv-track'); tr.scrollLeft = index * tr.clientWidth; } });

  HD.carRender = { load, ok, place, url: (view = '3qtr') => { const c = cfg(); return c && urlFor(c, view); } };
})();
