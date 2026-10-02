// Run with: npm test   (node --test). Timezone is pinned so results are deterministic.
process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWallClock, zonedToDate, tzOffsetMinutes, addWallDays, expandEvents, upcoming,
  monthGrid, googleCalendarUrl, relativeDay, daysSince, localDateKey,
} from '../www/js/calendar.js';

const mondayGroup = {
  id: 'monday-group', title: 'Online Recovery Support Group', type: 'group', description: '',
  start: '2026-01-05T19:00', end: '2026-01-05T20:00', timezone: 'America/Los_Angeles',
  recurrence: { freq: 'weekly', byDay: ['MO'] },
};
const gala = {
  id: 'gala', title: 'Here to Thrive', type: 'event', description: 'Dinner',
  start: '2026-09-25T18:00', end: '2026-09-25T21:00', timezone: 'America/Los_Angeles', recurrence: null,
  location: { name: 'KPBS Community Engagement Center' }, links: [{ label: 'Tickets', url: 'https://example.org/t' }],
};
const cohort = {
  id: 'cohort', title: 'Coach Blueprint', type: 'training', description: '',
  start: '2026-09-14T15:30', end: '2026-09-14T17:00', timezone: 'America/Los_Angeles',
  recurrence: { freq: 'weekly', byDay: ['MO', 'TU', 'WE', 'TH', 'FR'], until: '2026-09-18' },
};

test('parseWallClock accepts date and date-time', () => {
  assert.deepEqual(parseWallClock('2026-09-25T18:05'), { y: 2026, m: 9, d: 25, hh: 18, mm: 5 });
  assert.deepEqual(parseWallClock('2026-09-25'), { y: 2026, m: 9, d: 25, hh: 0, mm: 0 });
  assert.throws(() => parseWallClock('9/25/2026'));
});

test('zonedToDate respects daylight saving time', () => {
  const summer = zonedToDate(parseWallClock('2026-07-06T19:00'), 'America/Los_Angeles');
  const winter = zonedToDate(parseWallClock('2026-01-05T19:00'), 'America/Los_Angeles');
  assert.equal(summer.toISOString(), '2026-07-07T02:00:00.000Z'); // PDT = UTC-7
  assert.equal(winter.toISOString(), '2026-01-06T03:00:00.000Z'); // PST = UTC-8
  assert.equal(tzOffsetMinutes(summer, 'America/Los_Angeles'), -420);
  assert.equal(tzOffsetMinutes(winter, 'America/Los_Angeles'), -480);
});

test('addWallDays crosses month and year boundaries', () => {
  assert.deepEqual(addWallDays(parseWallClock('2026-12-30T10:00'), 3), { y: 2027, m: 1, d: 2, hh: 10, mm: 0 });
  assert.deepEqual(addWallDays(parseWallClock('2026-03-01T10:00'), -1), { y: 2026, m: 2, d: 28, hh: 10, mm: 0 });
});

test('weekly recurrence expands to every Monday in range, including across the DST change', () => {
  const occs = expandEvents([mondayGroup], new Date('2026-03-01T08:00:00Z'), new Date('2026-03-31T08:00:00Z'));
  assert.deepEqual(occs.map((o) => o.dateKey), ['2026-03-02', '2026-03-09', '2026-03-16', '2026-03-23', '2026-03-30']);
  // 7 PM Pacific on both sides of the March 8 DST change
  assert.equal(occs[0].start.toISOString(), '2026-03-03T03:00:00.000Z'); // PST
  assert.equal(occs[1].start.toISOString(), '2026-03-10T02:00:00.000Z'); // PDT
  assert.ok(occs.every((o) => o.end.getTime() - o.start.getTime() === 3600000));
});

test('recurrence does not start before the first instance', () => {
  const occs = expandEvents([mondayGroup], new Date('2025-12-01T00:00:00Z'), new Date('2026-01-21T00:00:00Z'));
  assert.deepEqual(occs.map((o) => o.dateKey), ['2026-01-05', '2026-01-12', '2026-01-19']);
});

test('until and exdates are honored', () => {
  const ev = { ...mondayGroup, recurrence: { freq: 'weekly', byDay: ['MO'], until: '2026-01-19', exdates: ['2026-01-12'] } };
  const occs = expandEvents([ev], new Date('2026-01-01T00:00:00Z'), new Date('2026-03-01T00:00:00Z'));
  assert.deepEqual(occs.map((o) => o.dateKey), ['2026-01-05', '2026-01-19']);
});

test('multi-weekday recurrence models a Mon–Fri cohort', () => {
  const occs = expandEvents([cohort], new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(occs.map((o) => o.dateKey), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
  assert.equal(occs[0].start.toISOString(), '2026-09-14T22:30:00.000Z');
});

test('single events appear once and are clipped by range', () => {
  const inRange = expandEvents([gala], new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0].dateKey, '2026-09-25');
  const outOfRange = expandEvents([gala], new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
  assert.equal(outOfRange.length, 0);
});

test('an overnight event spans two calendar days', () => {
  const ev = { ...gala, id: 'overnight', start: '2026-09-25T22:00', end: '2026-09-26T02:00' };
  const occs = expandEvents([ev], new Date('2026-09-20T00:00:00Z'), new Date('2026-09-30T00:00:00Z'));
  assert.deepEqual(occs.map((o) => [o.dateKey, o.dayIndex, o.dayCount]), [['2026-09-25', 0, 2], ['2026-09-26', 1, 2]]);
});

test('upcoming lists one occurrence per event, soonest first, skipping ended ones', () => {
  const now = new Date('2026-09-25T20:00:00-07:00'); // Friday 8 PM Pacific: gala in progress, cohort over
  const list = upcoming([mondayGroup, gala, cohort], now);
  assert.deepEqual(list.map((o) => o.event.id), ['gala', 'monday-group']);
  assert.equal(list[1].dateKey, '2026-09-28');
  assert.equal(relativeDay(list[0], now), 'Happening now');
  assert.equal(relativeDay(list[1], now), 'In 3 days');
});

test('upcoming with a limit', () => {
  const now = new Date('2026-09-01T12:00:00-07:00');
  const list = upcoming([mondayGroup, gala, cohort], now, { limit: 2 });
  assert.equal(list.length, 2);
  assert.equal(list[0].event.id, 'monday-group');
});

test('relativeDay wording', () => {
  const now = new Date('2026-09-28T12:00:00-07:00'); // Monday noon
  const [next] = upcoming([mondayGroup], now);
  assert.equal(next.dateKey, '2026-09-28');
  assert.equal(relativeDay(next, now), 'Today');
  const tomorrow = upcoming([{ ...gala, start: '2026-09-29T18:00', end: '2026-09-29T21:00' }], now)[0];
  assert.equal(relativeDay(tomorrow, now), 'Tomorrow');
});

test('monthGrid is a Sunday-first 42-cell grid', () => {
  const grid = monthGrid(2026, 9); // September 2026 starts on a Tuesday
  assert.equal(grid.length, 42);
  assert.equal(grid[0].dateKey, '2026-08-30');
  assert.equal(grid[2].dateKey, '2026-09-01');
  assert.equal(grid.filter((c) => c.inMonth).length, 30);
});

test('googleCalendarUrl carries title, UTC times, and location', () => {
  const [occ] = expandEvents([gala], new Date('2026-09-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
  const u = new URL(googleCalendarUrl(occ));
  assert.equal(u.searchParams.get('text'), 'Here to Thrive');
  assert.equal(u.searchParams.get('dates'), '20260926T010000Z/20260926T040000Z');
  assert.equal(u.searchParams.get('location'), 'KPBS Community Engagement Center');
  assert.match(u.searchParams.get('details'), /Tickets: https:\/\/example.org\/t/);
});

test('daysSince counts calendar days in local time', () => {
  const now = new Date('2026-09-25T23:30:00-07:00');
  assert.equal(daysSince('2026-09-25', now), 0);
  assert.equal(daysSince('2026-09-24', now), 1);
  assert.equal(daysSince('2026-08-26', now), 30);
  assert.equal(localDateKey(now), '2026-09-25');
});
