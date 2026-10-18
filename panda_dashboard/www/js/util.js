/* Formatting + DOM helpers shared by every view. */
window.HD = window.HD || {};

(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const kw = (v) => (v == null ? '–' : Math.abs(v) < 1 ? `${Math.round(Math.abs(v) * 1000)} W` : `${Math.abs(v).toFixed(2)} kW`);
  const kwh = (v, dp = 1) => (v == null ? '–' : `${v.toFixed(dp)} kWh`);
  const gbp = (v, dp = 2) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`);
  const pence = (v) => `${(v * 100).toFixed(v * 100 % 1 ? 2 : 0)}p`;
  const temp = (v) => (v == null ? '–' : `${v.toFixed(1)}°`);
  const pct = (v) => (v == null ? '–' : `${Math.round(v)}%`);
  const time = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
  };
  const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name] || ''}</svg>`;

  HD.u = { esc, kw, kwh, gbp, pence, temp, pct, time, dur, ago, until, icon };
})();
