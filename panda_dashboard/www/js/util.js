/* Formatting + DOM helpers shared by every view. */
window.HD = window.HD || {};

(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const kw = (v) => (v == null ? '–' : Math.abs(v) < 1 ? `${Math.round(Math.abs(v) * 1000)} W` : `${Math.abs(v).toFixed(2)} kW`);
  const kwh = (v, dp = 1) => (v == null ? '–' : `${v.toFixed(dp)} kWh`);
  const gbp = (v, dp = 2) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
  const pence = (v) => `${parseFloat((v * 100).toFixed(2))}p`;
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const temp = (v) => (v == null ? '–' : `${v.toFixed(1)}°`);
  const pct = (v) => (v == null ? '–' : `${Math.round(v)}%`);
  // Date formatting: an Intl.DateTimeFormat is costly to build and toLocale*String builds a
  // new one on every call, so formatters are made once per option set and reused.
  const fmts = new Map();
  const fmt = (d, opts) => {
    const k = JSON.stringify(opts);
    let f = fmts.get(k); if (!f) { f = new Intl.DateTimeFormat('en-GB', opts); fmts.set(k, f); }
    return f.format(d instanceof Date ? d : new Date(d));
  };
  const time = (d) => fmt(d, { hour: '2-digit', minute: '2-digit' });
  const dur = (mins) => {
    if (mins == null || !Number.isFinite(mins)) return '–';
    const h = Math.floor(mins / 60); const m = Math.round(mins % 60);
    return h ? `${h} h ${m} min` : `${m} min`;
  };
  const ago = (iso) => {
    const d = (Date.now() - Date.parse(iso)) / 60000;
    if (!Number.isFinite(d)) return '–';
    if (d < 1) return 'just now';
    if (d < 60) return `${Math.round(d)} min ago`;
    if (d < 1440) return `${Math.round(d / 60)} h ago`;
    return `${Math.round(d / 1440)} days ago`;
  };
  const until = (iso) => {
    const d = (Date.parse(iso) - Date.now()) / 60000;
    if (!Number.isFinite(d)) return '–';
    if (d < 60) return `in ${Math.max(0, Math.round(d))} min`;
    if (d < 1440) return `in ${Math.round(d / 60)} h`;
    return `in ${Math.round(d / 1440)} days`;
  };

  // Tiny inline icons (24px grid, stroke = currentColor)
  const I = {
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    motion: '<circle cx="13" cy="4" r="2"/><path d="M7 21l3-6 3 2v4M10 15l1-5 4 3 3 1M8 10l3-1"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/>',
    snow: '<path d="M12 2v20M4.9 7l14.2 10M19.1 7L4.9 17"/>',
    flame: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z"/>',
    gauge: '<path d="M12 14l4-6M3.5 17a9 9 0 1 1 17 0"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/>',
    power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    alert: '<path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    drop: '<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-1"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    window: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16"/>',
    door: '<path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01"/>',
    thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 17.5v-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.4 1.6A3.3 3.3 0 0 0 7 18z"/>',
    fan: '<path d="M12 12c0-3 1-7 4-7s3 4 0 5M12 12c3 0 7 1 7 4s-4 3-5 0M12 12c0 3-1 7-4 7s-3-4 0-5M12 12c-3 0-7-1-7-4s4-3 5 0"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    flash: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3zM4 4l2 2M20 4l-2 2M2 11h2M20 11h2"/>',
    pin: '<path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    mute: '<path d="M11 5L6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/>',
    lightsoff: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3zM3 3l18 18"/>',
    dish: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 8h16M7 5.5h.01M10 5.5h.01"/><circle cx="12" cy="14.5" r="3.5"/>',
    lux: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    house: '<path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5"/>',
    rooms: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h9M12 4v16M16 12v8"/>',
    car: '<path d="M5 16l1.5-5.5A2 2 0 0 1 8.4 9h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v1.5M17 19v1.5"/><circle cx="8" cy="17.5" r=".6"/><circle cx="16" cy="17.5" r=".6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    radiator: '<path d="M4 7v11M8 6v13M12 6v13M16 6v13M20 7v11M3 10h18M3 16h18"/>',
    tap: '<path d="M4 9h9a3 3 0 0 1 3 3v1M7 9V6M4 6h6M16 16v.01M16 19.5v.01"/>',
    toilet: '<path d="M6 3h5v8H6zM4 11h14a1 1 0 0 1 1 1 6 6 0 0 1-6 6h-1l1 3H8l1-3.4A6 6 0 0 1 3 12a1 1 0 0 1 1-1z"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 4.6a3.2 3.2 0 0 1 0 6.3M18 14.3a6 6 0 0 1 3 5.2V20"/>',
    tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2"/>',
    bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    paw: '<circle cx="5.5" cy="10" r="1.8"/><circle cx="9" cy="5.5" r="1.8"/><circle cx="15" cy="5.5" r="1.8"/><circle cx="18.5" cy="10" r="1.8"/><path d="M12 11c-3 0-6 4.5-6 7a2.5 2.5 0 0 0 3.5 2.2 6 6 0 0 1 5 0A2.5 2.5 0 0 0 18 18c0-2.5-3-7-6-7z"/>',
    bike: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17L9 9h6l3.5 8M9 9l3 8h-6.5M15 9l-1.5-3H11"/>',
    update: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || ''}</svg>`;

  // Write HTML only when it differs from what was last written there, so updates that
  // change nothing don't rebuild (and repaint) the page. `keep` names an <img> to carry
  // over when its src is unchanged, so pictures aren't re-fetched.
  let epoch = 0;
  function setHTML(el, html, keep) {
    if (!el || (el._html === html && el._epoch === epoch)) return false;
    const old = keep ? el.querySelector(keep) : null;
    el.innerHTML = html; el._html = html; el._epoch = epoch;
    if (old) { const fresh = el.querySelector(keep); if (fresh && fresh.getAttribute('src') === old.getAttribute('src')) fresh.replaceWith(old); }
    return true;
  }
  const invalidate = () => { epoch++; };   // next update redraws everything (e.g. after a failed toggle)

  // An energy sensor's live state in kWh, whatever unit it reports in (statistics are
  // always fetched in kWh, but a state can be Wh or MWh: Sigenergy's PV counters are MWh)
  const ENERGY = { wh: 1e-3, kwh: 1, mwh: 1e3, gwh: 1e6 };
  function stateKwh(id) {
    const v = HD.store.num(id); if (v == null) return null;
    const u = String(HD.store.attr(id, 'unit_of_measurement') || 'kWh').toLowerCase();
    return v * (ENERGY[u] ?? 1);
  }
  HD.u = { fmt, cap, esc, kw, kwh, gbp, pence, temp, pct, time, dur, ago, until, icon, setHTML, invalidate, stateKwh };
})();
