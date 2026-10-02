// @ts-check
import * as cal from './calendar.js';
import * as ph from './phones.js';
import * as store from './store.js';
import * as native from './native.js';
import { CONFIG } from './config.js';
import { el, append, icon, clear, ext, toast, copyText } from './dom.js';
import { mountCommunity } from './community/view.js';
import { createSupabaseApi } from './community/supabase.js';
import { createDemoApi } from './community/demo.js';

/** @typedef {import('./calendar.js').OtiEvent} OtiEvent */
/** @typedef {import('./calendar.js').Occurrence} Occurrence */
/** @typedef {import('./phones.js').PhoneEntry} PhoneEntry */

const VIEWS = ['home', 'community', 'calendar', 'phones', 'tools', 'more'];
const TYPE_LABEL = { group: 'Support group', event: 'Event', training: 'Training', community: 'Community' };

/** Current time; tests and screenshots can pin it with window.__OTI_NOW__. */
function now() {
  const fixed = /** @type {any} */ (window).__OTI_NOW__;
  return fixed ? new Date(fixed) : new Date();
}

const state = {
  /** @type {any} */ content: null,
  view: 'home',
  cal: { year: now().getFullYear(), month: now().getMonth() + 1, selected: cal.localDateKey(now()), types: new Set(['group', 'event', 'training', 'community']) },
  /** @type {HTMLElement|null} */ sheetOpener: null,
  /** @type {null | (() => void)} */ stopActivity: null,
  /** Tool to open as soon as the Tools tab renders (set by a Home shortcut). */
  /** @type {null | 'breathe' | 'urge' | 'halt'} */ pendingTool: null,
  /** @type {null | ReturnType<typeof mountCommunity>} */ community: null,
};

/** Review builds (dist/review.html) run the Community tab on sample data with no sign-in. */
const IS_REVIEW = !!(/** @type {any} */ (window).__OTI_REVIEW__);

// ---------------------------------------------------------------- content

async function loadContent() {
  const inline = /** @type {any} */ (window).__OTI_CONTENT__;
  if (inline) return inline;
  const res = await fetch('data/content.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** @param {any} c */
function looksLikeContent(c) {
  return c && typeof c === 'object' && typeof c.version === 'string' && Array.isArray(c.events) && Array.isArray(c.phones) && c.org && typeof c.org.name === 'string';
}

async function refreshRemoteContent() {
  if (!CONFIG.remoteContentUrl) return;
  try {
    const res = await fetch(CONFIG.remoteContentUrl, { cache: 'no-cache' });
    if (!res.ok) return;
    const fresh = await res.json();
    if (looksLikeContent(fresh) && fresh.version > state.content.version) {
      state.content = fresh;
      renderAll();
      toast('Events and resources updated');
    }
  } catch { /* offline or blocked: keep bundled content */ }
}

// ---------------------------------------------------------------- routing

function currentHashView() {
  const h = (location.hash || '#home').replace('#', '').toLowerCase();
  return VIEWS.includes(h) ? h : 'home';
}

function navigate() {
  const view = currentHashView();
  state.view = view;
  stopActivity();
  closeSheet();
  for (const v of VIEWS) {
    const sec = document.getElementById(`view-${v}`);
    if (sec) sec.hidden = v !== view;
  }
  document.querySelectorAll('.tab').forEach((t) => {
    const tab = /** @type {HTMLElement} */ (t);
    if (tab.dataset.tab === view) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current');
  });
  store.set(store.KEYS.lastTab, view);
  renderView(view);
  window.scrollTo({ top: 0 });
}

/** @param {string} view */
function go(view) {
  if (currentHashView() === view) navigate(); else location.hash = view;
}

/** @param {string} view */
function renderView(view) {
  if (!state.content) return;
  const sec = document.getElementById(`view-${view}`);
  if (!sec) return;
  if (view === 'community') {
    // Mounted once and kept alive: it holds the sign-in flow and the open topic.
    if (!state.community) state.community = mountCommunity(sec, communityContext());
    else state.community.refresh();
    return;
  }
  clear(sec);
  /** @type {Record<string, (sec: HTMLElement) => void>} */
  const renderers = { home: renderHome, calendar: renderCalendar, phones: renderPhones, tools: renderTools, more: renderMore };
  renderers[view](sec);
}

function communityContext() {
  const cfg = CONFIG.community;
  let api = null;
  if (IS_REVIEW || cfg.demo) api = createDemoApi({ now });
  else if (cfg.supabaseUrl && cfg.supabaseAnonKey) api = createSupabaseApi({ url: cfg.supabaseUrl, anonKey: cfg.supabaseAnonKey, pollSeconds: cfg.pollSeconds });
  return {
    api, now, review: IS_REVIEW || cfg.demo, orgEmail: state.content.org.email,
    onUnread: (/** @type {number} */ total) => {
      const badge = document.getElementById('community-badge');
      if (!badge) return;
      badge.hidden = total <= 0;
      badge.textContent = total > 99 ? '99+' : String(total);
    },
  };
}

function renderAll() { renderView(state.view); }

function stopActivity() {
  if (state.stopActivity) { state.stopActivity(); state.stopActivity = null; }
}

// ---------------------------------------------------------------- shared pieces

/**
 * @param {Occurrence} occ
 * @param {Date} at
 */
function eventRow(occ, at) {
  const d = occ.start;
  const isToday = occ.dateKey === cal.localDateKey(at);
  const timeText = `${cal.fmtTime(occ.start)}–${cal.fmtTime(occ.end)}`;
  const row = el('button', {
    class: `event-row${isToday ? ' today' : ''}`, type: 'button',
    'aria-label': `${occ.event.title}, ${cal.fmtDateLong(d)}, ${timeText}`,
    onClick: (/** @type {MouseEvent} */ e) => openSheet(occ, /** @type {HTMLElement} */ (e.currentTarget)),
  },
    el('span', { class: 'when', 'aria-hidden': 'true' },
      el('span', { class: 'mon' }, d.toLocaleDateString(undefined, { month: 'short' })),
      el('span', { class: 'day num' }, String(d.getDate()))),
    el('span', {},
      el('span', { class: 'title' }, occ.event.title),
      el('span', { class: 'meta' },
        el('span', { class: `pill ${occ.event.type}` }, TYPE_LABEL[occ.event.type] || occ.event.type),
        el('span', { class: 'num' }, `${cal.relativeDay(occ, at)} · ${timeText}`))),
    el('span', { class: 'chev' }, icon('chev')));
  return row;
}

/**
 * "Day 1" on the first day, then "N days". One convention everywhere.
 * @param {number} days  whole days since the first day (0 on that day)
 */
function dayLabel(days) {
  if (days <= 0) return { big: 'Day 1', small: 'today', full: 'Day 1' };
  return { big: String(days), small: days === 1 ? 'day' : 'days', full: `${days} ${days === 1 ? 'day' : 'days'}` };
}

/** @param {{name:string,role?:string,quote:string}} t */
function quoteBlock(t) {
  return el('blockquote', { class: 'quote' },
    el('p', {}, `“${t.quote}”`),
    el('cite', {}, [t.name, t.role].filter(Boolean).join(' · ')));
}

/** @param {string} label @param {string} url @param {string} [blurb] */
function linkItem(label, url, blurb) {
  return ext(url, { class: 'link-item' },
    el('span', {}, el('strong', {}, label), blurb ? el('span', {}, blurb) : null),
    icon('ext'));
}

function heroArt() {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="hero-art" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden="true">
    <polygon class="p3" points="230,120 330,22 400,120"/>
    <polygon class="snow" points="330,22 316,42 344,42"/>
    <polygon class="p2" points="120,120 210,10 300,120"/>
    <polygon class="snow" points="210,10 194,34 226,34"/>
    <polygon class="p1" points="0,120 90,30 200,120"/>
    <polygon class="snow" points="90,30 76,50 104,50"/>
  </svg>`;
  return t.content.firstElementChild;
}

// ---------------------------------------------------------------- home

/** @param {HTMLElement} sec */
function renderHome(sec) {
  const c = state.content;
  const at = now();
  const up = cal.upcoming(c.events, at, { limit: 3 });
  const monday = c.events.find((/** @type {OtiEvent} */ e) => e.id === 'monday-group');
  const mondayNext = monday ? cal.upcoming([monday], at, { limit: 1 })[0] : null;
  const sobriety = store.get(store.KEYS.sobrietyDate, /** @type {string|null} */ (null));

  append(sec, [
    el('div', { class: 'hero' },
      el('h1', { id: 'home-title' }, c.org.tagline),
      el('p', {}, c.org.headline),
      el('div', { class: 'row' },
        mondayNext ? el('button', { class: 'btn primary', type: 'button', onClick: (/** @type {MouseEvent} */ e) => openSheet(mondayNext, /** @type {HTMLElement} */ (e.currentTarget)) }, icon('people'), `Monday group · ${cal.relativeDay(mondayNext, at)}`) : null,
        ext(c.org.contactUrl, { class: 'btn outline' }, 'Enroll in T.H.R.I.V.E.')),
      heroArt()),

    sobriety
      ? el('a', { class: 'day-chip', href: '#tools', 'aria-label': `${dayLabel(cal.daysSince(sobriety, at)).full} of recovery. Open tools.` },
          el('span', {}, el('strong', { class: 'num' }, dayLabel(cal.daysSince(sobriety, at)).full), el('span', { class: 'sub' }, `of recovery · since ${cal.fmtDateShort(cal.localMidnight(sobriety))}`)),
          el('span', { class: 'arrow' }, icon('chev')))
      : el('a', { class: 'day-chip', href: '#tools' },
          el('span', {}, el('strong', {}, 'Count your days'), el('span', { class: 'sub' }, 'Private. Stays on this phone.')),
          el('span', { class: 'arrow' }, icon('chev'))),

    el('div', { class: 'quick' },
      el('a', { href: '#phones' }, icon('phone'), 'Help lines', el('span', { class: 'sub' }, '24/7 crisis & support')),
      el('a', { href: '#tools', onClick: () => { state.pendingTool = 'urge'; } }, icon('wave'), 'Ride the urge', el('span', { class: 'sub' }, '15-minute timer')),
      el('a', { href: '#community' }, icon('msg'), 'Community', el('span', { class: 'sub' }, 'members only'))),

    el('section', { class: 'section', 'aria-labelledby': 'h-up' },
      el('div', { class: 'section-head' }, el('h2', { id: 'h-up' }, 'Coming up'), el('a', { href: '#calendar' }, 'Full calendar')),
      up.length ? el('div', { class: 'event-list' }, up.map((o) => eventRow(o, at))) : el('div', { class: 'empty' }, 'No upcoming events yet. Check back soon.')),

    el('section', { class: 'section', 'aria-labelledby': 'h-mission' },
      el('h2', { id: 'h-mission' }, 'Our mission'),
      el('div', { class: 'card soft' }, el('p', {}, c.org.mission)),
      el('img', { src: 'assets/community.jpg', alt: 'OTI community members together', loading: 'lazy', style: { borderRadius: '14px' } })),

    c.testimonials?.length ? el('section', { class: 'section', 'aria-labelledby': 'h-stories' },
      el('div', { class: 'section-head' }, el('h2', { id: 'h-stories' }, 'Stories of impact'), el('a', { href: '#more' }, 'More')),
      el('div', { class: 'card' }, quoteBlock(c.testimonials[0]))) : null,

    el('section', { class: 'section', 'aria-labelledby': 'h-support' },
      el('h2', { id: 'h-support' }, 'Support the mission'),
      el('div', { class: 'row' },
        ext(c.org.donateUrl, { class: 'btn primary' }, icon('heart'), 'Donate'),
        ext(c.org.sponsorsUrl, { class: 'btn outline' }, 'Business sponsors'))),
  ]);
}

// ---------------------------------------------------------------- calendar

/** @param {HTMLElement} sec */
function renderCalendar(sec) {
  const c = state.content;
  const at = now();
  const { year, month } = state.cal;
  const events = c.events.filter((/** @type {OtiEvent} */ e) => state.cal.types.has(e.type));
  const grid = cal.monthGrid(year, month);
  const rangeStart = grid[0].date;
  const rangeEnd = new Date(grid[41].date.getTime() + 86400000);
  const occs = cal.expandEvents(events, rangeStart, rangeEnd);
  /** @type {Map<string, Occurrence[]>} */
  const byDay = new Map();
  for (const o of occs) { const list = byDay.get(o.dateKey) || []; list.push(o); byDay.set(o.dateKey, list); }
  const todayKey = cal.localDateKey(at);
  const selected = state.cal.selected;

  const head = el('div', { class: 'cal-head' },
    el('h2', { 'aria-live': 'polite' }, cal.fmtMonthYear(new Date(year, month - 1, 1))),
    el('div', { class: 'cal-nav' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous month', onClick: () => shiftMonth(-1) }, icon('left')),
      el('button', { class: 'btn small outline', type: 'button', onClick: () => { state.cal.year = at.getFullYear(); state.cal.month = at.getMonth() + 1; state.cal.selected = todayKey; renderAll(); } }, 'Today'),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next month', onClick: () => shiftMonth(1) }, icon('chev'))));

  const chips = el('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by type' },
    Object.entries(TYPE_LABEL).map(([type, label]) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(state.cal.types.has(type)),
      onClick: () => { if (state.cal.types.has(type)) { if (state.cal.types.size > 1) state.cal.types.delete(type); } else state.cal.types.add(type); renderAll(); },
    }, el('span', { class: `dot ${type}` }), label)));

  const gridEl = el('div', { class: 'cal-grid', role: 'grid', 'aria-label': 'Month' },
    ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => el('div', { class: 'cal-dow', role: 'columnheader', 'aria-label': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i] }, d)),
    grid.map((cell) => {
      const list = byDay.get(cell.dateKey) || [];
      const types = [...new Set(list.map((o) => o.event.type))].slice(0, 3);
      return el('button', {
        class: `cal-cell${cell.inMonth ? '' : ' out'}${cell.dateKey === todayKey ? ' today' : ''}`,
        type: 'button', role: 'gridcell', 'aria-selected': String(cell.dateKey === selected),
        'aria-label': `${cal.fmtDateLong(cell.date)}${list.length ? `, ${list.length} item${list.length > 1 ? 's' : ''}` : ''}`,
        onClick: () => { state.cal.selected = cell.dateKey; if (!cell.inMonth) { state.cal.year = cell.date.getFullYear(); state.cal.month = cell.date.getMonth() + 1; } renderAll(); },
      }, el('span', { class: 'num' }, String(cell.day)), el('span', { class: 'dots' }, types.map((t) => el('span', { class: `dot ${t}` }))));
    }));

  const dayList = byDay.get(selected) || [];
  const agenda = el('section', { class: 'section', 'aria-labelledby': 'h-agenda' },
    el('div', { class: 'agenda-title' }, el('h3', { id: 'h-agenda' }, selected === todayKey ? 'Today' : cal.fmtDateLong(cal.localMidnight(selected))), selected !== todayKey ? el('span', { class: 'muted small' }, cal.fmtDateShort(cal.localMidnight(selected))) : null),
    dayList.length ? el('div', { class: 'event-list' }, dayList.map((o) => eventRow(o, at))) : el('div', { class: 'empty' }, 'Nothing scheduled this day.'));

  const upcomingList = cal.upcoming(events, at, { limit: 6 });
  const upcomingSec = el('section', { class: 'section', 'aria-labelledby': 'h-upcoming' },
    el('h3', { id: 'h-upcoming' }, 'Upcoming'),
    upcomingList.length ? el('div', { class: 'event-list' }, upcomingList.map((o) => eventRow(o, at))) : el('div', { class: 'empty' }, 'No upcoming events for these filters.'));

  const unscheduled = (c.unscheduled || []).length ? el('section', { class: 'section', 'aria-labelledby': 'h-unsched' },
    el('h3', { id: 'h-unsched' }, 'Also happening'),
    el('div', { class: 'unscheduled' }, c.unscheduled.map((/** @type {any} */ u) => el('div', { class: 'card' },
      el('span', { class: `dot ${u.type}`, style: { marginTop: '8px', flex: 'none' } }),
      el('div', { class: 'stack', style: { gap: '4px' } },
        el('strong', {}, u.title), el('span', { class: 'muted small' }, u.note),
        u.url ? ext(u.url, { class: 'small' }, 'More info') : null))))) : null;

  append(sec, [head, chips, gridEl,
    el('div', { class: 'legend' }, Object.entries(TYPE_LABEL).map(([t, l]) => el('span', {}, el('span', { class: `dot ${t}` }), l))),
    agenda, upcomingSec, unscheduled,
    el('p', { class: 'about' }, `Times are shown in your device's time zone (${cal.fmtTimeZone(at)}). OTI meets on Pacific Time.`)]);
}

/** @param {number} delta */
function shiftMonth(delta) {
  const d = new Date(state.cal.year, state.cal.month - 1 + delta, 1);
  state.cal.year = d.getFullYear(); state.cal.month = d.getMonth() + 1;
  renderAll();
}

// ---------------------------------------------------------------- event sheet

/**
 * @param {Occurrence} occ
 * @param {HTMLElement|null} opener
 */
function openSheet(occ, opener) {
  const ev = occ.event;
  const sheet = document.getElementById('sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  const body = document.getElementById('sheet-body');
  if (!sheet || !backdrop || !body) return;
  clear(body);
  state.sheetOpener = opener;

  const dateLine = occ.dayCount > 1
    ? `${cal.fmtDateLong(occ.start)} – ${cal.fmtDateLong(occ.end)}`
    : cal.fmtDateLong(occ.start);
  const timeLine = `${cal.fmtTime(occ.start)} – ${cal.fmtTime(occ.end)} ${cal.fmtTimeZone(occ.start)}`;
  const recurring = ev.recurrence ? `Every ${ev.recurrence.byDay.map((d) => ({ SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' })[d]).join(', ')}` : null;

  const links = (ev.links || []).map((l) => ext(l.url, { class: `btn ${l.kind === 'join' ? 'primary' : l.kind === 'register' ? 'violet' : 'outline'}` }, l.label));

  append(body, [
    el('div', { class: 'row', style: { justifyContent: 'space-between' } },
      el('span', { class: `pill ${ev.type}` }, TYPE_LABEL[ev.type] || ev.type),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onClick: closeSheet }, icon('x'))),
    el('h2', { id: 'sheet-title', tabindex: '-1' }, ev.title),
    ev.image ? el('img', { src: ev.image, alt: '', loading: 'lazy' }) : null,
    el('div', { class: 'kv' },
      icon('cal'), el('span', {}, el('strong', {}, dateLine), recurring ? el('span', { class: 'muted' }, ` · ${recurring}`) : null),
      icon('clock'), el('span', { class: 'num' }, timeLine),
      ev.location ? icon('pin') : null,
      ev.location ? el('span', {}, ev.location.url ? ext(ev.location.url, {}, ev.location.name) : ev.location.name, ev.location.address ? el('span', { class: 'muted' }, ` · ${ev.location.address}`) : null) : null),
    el('p', {}, ev.description),
    links.length ? el('div', { class: 'row' }, links) : null,
    el('div', { class: 'row' }, ext(cal.googleCalendarUrl(occ), { class: 'btn outline small' }, icon('plus'), 'Add to Google Calendar')),
    ev.reminder ? reminderRow(ev) : null,
  ]);

  sheet.hidden = false; backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  backdrop.onclick = closeSheet;
  const title = document.getElementById('sheet-title');
  if (title) title.focus();
}

function closeSheet() {
  const sheet = document.getElementById('sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true; if (backdrop) backdrop.hidden = true;
  document.body.style.overflow = '';
  if (state.sheetOpener && document.contains(state.sheetOpener)) state.sheetOpener.focus();
  state.sheetOpener = null;
}

/** @param {OtiEvent} ev */
function reminderRow(ev) {
  const r = /** @type {NonNullable<OtiEvent['reminder']>} */ (ev.reminder);
  const reminders = store.get(store.KEYS.reminders, /** @type {Record<string, boolean>} */ ({}));
  const on = !!reminders[ev.id];
  const hour12 = ((r.hour + 11) % 12) + 1, ampm = r.hour >= 12 ? 'PM' : 'AM';
  const when = `${{ SU: 'Sundays', MO: 'Mondays', TU: 'Tuesdays', WE: 'Wednesdays', TH: 'Thursdays', FR: 'Fridays', SA: 'Saturdays' }[r.weekday]} at ${hour12}:${String(r.minute).padStart(2, '0')} ${ampm}`;
  const status = el('span', { class: 'muted small' }, native.isNative() ? `Weekly reminder, ${when}` : 'Reminders work in the OTI phone app');
  const sw = el('button', {
    class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': 'Remind me weekly',
    disabled: !native.isNative(),
    onClick: async () => {
      const next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
      if (next) {
        const res = await native.scheduleWeeklyReminder({ id: ev.id, ...r });
        if (res === 'scheduled') { reminders[ev.id] = true; store.set(store.KEYS.reminders, reminders); toast('Reminder set'); }
        else { sw.setAttribute('aria-checked', 'false'); toast(res === 'denied' ? 'Allow notifications in Settings to get reminders' : 'Could not set the reminder'); }
      } else {
        await native.cancelReminder(ev.id);
        delete reminders[ev.id]; store.set(store.KEYS.reminders, reminders); toast('Reminder removed');
      }
    },
  });
  return el('div', { class: 'toggle-row' }, el('span', { class: 'stack', style: { gap: '2px' } }, el('strong', {}, icon('bell'), ' Remind me'), status), sw);
}

// ---------------------------------------------------------------- phones

/** @param {HTMLElement} sec */
function renderPhones(sec) {
  const c = state.content;
  let query = '';
  const listWrap = el('div', { class: 'stack', style: { gap: '18px' } });

  const search = el('div', { class: 'search' }, icon('search'),
    el('input', { type: 'search', id: 'phone-search', placeholder: 'Search lines, e.g. “moms”, “Spanish”, “988”', 'aria-label': 'Search phone list', autocomplete: 'off',
      onInput: (/** @type {Event} */ e) => { query = /** @type {HTMLInputElement} */ (e.target).value; drawList(); } }));

  function drawList() {
    clear(listWrap);
    const entries = ph.searchPhones(/** @type {PhoneEntry[]} */ (c.phones), query);
    const groups = ph.groupByCategory(entries, c.phoneCategories);
    if (!groups.length) { listWrap.appendChild(el('div', { class: 'empty' }, `No lines match “${query}”.`)); return; }
    for (const g of groups) {
      listWrap.appendChild(el('section', { class: 'section', 'aria-labelledby': `pc-${g.id}` },
        el('div', {}, el('h3', { id: `pc-${g.id}` }, g.label), g.blurb ? el('p', { class: 'muted small' }, g.blurb) : null),
        el('div', { class: 'phone-list' }, g.items.map((p) => phoneCard(p, p.id === '988')))));
    }
  }
  drawList();

  const otiCard = el('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    el('strong', {}, c.org.name),
    c.org.phone ? el('a', { class: 'phone number num', href: ph.telHref(c.org.phone) }, ph.formatDisplay(c.org.phone)) : null,
    el('span', { class: 'muted small' }, 'Questions about T.H.R.I.V.E., coaching, or events:'),
    el('div', { class: 'row' },
      el('span', { class: 'mono' }, c.org.email),
      el('button', { class: 'btn small outline', type: 'button', onClick: async () => toast((await copyText(c.org.email)) ? 'Email copied' : 'Could not copy') }, icon('copy'), 'Copy'),
      ext(c.org.contactUrl, { class: 'btn small primary' }, 'Contact form')));

  append(sec, [
    el('div', { class: 'notice danger' }, 'In immediate danger or someone is not breathing? Call 911.'),
    search,
    listWrap,
    el('section', { class: 'section', 'aria-labelledby': 'h-oti' }, el('h3', { id: 'h-oti' }, 'Reach OTI'), otiCard),
    peopleSection(),
    el('p', { class: 'about' }, 'Numbers verified September 2026. Tap a number to call; on a computer, use Copy. If a line has changed, email OTI so we can update the app.'),
  ]);
}

/**
 * @param {PhoneEntry} p
 * @param {boolean} featured
 */
function phoneCard(p, featured) {
  const open247 = /24\/7|24 hours/i.test(p.hours);
  const actions = [];
  if (p.number) actions.push(el('a', { class: 'btn primary small', href: ph.telHref(p.number) }, icon('phone'), 'Call'));
  if (p.sms) actions.push(el('a', { class: 'btn violet small', href: ph.smsHref(p.sms) }, icon('msg'), p.sms.body ? `Text ${p.sms.body}` : 'Text'));
  if (p.number) actions.push(el('button', { class: 'btn outline small', type: 'button', onClick: async () => toast((await copyText(p.display)) ? `Copied ${p.display}` : 'Could not copy') }, icon('copy'), 'Copy'));
  if (p.url) actions.push(ext(p.url, { class: 'btn outline small' }, icon('ext'), 'Website'));
  return el('article', { class: `phone${featured ? ' featured' : ''}`, 'aria-label': p.name },
    el('div', { class: 'top' },
      el('span', { class: 'name' }, p.name),
      el('span', { class: `pill ${open247 ? 'open' : 'hours'}` }, open247 ? '24/7' : p.hours)),
    p.number ? el('a', { class: 'number num', href: ph.telHref(p.number) }, p.display) : el('span', { class: 'number' }, p.display),
    el('p', { class: 'desc' }, p.description),
    el('div', { class: 'meta' }, !open247 ? el('span', { class: 'muted small' }, p.hours) : null, p.languages ? el('span', { class: 'muted small' }, `· ${p.languages}`) : null),
    el('div', { class: 'actions' }, actions));
}

/** Personal support contacts, stored only on this device. */
function peopleSection() {
  /** @type {{id:string,name:string,number:string,note?:string}[]} */
  const people = store.get(store.KEYS.people, []);
  const list = el('div', { class: 'stack' });

  function draw() {
    clear(list);
    if (!people.length) { list.appendChild(el('p', { class: 'people-empty' }, 'Add your coach, sponsor, or a friend who picks up. Saved only on this phone.')); return; }
    for (const person of people) {
      const card = el('div', { class: 'person' });
      const acts = el('div', { class: 'acts' },
        el('a', { class: 'btn primary small', href: ph.telHref(person.number), 'aria-label': `Call ${person.name}` }, icon('phone')),
        el('a', { class: 'btn violet small', href: ph.smsHref({ number: person.number }), 'aria-label': `Text ${person.name}` }, icon('msg')),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${person.name}`, onClick: () => {
          const confirm = el('div', { class: 'confirm' }, `Remove ${person.name}?`,
            el('button', { class: 'btn danger small', type: 'button', onClick: () => { people.splice(people.indexOf(person), 1); store.set(store.KEYS.people, people); draw(); toast('Removed'); } }, 'Remove'),
            el('button', { class: 'btn small', type: 'button', onClick: () => confirm.remove() }, 'Keep'));
          card.appendChild(confirm);
        } }, icon('x')));
      append(card, [el('div', { class: 'who' }, el('strong', {}, person.name), el('span', { class: 'num' }, ph.formatDisplay(person.number), person.note ? ` · ${person.note}` : '')), acts]);
      list.appendChild(card);
    }
  }
  draw();

  const err = el('p', { class: 'error', role: 'alert', hidden: true });
  const nameIn = el('input', { id: 'person-name', type: 'text', placeholder: 'Name', maxlength: '60', required: true, autocomplete: 'off' });
  const numIn = el('input', { id: 'person-number', type: 'tel', placeholder: 'Phone number', maxlength: '24', required: true, autocomplete: 'off', inputmode: 'tel' });
  const noteIn = el('input', { id: 'person-note', type: 'text', placeholder: 'Note (optional), e.g. “my coach”', maxlength: '40' });
  const details = el('details', { class: 'add' },
    el('summary', {}, icon('plus'), 'Add someone'),
    el('form', { onSubmit: (/** @type {Event} */ e) => {
      e.preventDefault();
      const name = /** @type {HTMLInputElement} */ (nameIn).value.trim();
      const number = /** @type {HTMLInputElement} */ (numIn).value.trim();
      const note = /** @type {HTMLInputElement} */ (noteIn).value.trim();
      if (!name) { err.textContent = 'Please add a name.'; err.hidden = false; nameIn.focus(); return; }
      if (!ph.isValidNumber(number)) { err.textContent = 'That phone number doesn’t look right. Use 10 digits, e.g. 619 555 0100.'; err.hidden = false; numIn.focus(); return; }
      err.hidden = true;
      people.push({ id: String(Date.now()), name, number: ph.normalizeNumber(number), note: note || undefined });
      if (!store.set(store.KEYS.people, people)) toast('Saved for this session only (storage unavailable)'); else toast(`${name} added`);
      /** @type {HTMLInputElement} */ (nameIn).value = ''; /** @type {HTMLInputElement} */ (numIn).value = ''; /** @type {HTMLInputElement} */ (noteIn).value = '';
      /** @type {HTMLDetailsElement} */ (details).open = false;
      draw();
    } },
      el('div', { class: 'field' }, el('label', { for: 'person-name' }, 'Name'), nameIn),
      el('div', { class: 'field' }, el('label', { for: 'person-number' }, 'Phone'), numIn),
      el('div', { class: 'field' }, el('label', { for: 'person-note' }, 'Note'), noteIn),
      err,
      el('button', { class: 'btn primary', type: 'submit' }, 'Save contact')));

  return el('section', { class: 'section', id: 'my-people', 'aria-labelledby': 'h-people' },
    el('div', {}, el('h3', { id: 'h-people' }, 'My people'), el('p', { class: 'muted small' }, 'Your own call list for hard moments.')),
    list, details);
}

// ---------------------------------------------------------------- tools

/** @param {HTMLElement} sec */
function renderTools(sec) {
  const c = state.content;
  const panel = el('div', { class: 'panel', id: 'tool-panel' });

  const tools = el('div', { class: 'tools-grid' },
    el('button', { class: 'tool', type: 'button', onClick: () => showTool(panel, breathingTool) }, icon('wind'), el('strong', {}, 'Breathe'), el('span', {}, 'Box breathing, 4 counts each. Slows the body down.')),
    el('button', { class: 'tool', type: 'button', onClick: () => showTool(panel, urgeTool) }, icon('wave'), el('strong', {}, 'Ride the urge'), el('span', {}, 'A 15-minute timer. Urges crest and pass.')),
    el('button', { class: 'tool', type: 'button', onClick: () => showTool(panel, haltTool) }, icon('sun'), el('strong', {}, 'HALT check'), el('span', {}, 'Hungry, angry, lonely, tired? Name it first.')),
    el('a', { class: 'tool', href: '#phones' }, icon('people'), el('strong', {}, 'Call someone'), el('span', {}, 'Your people and 24/7 lines, one tap away.')));

  const nowSection = el('section', { class: 'section', 'aria-labelledby': 'h-now' },
    el('h2', { id: 'h-now' }, 'Right now'),
    tools, panel);

  append(sec, [
    sobrietyCounter(),
    nowSection,
    el('section', { class: 'section', 'aria-labelledby': 'h-links' },
      el('div', {}, el('h2', { id: 'h-links' }, 'Recovery communities & help'), el('p', { class: 'muted small' }, 'Different pathways work for different women. These are free or low-cost.')),
      el('div', { class: 'link-list' }, c.recoveryLinks.map((/** @type {any} */ l) => linkItem(l.label, l.url, l.blurb)))),
  ]);

  // A Home shortcut asked for a specific tool: open it right away, with the tool grid in view.
  if (state.pendingTool) {
    const build = { breathe: breathingTool, urge: urgeTool, halt: haltTool }[state.pendingTool];
    state.pendingTool = null;
    showTool(panel, build);
    requestAnimationFrame(() => panel.scrollIntoView({ block: 'start' }));
  }
}

/**
 * @param {HTMLElement} panel
 * @param {(panel: HTMLElement) => (() => void) | void} build
 */
function showTool(panel, build) {
  stopActivity();
  clear(panel);
  const stop = build(panel);
  if (typeof stop === 'function') state.stopActivity = stop;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * @param {string|null} [editing]  when set, the form edits this existing date
 */
function sobrietyCounter(editing = null) {
  const at = now();
  const date = editing ? null : store.get(store.KEYS.sobrietyDate, /** @type {string|null} */ (null));
  const wrap = el('section', { class: 'counter', 'aria-labelledby': 'h-count' });

  if (!date) {
    const input = el('input', { type: 'date', id: 'sobriety-date', max: cal.localDateKey(at), value: editing || undefined, 'aria-label': 'Your first day' });
    const err = el('p', { class: 'error', role: 'alert', hidden: true });
    append(wrap, [
      el('h2', { id: 'h-count' }, editing ? 'Change your first day' : 'Count your days'),
      el('p', { class: 'muted' }, 'Pick your first day. The count stays on this phone and is never sent anywhere.'),
      el('form', { class: 'row', onSubmit: (/** @type {Event} */ e) => {
        e.preventDefault();
        const v = /** @type {HTMLInputElement} */ (input).value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > cal.localDateKey(at)) { err.textContent = 'Choose a date that is today or earlier.'; err.hidden = false; return; }
        if (!store.set(store.KEYS.sobrietyDate, v)) toast('Saved for this session only (storage unavailable)'); else toast('Counting. One day at a time.');
        renderAll();
      } }, input, el('button', { class: 'btn primary', type: 'submit' }, editing ? 'Save' : 'Start counting'),
        editing ? el('button', { class: 'btn outline', type: 'button', onClick: () => renderAll() }, 'Cancel') : null),
      err,
    ]);
    return wrap;
  }

  const days = cal.daysSince(date, at);
  const ms = CONFIG.milestones.slice();
  for (let y = 2; y * 365 <= days + 365; y++) ms.push(y * 365);
  const done = ms.filter((m) => days >= m);
  const next = ms.find((m) => m > days) || (Math.floor(days / 365) + 1) * 365;
  const prev = done.length ? done[done.length - 1] : 0;
  const pct = Math.min(100, Math.round(((days - prev) / (next - prev)) * 100));
  const startDate = cal.localMidnight(date);
  /** @param {number} m */
  const label = (m) => (m % 365 === 0 ? `${m / 365} year${m / 365 > 1 ? 's' : ''}` : `${m} day${m > 1 ? 's' : ''}`);

  const confirmRow = el('div', { class: 'row', hidden: true },
    el('span', { class: 'small muted' }, 'Stop counting and clear the date?'),
    el('button', { class: 'btn danger small', type: 'button', onClick: () => { store.remove(store.KEYS.sobrietyDate); renderAll(); toast('Cleared'); } }, 'Clear'),
    el('button', { class: 'btn small', type: 'button', onClick: () => { confirmRow.hidden = true; } }, 'Keep'));

  append(wrap, [
    el('div', { class: 'eyebrow' }, 'Your recovery'),
    el('div', { class: 'big num', id: 'h-count' }, dayLabel(days).big, el('small', {}, dayLabel(days).small)),
    el('p', { class: 'muted small' }, `Since ${cal.fmtDateLong(startDate)}. ${days >= next ? '' : `${next - days} day${next - days === 1 ? '' : 's'} to ${label(next)}.`}`),
    el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': `Progress to ${label(next)}` }, el('div', { style: { width: `${pct}%` } })),
    el('div', { class: 'milestones' }, ms.slice(0, 10).map((m) => el('span', { class: `m${days >= m ? ' done' : m === next ? ' next' : ''}` }, days >= m ? [icon('check'), ' '] : null, label(m)))),
    el('div', { class: 'row' },
      el('button', { class: 'btn outline small', type: 'button', onClick: () => { const fresh = sobrietyCounter(date); wrap.replaceWith(fresh); fresh.querySelector('input')?.focus(); } }, 'Change date'),
      el('button', { class: 'btn small', type: 'button', onClick: () => { confirmRow.hidden = false; } }, 'Stop counting')),
    confirmRow,
  ]);
  return wrap;
}

/** @param {HTMLElement} panel */
function breathingTool(panel) {
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ring = el('div', { class: 'breath-ring', 'aria-hidden': 'true' }, el('span', {}, 'Ready'));
  const cue = el('p', { class: 'sr-only', 'aria-live': 'assertive' });
  const count = el('p', { class: 'breath-count num' }, '4 seconds in · 4 hold · 4 out · 4 hold');
  const start = el('button', { class: 'btn primary', type: 'button' }, 'Start');
  const done = el('button', { class: 'btn outline', type: 'button', onClick: () => { stopActivity(); clear(panel); } }, 'Done');
  let running = false, timer = 0, cycles = 0;
  /** @type {[string, number][]} */
  const phases = [['Breathe in', 1], ['Hold', 1], ['Breathe out', .6], ['Hold', .6]];
  /** @param {number} i */
  function step(i) {
    if (!running) return;
    const [text, scale] = phases[i % 4];
    if (i % 4 === 0 && i > 0) cycles++;
    ring.style.setProperty('--s', String(reduced ? .8 : scale));
    ring.style.setProperty('--t', '4s');
    ring.firstElementChild && (ring.firstElementChild.textContent = text);
    cue.textContent = `${text} for four`;
    count.textContent = cycles ? `${cycles} round${cycles === 1 ? '' : 's'} complete` : 'Round 1';
    timer = window.setTimeout(() => step(i + 1), 4000);
  }
  start.addEventListener('click', () => {
    if (running) { running = false; clearTimeout(timer); start.textContent = 'Resume'; ring.firstElementChild && (ring.firstElementChild.textContent = 'Paused'); return; }
    running = true; start.textContent = 'Pause'; step(0);
  });
  append(panel, [el('div', { class: 'card' }, el('div', { class: 'breath' },
    el('h3', {}, 'Box breathing'), ring, cue, count,
    el('div', { class: 'row' }, start, done),
    el('p', { class: 'muted small', style: { textAlign: 'center', maxWidth: '36ch' } }, 'Follow the circle. Two or three rounds is enough to feel the difference; do as many as you need.')))]);
  return () => { running = false; clearTimeout(timer); };
}

/** @param {HTMLElement} panel */
function urgeTool(panel) {
  const TOTAL = 15 * 60;
  const tips = [
    'An urge is a wave. It rises, it crests, it passes, whether or not you act on it.',
    'Notice where you feel it in your body. Name it: “this is an urge.” It is not a command.',
    'Play the tape forward. What happens an hour after the first one? Tomorrow morning?',
    'Text or call one person from your list. You don’t have to explain everything.',
    'Change the scene: another room, outside, a glass of water, a shower.',
    'You have gotten through every hard moment so far. This one is no different.',
  ];
  let left = TOTAL, running = false, iv = 0, tipIdx = 0;
  const clock = el('div', { class: 'clock num', 'aria-live': 'off' }, '15:00');
  const tip = el('p', { class: 'tip', 'aria-live': 'polite' }, tips[0]);
  const start = el('button', { class: 'btn primary', type: 'button' }, 'Start 15 minutes');
  const reset = el('button', { class: 'btn outline', type: 'button', onClick: () => { stop(); left = TOTAL; draw(); start.textContent = 'Start 15 minutes'; } }, 'Reset');
  function draw() { clock.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; }
  function stop() { running = false; clearInterval(iv); }
  start.addEventListener('click', () => {
    if (running) { stop(); start.textContent = 'Resume'; return; }
    running = true; start.textContent = 'Pause';
    iv = window.setInterval(() => {
      left--; draw();
      if (left % 45 === 0) { tipIdx = (tipIdx + 1) % tips.length; tip.textContent = tips[tipIdx]; }
      if (left <= 0) { stop(); tip.textContent = 'You rode it out. That counts. Consider telling someone you did.'; start.textContent = 'Start again'; left = TOTAL; }
    }, 1000);
  });
  append(panel, [el('div', { class: 'card' }, el('div', { class: 'timer' },
    el('h3', {}, 'Ride the urge'), clock, tip,
    el('div', { class: 'row', style: { justifyContent: 'center' } }, start, reset, el('a', { class: 'btn violet', href: '#phones' }, icon('phone'), 'Call someone'))))]);
  return stop;
}

/** @param {HTMLElement} panel */
function haltTool(panel) {
  const items = {
    Hungry: 'Eat something real, even small. Low blood sugar makes everything feel like a crisis.',
    Angry: 'Anger wants action. Write the unsent text, walk it off, or say the feeling out loud to someone safe.',
    Lonely: 'Loneliness lies about being alone. Text one person from your list, or join the next Monday group.',
    Tired: 'Decisions made exhausted are rarely good ones. Rest first. The problem will still be there, and smaller.',
  };
  /** @type {Set<string>} */
  const chosen = new Set();
  const out = el('div', { class: 'halt-out' });
  function draw() {
    clear(out);
    if (!chosen.size) { out.appendChild(el('p', { class: 'muted small' }, 'Tap what’s true right now.')); return; }
    for (const k of chosen) out.appendChild(el('div', { class: 'card soft' }, el('strong', {}, k, ' — '), items[/** @type {keyof typeof items} */ (k)]));
  }
  draw();
  append(panel, [el('div', { class: 'card stack' },
    el('h3', {}, 'HALT check'),
    el('div', { class: 'halt' }, Object.keys(items).map((k) => el('button', { type: 'button', 'aria-pressed': 'false', onClick: (/** @type {MouseEvent} */ e) => {
      const b = /** @type {HTMLElement} */ (e.currentTarget);
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on)); if (on) chosen.add(k); else chosen.delete(k); draw();
    } }, k))),
    out)]);
}

// ---------------------------------------------------------------- more

/** @param {HTMLElement} sec */
function renderMore(sec) {
  const c = state.content;
  append(sec, [
    el('section', { class: 'section', 'aria-labelledby': 'h-programs' },
      el('h2', { id: 'h-programs' }, 'OTI programs'),
      el('div', { class: 'stack' }, c.programs.map((/** @type {any} */ p) => el('div', { class: 'card program' },
        el('h3', {}, p.name), el('p', { class: 'muted' }, p.summary),
        p.details?.length ? el('ul', {}, p.details.map((/** @type {string} */ d) => el('li', {}, d))) : null,
        p.cta ? (p.cta.url.startsWith('#') ? el('a', { class: 'btn small outline', href: p.cta.url }, p.cta.label) : ext(p.cta.url, { class: 'btn small primary' }, p.cta.label)) : null)))),

    el('section', { class: 'section', 'aria-labelledby': 'h-stories2' },
      el('h2', { id: 'h-stories2' }, 'Stories of impact'),
      el('div', { class: 'stack' }, c.testimonials.map((/** @type {any} */ t) => el('div', { class: 'card' }, quoteBlock(t)))),
      el('div', { class: 'card soft share-story' },
        el('strong', {}, 'Share your story'),
        el('p', { class: 'muted small' }, 'Your words help the next mom believe recovery is possible. Email OTI and we’ll only publish with your OK.'),
        el('div', { class: 'row' }, el('span', { class: 'mono' }, c.org.email),
          el('button', { class: 'btn small outline', type: 'button', onClick: async () => toast((await copyText(c.org.email)) ? 'Email copied' : 'Could not copy') }, icon('copy'), 'Copy'),
          el('a', { class: 'btn small primary', href: `mailto:${c.org.email}?subject=${encodeURIComponent('My OTI story')}` }, 'Email'))),
      c.newsletters?.length ? el('div', { class: 'stack' },
        el('h3', {}, 'Newsletters'),
        el('div', { class: 'link-list' }, c.newsletters.map((/** @type {any} */ n) => linkItem(n.title, n.url, n.latest ? 'Latest issue (PDF)' : 'PDF')))) : null),

    el('section', { class: 'section', 'aria-labelledby': 'h-training' },
      el('div', {}, el('h2', { id: 'h-training' }, 'Peer training'), el('p', { class: 'muted small' }, c.trainingNote)),
      el('div', { class: 'stack' }, c.training.map((/** @type {any} */ t) => el('div', { class: 'card course' },
        el('h3', {}, t.name),
        el('div', { class: 'facts' }, el('span', { class: 'pill training' }, `${t.ceHours} CE`), el('span', { class: 'pill hours' }, t.series)),
        el('p', { class: 'muted small' }, t.schedule), el('p', {}, t.outcome), el('p', { class: 'muted small' }, `For: ${t.audience}`),
        ext(t.url, { class: 'btn small violet' }, 'Details & enrollment'))))),

    el('section', { class: 'section', 'aria-labelledby': 'h-involved' },
      el('h2', { id: 'h-involved' }, 'Get involved'),
      el('div', { class: 'row' },
        ext(c.org.donateUrl, { class: 'btn primary' }, icon('heart'), 'Donate'),
        ext(c.org.sponsorsUrl, { class: 'btn outline' }, 'Business sponsors'),
        ext(c.org.contactUrl, { class: 'btn outline' }, 'Volunteer / contact')),
      el('div', { class: 'social' }, c.org.social.map((/** @type {any} */ s) => ext(s.url, {}, s.label)))),

    el('section', { class: 'section', 'aria-labelledby': 'h-about' },
      el('h2', { id: 'h-about' }, 'About this app'),
      el('div', { class: 'card stack about' },
        el('p', {}, `OTI Recovery app ${CONFIG.appVersion} · content ${c.version} · ${native.isNative() ? native.platform() : 'web'}`),
        el('p', {}, 'Your sobriety date and “My people” contacts are stored only on this device. The app has no analytics and no ads. Links open the organization’s own websites.'),
        el('p', {}, 'If you join the members’ Community, your email, the name you choose, and the messages you post are stored on OTI’s private community server and shown only to the roles listed on each topic. You can sign out at any time, and OTI can remove your membership on request.'),
        el('p', {}, 'This app offers peer and community resources. It is not medical care. If you are in danger, call 911.'),
        CONFIG.privacyUrl ? ext(CONFIG.privacyUrl, {}, 'Privacy policy') : null,
        ext(c.org.website, {}, c.org.website.replace(/^https?:\/\//, '')))),
  ]);
}

// ---------------------------------------------------------------- boot

async function boot() {
  const loading = document.getElementById('loading');
  try {
    state.content = await loadContent();
  } catch (err) {
    if (loading) {
      clear(loading);
      append(loading, [el('div', { class: 'notice danger' }, 'Couldn’t load the app content. '),
        el('button', { class: 'btn primary', type: 'button', style: { marginTop: '12px' }, onClick: () => location.reload() }, 'Try again')]);
    }
    return;
  }
  if (loading) loading.remove();

  window.addEventListener('hashchange', navigate);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  const moreBtn = document.getElementById('more-btn');
  if (moreBtn) moreBtn.addEventListener('click', () => go('more'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') renderAll(); });
  native.onBackButton(() => {
    const sheet = document.getElementById('sheet');
    if (sheet && !sheet.hidden) { closeSheet(); return true; }
    if (state.view === 'community' && state.community && state.community.handleBack()) return true;
    if (state.view !== 'home') { go('home'); return true; }
    return false;
  });

  if (!location.hash) {
    const last = store.get(store.KEYS.lastTab, 'home');
    if (VIEWS.includes(last) && last !== 'home') history.replaceState(null, '', `#${last}`);
  }
  navigate();
  refreshRemoteContent();

  if ('serviceWorker' in navigator && !native.isNative() && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* optional */ });
  }
}

boot();
