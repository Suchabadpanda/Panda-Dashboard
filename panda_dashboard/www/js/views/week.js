/*
 * Week view: a Monday–Sunday timetable.
 *   - Work blocks: each workday's start time (helper input_datetime.work_start_<day>, else
 *     saved on this screen) plus its hours (input_number.work_hours_<day>, else config).
 *   - Routine blocks: generated from config.week.routine, so nothing is written to a calendar.
 *   - Calendar events: Home Assistant calendars via calendar.get_events, de-duplicated on
 *     title + start. Any timed event that overlaps the day's work block is a clash.
 *   - To-dos: todo.get_items (needs_action), tickable for screens that can control things.
 * Phones (≤ 760 px) get a day-by-day agenda instead of the grid. All personal values (routine
 * text, calendars) live in config.js; this file is generic.
 */
window.HD = window.HD || {};
HD.views = HD.views || {};

(function () {
  const { esc, icon } = HD.u;
  const S = () => HD.store;
  const C = () => HD.config.week || {};
  const KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const TOP = 6; const BOTTOM = 22; const PX = 56;          // hours shown, pixels per hour
  const MIN_H = 26;                                          // smallest block drawn, px
  const RELOAD = 5 * 60e3;

  const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage blocked */ } };

  // ── Time helpers (hours as decimals, 24-hour clock) ──
  const toH = (v) => {
    if (typeof v === 'number') return v;
    const m = String(v ?? '').match(/^(\d{1,2}):(\d{2})/);
    return m ? +m[1] + +m[2] / 60 : null;
  };
  const hm = (h) => {
    let hh = Math.floor(h + 1e-6); let mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh += 1; mm = 0; }
    return `${String(hh % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  const hrs = (h) => `${parseFloat(h.toFixed(2))} h`;
  const q15 = (h, up) => (up ? Math.ceil(h * 4 - 1e-6) : Math.floor(h * 4 + 1e-6)) / 4;
  const hourOf = (d) => d.getHours() + d.getMinutes() / 60;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const y = (h) => (Math.min(Math.max(h, TOP), BOTTOM) - TOP) * PX;

  // ── View state: template week or a dated week (offset from this week) ──
  let mode = ls('hd.week.mode') === 'template' ? 'template' : 'dated';
  let offset = 0;
  function weekStart(off = offset) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7 * off);
    return d;
  }

  // ── Work hours ──
  function work() {
    const w = C().work || {};
    const win = w.window || ['07:00', '19:00'];
    return {
      hours: w.hours || {}, start: w.start || '08:00', breakH: (+w.breakMins || 0) / 60,
      from: toH(win[0]) ?? 7, to: toH(win[1]) ?? 19,
      startHelper: w.startHelper === undefined ? 'input_datetime.work_start_{day}' : w.startHelper,
      hoursHelper: w.hoursHelper === undefined ? 'input_number.work_hours_{day}' : w.hoursHelper,
    };
  }
  const helper = (pattern, day) => (pattern ? pattern.replace('{day}', day) : null);
  function hoursFor(day) {
    const id = helper(work().hoursHelper, day);
    const v = id && S().available(id) ? S().num(id) : null;
    return v != null ? v : (+work().hours[day] || 0);
  }
  const pending = {};   // start times sent to Home Assistant but not back yet
  function startFor(day) {
    const p = pending[day];
    if (p && Date.now() - p.at < 15e3) return toH(p.v);
    const id = helper(work().startHelper, day);
    if (id && S().available(id)) { const h = toH(S().state(id)); if (h != null) return h; }
    return toH(ls(`hd.week.start.${day}`)) ?? toH(work().start) ?? 8;
  }
  const syncsInHA = () => KEYS.filter((k) => hoursFor(k) > 0).every((k) => { const id = helper(work().startHelper, k); return id && S().get(id); });

  async function setStart(day, v) {
    const id = helper(work().startHelper, day);
    if (id && S().get(id)) {
      pending[day] = { v, at: Date.now() };
      try { await HD.ha.callService('input_datetime', 'set_datetime', { entity_id: id, time: `${v}:00` }); }
      catch (e) { delete pending[day]; HD.app.toast(`Couldn't save the start time: ${e.message}`); }
    } else lsSet(`hd.week.start.${day}`, v);
  }

  // ── Calendars and to-dos from Home Assistant ──
  function calendars() {
    const hide = new Set([].concat(C().hide || []));
    const cfg = C().calendars;
    const list = cfg && cfg.length ? cfg.map((c) => (typeof c === 'string' ? { id: c } : c))
      : Object.keys(S().states).filter((id) => id.startsWith('calendar.')).sort().map((id) => ({ id }));
    return list.filter((c) => c.id && !c.hide && !hide.has(c.id))
      .map((c) => ({ ...c, name: c.name || S().attr(c.id, 'friendly_name') || c.id }));
  }
  function todoLists() {
    const cfg = C().todo;
    if (cfg === false) return [];
    const ids = cfg ? [].concat(cfg) : Object.keys(S().states).filter((id) => id.startsWith('todo.')).sort();
    return ids.map((id) => ({ id, name: S().attr(id, 'friendly_name') || id }));
  }

  let ev = { key: null, at: 0, list: [], error: '', cals: 0, loading: false };
  async function loadEvents(force) {
    if (mode !== 'dated' || S().mode === 'connecting') return;
    const ws = weekStart(); const key = ws.getTime();
    if (ev.loading || (!force && ev.key === key && Date.now() - ev.at < RELOAD)) return;
    const cals = calendars();
    if (!cals.length) { ev = { key, at: Date.now(), list: [], error: '', cals: 0, loading: false }; return; }
    ev.loading = true;
    try {
      const res = await HD.ha.callWS({
        type: 'call_service', domain: 'calendar', service: 'get_events', return_response: true,
        // One day past Sunday, so "the evening before" rules see next Monday
        service_data: { entity_id: cals.map((c) => c.id), start_date_time: ws.toISOString(), end_date_time: addDays(ws, 8).toISOString() },
      });
      const resp = (res && res.response) || {};
      const seen = new Set(); const list = [];
      cals.forEach((c) => ((resp[c.id] && resp[c.id].events) || []).forEach((e) => {
        const allDay = /^\d{4}-\d{2}-\d{2}$/.test(e.start);
        const s = allDay ? parseDay(e.start) : new Date(e.start);
        const en = allDay ? parseDay(e.end || e.start) : new Date(e.end || e.start);
        if (!Number.isFinite(s.getTime())) return;
        const title = String(e.summary || 'Busy').trim();
        const k = `${title.toLowerCase()}|${s.getTime()}`;       // same event on two calendars
        if (seen.has(k)) return; seen.add(k);
        list.push({ s, e: en > s ? en : (allDay ? addDays(s, 1) : new Date(s.getTime() + 30 * 60e3)), allDay, title, where: e.location || '', cal: c.name });
      }));
      if (weekStart().getTime() === key) ev = { key, at: Date.now(), list, error: '', cals: cals.length, loading: false };
      else { ev.loading = false; setTimeout(loadEvents); }   // the week changed while loading
    } catch (e) {
      ev = { key, at: Date.now(), list: [], error: e.message, cals: cals.length, loading: false };
    }
    HD.views.week.update();
  }

  let todo = { at: 0, lists: [], error: '', loading: false };
  async function loadTodos(force) {
    if (S().mode === 'connecting') return;
    if (todo.loading || (!force && Date.now() - todo.at < RELOAD)) return;
    const lists = todoLists();
    if (!lists.length) { todo = { at: Date.now(), lists: [], error: '', loading: false }; return; }
    todo.loading = true;
    try {
      const res = await HD.ha.callWS({
        type: 'call_service', domain: 'todo', service: 'get_items', return_response: true,
        service_data: { entity_id: lists.map((l) => l.id), status: 'needs_action' },
      });
      const resp = (res && res.response) || {};
      todo = { at: Date.now(), error: '', loading: false, lists: lists.map((l) => ({ ...l, items: (resp[l.id] && resp[l.id].items) || [] })) };
    } catch (e) { todo = { at: Date.now(), lists: [], error: e.message, loading: false }; }
    HD.views.week.update();
  }

  // ── Building each day ──
  const routine = () => (C().routine || []).map((r) => ({ ...r, days: [].concat(r.days || r.day || []) }));
  // Fortnightly items: every: 2, from: 'YYYY-MM-DD' (a date in a week it happens)
  function happens(r) {
    if (!(r.every > 1) || !r.from || mode === 'template') return true;
    const f = parseDay(r.from); f.setDate(f.getDate() - ((f.getDay() + 6) % 7));
    const weeks = Math.round((weekStart().getTime() - f.getTime()) / 6048e5);
    return ((weeks % r.every) + r.every) % r.every === 0;
  }
  const isDone = (r) => mode === 'dated' && offset === 0 && r.doneWhen && S().state(r.doneWhen) === 'on';

  function dayModel(i) {
    const key = KEYS[i]; const dated = mode === 'dated';
    const date = addDays(weekStart(), i); const next = addDays(date, 1);
    const w = work(); const hours = hoursFor(key);
    const ws = hours > 0 ? startFor(key) : null; const we = ws != null ? ws + hours + w.breakH : null;
    const d = { i, key, name: NAMES[i], date, hours, ws, we, blocks: [], events: [], chips: [], clashes: [], today: dated && ymd(date) === ymd(new Date()) };
    d.warn = ws == null ? '' : we > w.to + 1e-6 ? `Finishes ${hm(we)}, past ${hm(w.to)}` : ws < w.from - 1e-6 ? `Starts before ${hm(w.from)}` : '';

    routine().filter((r) => r.days.includes(key) && happens(r)).forEach((r) => {
      const note = mode === 'template' && r.every > 1 ? [r.note, 'Alternate weeks'].filter(Boolean).join(' · ') : r.note;
      if (r.allDay) { d.chips.push({ title: r.label, type: r.type || 'family' }); return; }
      const s = toH(r.start); const e = toH(r.end) ?? s + 0.5;
      if (s == null) return;
      d.blocks.push({ s, e, title: r.label, note: note || '', type: r.type || 'family', done: isDone(r) });
    });

    const evList = ev.key === weekStart().getTime() ? ev.list : [];   // never last week's events on this week's days
    if (dated) {
      evList.forEach((x) => {
        if (x.allDay) { if (x.s < next && x.e > date) d.chips.push({ title: x.title, type: 'event', cal: x.cal }); return; }
        if (!(x.s < next && x.e > date)) return;
        const s = x.s < date ? 0 : hourOf(x.s); const e = x.e >= next ? 24 : hourOf(x.e);
        const clash = ws != null && s < we && e > ws;
        const evt = { s, e, title: x.title, note: x.where || `${hm(s)} – ${hm(e)}`, type: 'event', clash, cal: x.cal };
        d.events.push(evt);
        if (clash) d.clashes.push(evt);
      });
      // Rules like "bins out the evening before refuse collection"
      (C().dayBefore || []).forEach((r) => {
        let re; try { re = new RegExp(r.match, 'i'); } catch { return; }
        if (evList.some((x) => re.test(x.title) && ymd(x.s) === ymd(next))) {
          const s = toH(r.start) ?? 19.5;
          d.blocks.push({ s, e: toH(r.end) ?? s + 0.5, title: r.label, note: r.note || '', type: r.type || 'home' });
        }
      });
      // To-dos due this day
      todo.lists.forEach((l) => l.items.forEach((t) => { if (t.due && String(t.due).slice(0, 10) === ymd(date)) d.chips.push({ title: t.summary, type: 'todo', cal: l.name }); }));
    } else {
      (C().dayBefore || []).filter((r) => r.templateDay === key).forEach((r) => {
        const s = toH(r.start) ?? 19.5;
        d.blocks.push({ s, e: toH(r.end) ?? s + 0.5, title: r.label, note: r.note || '', type: r.type || 'home' });
      });
    }
    d.events.sort((a, b) => a.s - b.s || b.e - a.e);
    // Side-by-side lanes for events that overlap each other
    let cluster = []; let clusterEnd = -1;
    const close = () => { const n = Math.max(...cluster.map((x) => x.lane)) + 1; cluster.forEach((x) => { x.lanes = n; }); cluster = []; };
    d.events.forEach((x) => {
      if (cluster.length && x.s >= clusterEnd) close();
      const lanes = []; cluster.forEach((c) => { if (c.e > x.s) lanes[c.lane] = true; });
      x.lane = lanes.findIndex((v) => !v); if (x.lane < 0) x.lane = lanes.length;
      cluster.push(x); clusterEnd = Math.max(clusterEnd, x.e);
    });
    if (cluster.length) close();
    return d;
  }

  // What to do about an event inside work hours
  function advice(d, x) {
    const w = work(); const len = d.hours + w.breakH;
    const before = q15(x.s - len, false);
    if (x.s - len >= w.from - 1e-6) return `Start by ${hm(before)} to finish before it.`;
    const after = q15(x.e, true);
    if (after + len <= w.to + 1e-6) return `Start at ${hm(after)} or later to be clear of it.`;
    return 'No start time inside your window avoids it.';
  }

  // ── HTML ──
  function block(b, extra = '') {
    const h = Math.max((Math.min(b.e, BOTTOM) - Math.max(b.s, TOP)) * PX, MIN_H);
    const tip = [b.title, b.note, b.cal, b.clash ? 'overlaps work' : '', b.done ? 'done' : ''].filter(Boolean).join(' · ');
    const cls = `wk-blk wk-${b.type}${b.clash ? ' clash' : ''}${b.done ? ' done' : ''}${h < 52 ? ' short' : ''}`;
    const lane = b.lanes > 1 ? `left:calc(4px + (100% - 8px) * ${b.lane / b.lanes});width:calc((100% - 8px) / ${b.lanes} - 2px);right:auto;` : '';
    const t = `${b.done ? '✓ ' : ''}${esc(b.title)}`;
    return h < 52
      ? `<div class="${cls}" title="${esc(tip)}" style="top:${y(b.s)}px;height:${h}px;${lane}${extra}"><div class="one"><span class="t">${t}</span>${b.note ? `<span class="m"> · ${esc(b.note)}</span>` : ''}</div></div>`
      : `<div class="${cls}" title="${esc(tip)}" style="top:${y(b.s)}px;height:${h}px;${lane}${extra}"><div class="t">${t}</div>${b.note ? `<div class="m">${esc(b.note)}</div>` : ''}</div>`;
  }
  const dayLine = (d) => (d.ws != null ? `${hm(d.ws)} – ${hm(d.we)} · ${hrs(d.hours)}` : d.i >= 5 ? 'Weekend' : 'Day off');
  const dateLabel = (d) => HD.u.fmt(d, { day: 'numeric', month: 'short' });

  function gridHtml(days) {
    const H = (BOTTOM - TOP) * PX; const w = work();
    const marks = (C().markers || []).map((m) => ({ h: toH(m.at), label: m.label || '' })).filter((m) => m.h != null);
    const now = new Date(); const nowH = hourOf(now);
    let html = '<div class="wk-head wk-corner"></div>';
    days.forEach((d) => {
      html += `<div class="wk-head${d.ws == null ? ' off' : ''}${d.today ? ' today' : ''}"><div class="wk-d">${d.name}${mode === 'dated' ? ` <span>${dateLabel(d.date)}</span>` : ''}</div>
        <div class="wk-h">${dayLine(d)}</div>${d.warn ? `<div class="wk-warn">${icon('alert')}${esc(d.warn)}</div>` : ''}</div>`;
    });
    html += '<div class="wk-allday wk-corner"></div>';
    days.forEach((d) => { html += `<div class="wk-allday">${d.chips.map((c) => `<div class="wk-chip wk-${c.type}" title="${esc([c.title, c.cal].filter(Boolean).join(' · '))}">${c.type === 'todo' ? icon('check') : ''}${esc(c.title)}</div>`).join('')}</div>`; });
    html += `<div class="wk-gutter" style="height:${H}px">${Array.from({ length: BOTTOM - TOP - 1 }, (_, k) => `<div style="top:${y(TOP + k + 1)}px">${hm(TOP + k + 1)}</div>`).join('')}</div>`;
    days.forEach((d) => {
      let c = '';
      for (let h = TOP + 1; h < BOTTOM; h++) c += `<div class="wk-hr" style="top:${y(h)}px"></div>`;
      if (d.ws != null) {
        c += `<div class="wk-window" style="top:${y(w.from)}px;height:${y(w.to) - y(w.from)}px"></div>`;
        c += block({ s: d.ws, e: d.we, title: 'Work', note: `${hm(d.ws)} – ${hm(d.we)}`, type: 'work' });
      }
      d.blocks.forEach((b) => { c += block(b); });
      d.events.forEach((b) => { c += block(b); });
      marks.forEach((m) => { c += `<div class="wk-mark" style="top:${y(m.h)}px"><span>${esc(m.label)}</span></div>`; });
      if (d.today && nowH >= TOP && nowH <= BOTTOM) c += `<div class="wk-now" style="top:${y(nowH)}px" title="Now ${hm(nowH)}"></div>`;
      html += `<div class="wk-col${d.i >= 5 ? ' weekend' : ''}${d.today ? ' today' : ''}" style="height:${H}px">${c}</div>`;
    });
    return `<div class="wk-scroll"><div class="wk-grid">${html}</div></div>`;
  }

  function agendaHtml(days) {
    return days.map((d) => {
      const items = [];
      if (d.ws != null) items.push({ s: d.ws, e: d.we, title: 'Work', note: hrs(d.hours), type: 'work' });
      d.blocks.forEach((b) => items.push(b)); d.events.forEach((b) => items.push(b));
      items.sort((a, b) => a.s - b.s);
      const rows = d.chips.map((c) => `<div class="wk-row"><div class="tm">All day</div><i class="bar wk-${c.type}"></i><div><div class="t">${esc(c.title)}</div>${c.cal ? `<div class="m">${esc(c.cal)}</div>` : ''}</div></div>`)
        .concat(items.map((b) => `<div class="wk-row${b.clash ? ' clash' : ''}${b.done ? ' done' : ''}"><div class="tm">${b.type === 'flex' ? 'Flexible' : hm(b.s) + (b.e - b.s >= 0.75 ? ` – ${hm(b.e)}` : '')}</div>
          <i class="bar wk-${b.type}"></i><div><div class="t">${b.done ? '✓ ' : ''}${esc(b.title)}${b.clash ? ' · <em>during work</em>' : ''}</div>${b.note ? `<div class="m">${esc(b.note)}</div>` : ''}</div></div>`));
      return `<div class="wk-day${d.today ? ' today' : ''}"><h3><span>${d.name}${mode === 'dated' ? ` <small>${dateLabel(d.date)}</small>` : ''}</span><small>${dayLine(d)}</small></h3>
        ${d.warn ? `<p class="wk-warn">${icon('alert')}${esc(d.warn)}</p>` : ''}
        ${rows.length ? rows.join('') : '<div class="wk-row"><div class="m">Nothing planned</div></div>'}</div>`;
    }).join('');
  }

  function controlsHtml(days) {
    const can = HD.access.canControl();
    const ctl = days.filter((d) => d.ws != null).map((d) => `<label class="wk-ctl"><b>${d.name.slice(0, 3)} start</b>
      <input type="time" step="900" value="${hm(d.ws)}" data-week-start="${d.key}" ${can ? '' : 'disabled'}></label>`).join('');
    if (!ctl) return '<p class="note">No workdays set. Add <code>week.work.hours</code> to config.js.</p>';
    return `${ctl}<label class="wk-ctl"><b>Same start every day</b><input type="time" step="900" value="" data-week-start="all" ${can ? '' : 'disabled'}></label>
      <p class="wk-sync">${syncsInHA() ? 'Start times are saved in Home Assistant, so every screen shows the same.' : 'Start times are saved on this screen only. Create the <code>input_datetime.work_start_…</code> helpers to share them.'}</p>`;
  }

  function headerHtml() {
    const ws = weekStart(); const we = addDays(ws, 6);
    const range = `${HD.u.fmt(ws, { day: 'numeric', month: 'short' })} – ${HD.u.fmt(we, { day: 'numeric', month: 'short', year: 'numeric' })}`;
    return `<h2>${mode === 'template' ? 'Every week' : offset === 0 ? 'This week' : offset === 1 ? 'Next week' : offset === -1 ? 'Last week' : 'Week'}${mode === 'dated' ? ` <small class="wk-range">${range}</small>` : ''}</h2>
      <div class="wk-tools">
        ${mode === 'dated' ? `<div class="seg wk-nav" role="group" aria-label="Change week">
          <button data-week-nav="-1" aria-label="Previous week">‹</button><button data-week-nav="0" class="${offset === 0 ? 'on' : ''}">This week</button><button data-week-nav="1" aria-label="Next week">›</button></div>` : ''}
        <div class="seg" role="group" aria-label="Show">
          <button data-week-mode="template" class="${mode === 'template' ? 'on' : ''}">Template</button>
          <button data-week-mode="dated" class="${mode === 'dated' ? 'on' : ''}">Dated week</button></div>
      </div>`;
  }

  function sourceHtml() {
    if (mode !== 'dated') return 'Your routine and work hours only. Switch to Dated week to add your calendars.';
    if (ev.error) return `Couldn't read the calendars: ${esc(ev.error)}`;
    if (ev.key !== weekStart().getTime()) return 'Loading calendars…';
    if (!ev.cals) return 'No calendars in Home Assistant yet. Add the CalDAV (iCloud) or Google Calendar integration and they appear here.';
    return `From ${ev.cals} calendar${ev.cals === 1 ? '' : 's'} · read ${HD.u.time(new Date(ev.at))}`;
  }

  function legendHtml() {
    return `<div class="wk-legend">
      <span><i class="sw wk-work"></i>Work</span><span><i class="sw wk-hatch"></i>Flexible window (${hm(work().from)}–${hm(work().to)})</span>
      <span><i class="sw wk-family"></i>Family routine</span><span><i class="sw wk-flex"></i>Flexible</span><span><i class="sw wk-home"></i>Home</span>
      ${mode === 'dated' ? '<span><i class="sw wk-event"></i>Calendar</span><span><i class="sw wk-event clash"></i>Overlaps work</span>' : ''}</div>`;
  }

  function clashHtml(days) {
    if (mode !== 'dated') return '<p class="empty">Switch to Dated week to check your calendars against your hours.</p>';
    if (ev.error || !ev.cals) return `<p class="empty">${sourceHtml()}</p>`;
    const list = days.flatMap((d) => d.clashes.map((x) => ({ d, x })));
    if (!list.length) return '<p class="empty">Nothing this week overlaps your work hours.</p>';
    return `<ul class="wk-clashes">${list.map(({ d, x }) => `<li><b>${d.name}:</b> ${esc(x.title)} (${hm(x.s)} – ${hm(x.e)}) falls inside your ${hm(d.ws)} – ${hm(d.we)} work day.
      <span>${advice(d, x)}</span></li>`).join('')}</ul>`;
  }

  function rulesHtml() {
    const w = work(); const lines = [];
    KEYS.forEach((k, i) => {
      const h = hoursFor(k);
      if (h > 0) lines.push(`<li><b>${NAMES[i].slice(0, 3)}:</b> ${hrs(h)}${w.breakH ? ` + ${Math.round(w.breakH * 60)} min break` : ''}. Latest start that finishes by ${hm(w.to)} is ${hm(q15(w.to - h - w.breakH, false))}.</li>`);
    });
    const off = KEYS.filter((k, i) => i < 5 && !(hoursFor(k) > 0)).map((k) => NAMES[KEYS.indexOf(k)].slice(0, 3));
    if (off.length) lines.push(`<li><b>${off.join(', ')}:</b> off.</li>`);
    const seen = new Set();
    routine().forEach((r) => {
      const k = `${r.label}|${r.type}`;
      const days = routine().filter((x) => `${x.label}|${x.type}` === k).flatMap((x) => x.days).map((d) => NAMES[KEYS.indexOf(d)]?.slice(0, 3)).filter(Boolean);
      if (seen.has(k)) return; seen.add(k);
      const when = r.allDay ? 'all day' : r.type === 'flex' ? 'flexible' : `${r.start}${r.end ? `–${r.end}` : ''}`;
      lines.push(`<li><b>${[...new Set(days)].join(' or ')}:</b> ${esc(r.label)} (${when}${r.every > 1 ? ', alternate weeks' : ''}).</li>`);
    });
    (C().dayBefore || []).forEach((r) => lines.push(`<li><b>Evening before ${esc(r.what || `“${r.match}”`)}:</b> ${esc(r.label)} at ${esc(r.start || '19:30')}.</li>`));
    (C().markers || []).forEach((m) => lines.push(`<li><b>Daily, ${esc(m.at)}:</b> ${esc(m.label)}.</li>`));
    return lines.length ? `<ul class="wk-rules">${lines.join('')}</ul>` : '<p class="empty">Add <code>week.routine</code> to config.js.</p>';
  }

  function todoHtml() {
    if (todo.error) return `<p class="empty">Couldn't read the to-do lists: ${esc(todo.error)}</p>`;
    if (!todo.at) return '<p class="empty">Loading…</p>';
    if (!todo.lists.length) return '<p class="empty">No to-do lists in Home Assistant yet. Add the Local To-do integration.</p>';
    const can = HD.access.canControl();
    return todo.lists.map((l) => `<div class="wk-list"><h3>${esc(l.name)} <small>${l.items.length}</small></h3>
      ${l.items.length ? `<ul>${l.items.map((t) => `<li><button class="wk-tick" data-todo-done="${esc(l.id)}" data-uid="${esc(t.uid)}" title="Mark done" aria-label="Mark ${esc(t.summary)} done" ${can ? '' : 'disabled'}>${icon('check')}</button>
        <span>${esc(t.summary)}${t.due ? ` <small>due ${esc(HD.u.fmt(String(t.due).length === 10 ? parseDay(t.due) : new Date(t.due), { weekday: 'short', day: 'numeric', month: 'short' }))}</small>` : ''}</span></li>`).join('')}</ul>` : '<p class="empty">All done.</p>'}</div>`).join('');
  }

  // ── Events ──
  document.addEventListener('change', (e) => {
    const t = e.target.closest && e.target.closest('[data-week-start]');
    if (!t || !t.value) return;
    const day = t.dataset.weekStart;
    const days = day === 'all' ? KEYS.filter((k) => hoursFor(k) > 0) : [day];
    days.forEach((k) => setStart(k, t.value));
    if (day === 'all') t.value = '';
    HD.views.week.update(true);
  });
  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-week-mode],[data-week-nav],[data-todo-done]');
    if (!m || !document.getElementById('wk-grid')) return;
    if (m.dataset.weekMode) { mode = m.dataset.weekMode; lsSet('hd.week.mode', mode); }
    if (m.dataset.weekNav) { offset = m.dataset.weekNav === '0' ? 0 : offset + +m.dataset.weekNav; }
    if (m.dataset.todoDone) {
      m.disabled = true;
      HD.ha.callService('todo', 'update_item', { entity_id: m.dataset.todoDone, item: m.dataset.uid, status: 'completed' })
        .then(() => loadTodos(true)).catch((err) => { m.disabled = false; HD.app.toast(`Couldn't tick that off: ${err.message}`); });
      return;
    }
    HD.views.week.update(true);
    loadEvents(true);
  });

  HD.week = {
    // Helper ids the page reads, so Home Assistant sends their changes
    extraIds() {
      if (!HD.config.week) return [];
      const w = work();
      return KEYS.flatMap((k) => [helper(w.startHelper, k), helper(w.hoursHelper, k)]).filter(Boolean);
    },
    // Exposed for tests
    _dayModel: dayModel,
    _advice: advice,
  };

  HD.views.week = {
    title: 'Week',
    mount(root) {
      root.innerHTML = `
      <div class="panel-grid week">
        <section class="panel wide wk-panel">
          <header id="wk-head"></header>
          <div id="wk-controls" class="wk-controls"></div>
          <div id="wk-legend"></div>
          <div id="wk-grid"></div>
          <div id="wk-agenda" class="wk-agenda"></div>
          <p id="wk-source" class="note"></p>
        </section>
        <section class="panel"><header><h2>Things that touch work</h2></header><div id="wk-clash"></div></section>
        <section class="panel"><header><h2>Every week</h2></header><div id="wk-rules"></div></section>
        <section class="panel wide"><header><h2>To-do</h2></header><div id="wk-todo" class="wk-todos"></div></section>
      </div>`;
      this.update(true);
      loadEvents(); loadTodos();
    },
    update(force) {
      const g = document.getElementById('wk-grid'); if (!g) return;
      if (ev.key !== weekStart().getTime() || Date.now() - ev.at > RELOAD) loadEvents();
      if (Date.now() - todo.at > RELOAD) loadTodos();
      const days = KEYS.map((_, i) => dayModel(i));
      if (force) HD.u.invalidate();
      HD.u.setHTML(document.getElementById('wk-head'), headerHtml());
      const ctl = document.getElementById('wk-controls');
      if (!ctl.contains(document.activeElement)) HD.u.setHTML(ctl, controlsHtml(days));   // don't rewrite an input being edited
      HD.u.setHTML(document.getElementById('wk-legend'), legendHtml());
      HD.u.setHTML(g, gridHtml(days));
      HD.u.setHTML(document.getElementById('wk-agenda'), agendaHtml(days));
      HD.u.setHTML(document.getElementById('wk-source'), sourceHtml());
      HD.u.setHTML(document.getElementById('wk-clash'), clashHtml(days));
      HD.u.setHTML(document.getElementById('wk-rules'), rulesHtml());
      HD.u.setHTML(document.getElementById('wk-todo'), todoHtml());
    },
  };
})();
