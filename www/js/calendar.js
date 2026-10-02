// @ts-check
/**
 * Calendar engine: expands recurring events into concrete occurrences and
 * builds month grids. Event times in content.json are wall-clock times in the
 * event's own timezone (America/Los_Angeles for OTI). They are converted to real
 * instants here, so a 7:00 PM Pacific meeting stays at 7:00 PM Pacific across
 * daylight-saving changes and shows at the correct local time for a viewer in
 * another timezone.
 */

/**
 * @typedef {'group'|'event'|'training'|'community'} EventType
 *
 * @typedef {Object} EventLink
 * @property {string} label
 * @property {string} url
 * @property {'register'|'join'|'info'} [kind]
 *
 * @typedef {Object} Recurrence
 * @property {'weekly'} freq
 * @property {string[]} byDay   Two-letter weekday codes: SU MO TU WE TH FR SA
 * @property {string} [until]   Inclusive last date, YYYY-MM-DD (event timezone)
 * @property {string[]} [exdates] Dates to skip, YYYY-MM-DD (event timezone)
 *
 * @typedef {Object} OtiEvent
 * @property {string} id
 * @property {string} title
 * @property {EventType} type
 * @property {string} description
 * @property {{name:string,address?:string,url?:string}} [location]
 * @property {string} start      YYYY-MM-DDTHH:mm wall-clock in `timezone`
 * @property {string} end        YYYY-MM-DDTHH:mm wall-clock in `timezone`
 * @property {string} timezone   IANA zone, e.g. America/Los_Angeles
 * @property {Recurrence|null} [recurrence]
 * @property {EventLink[]} [links]
 * @property {string} [image]
 * @property {{weekday:string,hour:number,minute:number,title:string,body:string}} [reminder]
 *
 * @typedef {Object} Occurrence
 * @property {OtiEvent} event
 * @property {Date} start        Real start instant
 * @property {Date} end          Real end instant
 * @property {string} dateKey    YYYY-MM-DD of this calendar day (viewer's local zone)
 * @property {number} dayIndex   0 for the first day of a multi-day span
 * @property {number} dayCount   Number of local days the span covers
 * @property {string} key        Unique per event+day
 *
 * @typedef {{y:number,m:number,d:number,hh:number,mm:number}} WallClock
 */

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MS_PER_DAY = 86400000;

/** @param {number} n */
function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Parse "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD") into wall-clock components.
 * @param {string} s
 * @returns {WallClock}
 */
export function parseWallClock(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`Bad date/time "${s}" (expected YYYY-MM-DDTHH:mm)`);
  return { y: +m[1], m: +m[2], d: +m[3], hh: m[4] ? +m[4] : 0, mm: m[5] ? +m[5] : 0 };
}

/**
 * Offset (minutes east of UTC) of `tz` at the given instant.
 * @param {Date} date
 * @param {string} tz
 */
export function tzOffsetMinutes(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  /** @type {Record<string, number>} */
  const p = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Convert wall-clock components in `tz` to a real instant.
 * @param {WallClock} wc
 * @param {string} tz
 */
export function zonedToDate(wc, tz) {
  const guess = Date.UTC(wc.y, wc.m - 1, wc.d, wc.hh, wc.mm);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

/**
 * Add whole days to a wall-clock date (calendar arithmetic, DST-proof).
 * @param {WallClock} wc
 * @param {number} days
 * @returns {WallClock}
 */
export function addWallDays(wc, days) {
  const t = new Date(Date.UTC(wc.y, wc.m - 1, wc.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: wc.hh, mm: wc.mm };
}

/** @param {WallClock} wc */
export function wallDateKey(wc) { return `${wc.y}-${pad2(wc.m)}-${pad2(wc.d)}`; }

/** @param {WallClock} wc  0 = Sunday */
export function wallWeekday(wc) { return new Date(Date.UTC(wc.y, wc.m - 1, wc.d)).getUTCDay(); }

/**
 * YYYY-MM-DD of an instant in the viewer's local timezone.
 * @param {Date} d
 */
export function localDateKey(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** @param {string} key YYYY-MM-DD → local midnight */
export function localMidnight(key) {
  const wc = parseWallClock(key);
  return new Date(wc.y, wc.m - 1, wc.d, 0, 0, 0, 0);
}

/**
 * Duration of an event in ms, from its wall-clock start/end (naive, so a
 * meeting across a DST change keeps its scheduled length).
 * @param {OtiEvent} ev
 */
function naiveDurationMs(ev) {
  const s = parseWallClock(ev.start), e = parseWallClock(ev.end);
  return Date.UTC(e.y, e.m - 1, e.d, e.hh, e.mm) - Date.UTC(s.y, s.m - 1, s.d, s.hh, s.mm);
}

/**
 * Yield the wall-clock start of every instance of `ev` whose start falls on or
 * before `untilInstant`. Non-recurring events yield once.
 * @param {OtiEvent} ev
 * @param {Date} untilInstant
 * @returns {Generator<WallClock>}
 */
function* instanceStarts(ev, untilInstant) {
  const first = parseWallClock(ev.start);
  const rec = ev.recurrence;
  if (!rec) { yield first; return; }
  if (rec.freq !== 'weekly') throw new Error(`Unsupported recurrence "${rec.freq}" on ${ev.id}`);

  const byDay = (rec.byDay && rec.byDay.length ? rec.byDay : [WEEKDAYS[wallWeekday(first)]])
    .map((d) => WEEKDAYS.indexOf(d.toUpperCase()))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (!byDay.length) throw new Error(`Recurrence on ${ev.id} has no valid byDay`);

  const untilKey = rec.until || null;
  const ex = new Set(rec.exdates || []);
  // Walk week by week from the week containing the first instance.
  const weekStart = addWallDays(first, -wallWeekday(first));
  for (let week = 0; week < 6000; week++) {
    let allPastUntil = true;
    for (const wd of byDay) {
      const wc = addWallDays(weekStart, week * 7 + wd);
      const key = wallDateKey(wc);
      if (key < wallDateKey(first)) continue;
      if (untilKey && key > untilKey) continue;
      allPastUntil = false;
      const instant = zonedToDate(wc, ev.timezone);
      if (instant.getTime() > untilInstant.getTime()) return;
      if (ex.has(key)) continue;
      yield wc;
    }
    if (untilKey && allPastUntil) return;
  }
}

/**
 * Expand events into per-local-day occurrences overlapping [rangeStart, rangeEnd).
 * @param {OtiEvent[]} events
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {Occurrence[]}
 */
export function expandEvents(events, rangeStart, rangeEnd) {
  /** @type {Occurrence[]} */
  const out = [];
  for (const ev of events) {
    const dur = naiveDurationMs(ev);
    for (const wc of instanceStarts(ev, rangeEnd)) {
      const start = zonedToDate(wc, ev.timezone);
      const end = new Date(start.getTime() + Math.max(dur, 0));
      if (end.getTime() <= rangeStart.getTime()) continue;
      if (start.getTime() >= rangeEnd.getTime()) continue;
      // Split across local days (an event ending exactly at midnight belongs to the prior day).
      const lastDayKey = localDateKey(new Date(end.getTime() - 1));
      let day = localMidnight(localDateKey(start));
      const days = [];
      while (localDateKey(day) <= lastDayKey) { days.push(localDateKey(day)); day = new Date(day.getTime() + MS_PER_DAY); }
      days.forEach((dateKey, i) => {
        const dayStart = localMidnight(dateKey);
        const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);
        if (dayEnd.getTime() <= rangeStart.getTime() || dayStart.getTime() >= rangeEnd.getTime()) return;
        out.push({ event: ev, start, end, dateKey, dayIndex: i, dayCount: days.length, key: `${ev.id}@${dateKey}` });
      });
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.event.title.localeCompare(b.event.title));
  return out;
}

/**
 * The next (or in-progress) occurrence of each event after `now`, one per
 * event, soonest first.
 * @param {OtiEvent[]} events
 * @param {Date} now
 * @param {{limit?:number, horizonDays?:number}} [opts]
 * @returns {Occurrence[]}
 */
export function upcoming(events, now, opts = {}) {
  const horizon = new Date(now.getTime() + (opts.horizonDays ?? 400) * MS_PER_DAY);
  // expandEvents already drops instances that have ended and, for a multi-day
  // event in progress, drops the days that are already over; entries are sorted
  // by start with day order preserved, so the first entry per event is the one to show.
  const all = expandEvents(events, now, horizon);
  /** @type {Map<string, Occurrence>} */
  const firstPerEvent = new Map();
  for (const occ of all) {
    if (!firstPerEvent.has(occ.event.id)) firstPerEvent.set(occ.event.id, occ);
  }
  const list = [...firstPerEvent.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  return opts.limit ? list.slice(0, opts.limit) : list;
}

/**
 * Sunday-first 6x7 month grid.
 * @param {number} year
 * @param {number} month 1-12
 * @returns {{dateKey:string, day:number, inMonth:boolean, date:Date}[]}
 */
export function monthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const lead = first.getDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(year, month - 1, 1 - lead + i);
    cells.push({ dateKey: localDateKey(date), day: date.getDate(), inMonth: date.getMonth() === month - 1, date });
  }
  return cells;
}

/**
 * Build a Google Calendar "add event" URL (works on web, Android, and iOS).
 * @param {Occurrence} occ
 */
export function googleCalendarUrl(occ) {
  const ev = occ.event;
  /** @param {Date} d */
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${fmt(occ.start)}/${fmt(occ.end)}`,
    details: [ev.description, ...(ev.links || []).map((l) => `${l.label}: ${l.url}`)].join('\n'),
    location: ev.location ? [ev.location.name, ev.location.address, ev.location.url].filter(Boolean).join(', ') : '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---- Formatting helpers (viewer's local timezone) -------------------------

/** @param {Date} d */
export function fmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
/** @param {Date} d */
export function fmtTimeZone(d) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(d);
  return (parts.find((p) => p.type === 'timeZoneName') || { value: '' }).value;
}
/** @param {Date} d */
export function fmtDateShort(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
/** @param {Date} d */
export function fmtDateLong(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
/** @param {Date} d */
export function fmtMonthYear(d) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Human phrase for how far away an occurrence is: "Today 7:00 PM", "Tomorrow", "In 3 days", "Mon, Oct 5".
 * @param {Occurrence} occ
 * @param {Date} now
 */
export function relativeDay(occ, now) {
  const a = localMidnight(localDateKey(now)).getTime();
  const b = localMidnight(occ.dateKey).getTime();
  const diff = Math.round((b - a) / MS_PER_DAY);
  if (occ.start.getTime() <= now.getTime() && occ.end.getTime() > now.getTime()) return 'Happening now';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  return fmtDateShort(occ.start);
}

/**
 * Days since a YYYY-MM-DD date (local), counting today as day 1 once the date has arrived.
 * @param {string} dateKey
 * @param {Date} now
 */
export function daysSince(dateKey, now) {
  const start = localMidnight(dateKey).getTime();
  const today = localMidnight(localDateKey(now)).getTime();
  return Math.floor((today - start) / MS_PER_DAY);
}

export const WEEKDAY_CODES = WEEKDAYS;
