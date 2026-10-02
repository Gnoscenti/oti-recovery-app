// Validates www/data/content.json so a typo never ships a broken app.
//   node scripts/validate-content.mjs [path]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandEvents } from '../www/js/calendar.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(root, 'www', 'data', 'content.json');
const errors = [];
const err = (msg) => errors.push(msg);

const isUrl = (u) => typeof u === 'string' && /^(https?:\/\/[^\s]+|#[a-z]+)$/.test(u);
const isDateTime = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const WD = new Set(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']);
const TYPES = new Set(['group', 'event', 'training', 'community']);

let c;
try {
  c = JSON.parse(await readFile(file, 'utf8'));
} catch (e) {
  console.error(`content.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!isDate(c.version)) err('version must be YYYY-MM-DD (bump it whenever content changes)');
if (!c.org || typeof c.org.name !== 'string') err('org.name is required');
for (const k of ['website', 'donateUrl', 'contactUrl', 'sponsorsUrl']) if (!isUrl(c.org?.[k])) err(`org.${k} must be a URL`);
if (c.org?.phone != null && !/^\d{3,15}$/.test(c.org.phone)) err('org.phone must be digits only (or null)');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.org?.email || '')) err('org.email must be an email address');

const ids = new Set();
for (const [i, ev] of (c.events || []).entries()) {
  const where = `events[${i}] (${ev.id || 'no id'})`;
  if (!ev.id || ids.has(ev.id)) err(`${where}: id missing or duplicate`); ids.add(ev.id);
  if (!ev.title) err(`${where}: title required`);
  if (!TYPES.has(ev.type)) err(`${where}: type must be one of ${[...TYPES].join(', ')}`);
  if (!isDateTime(ev.start) || !isDateTime(ev.end)) err(`${where}: start/end must be YYYY-MM-DDTHH:mm`);
  if (ev.start >= ev.end) err(`${where}: end must be after start`);
  try { new Intl.DateTimeFormat('en-US', { timeZone: ev.timezone }); } catch { err(`${where}: unknown timezone ${ev.timezone}`); }
  if (ev.recurrence) {
    if (ev.recurrence.freq !== 'weekly') err(`${where}: only weekly recurrence is supported`);
    if (!Array.isArray(ev.recurrence.byDay) || !ev.recurrence.byDay.every((d) => WD.has(d))) err(`${where}: recurrence.byDay must be weekday codes`);
    if (ev.recurrence.until && !isDate(ev.recurrence.until)) err(`${where}: recurrence.until must be YYYY-MM-DD`);
    if (ev.recurrence.exdates && !ev.recurrence.exdates.every(isDate)) err(`${where}: recurrence.exdates must be YYYY-MM-DD`);
  }
  for (const l of ev.links || []) if (!l.label || !isUrl(l.url)) err(`${where}: link needs label and URL`);
  if (ev.location?.url && !isUrl(ev.location.url)) err(`${where}: location.url must be a URL`);
  if (ev.reminder) {
    const r = ev.reminder;
    if (!WD.has(r.weekday) || !(r.hour >= 0 && r.hour <= 23) || !(r.minute >= 0 && r.minute <= 59) || !r.title || !r.body) err(`${where}: reminder needs weekday, hour, minute, title, body`);
  }
}
if (!errors.length) {
  try { expandEvents(c.events, new Date(), new Date(Date.now() + 400 * 86400000)); } catch (e) { err(`events could not be expanded: ${e.message}`); }
}

const catIds = new Set((c.phoneCategories || []).map((x) => x.id));
for (const [i, p] of (c.phones || []).entries()) {
  const where = `phones[${i}] (${p.id || p.name || 'unnamed'})`;
  if (!p.id || !p.name || !p.display || !p.hours || !p.description) err(`${where}: id, name, display, hours, description are required`);
  if (p.number != null && !/^\d{3,15}$/.test(p.number)) err(`${where}: number must be digits only (no spaces or dashes) or null`);
  if (p.number == null && !p.sms) err(`${where}: needs a number or an sms entry`);
  if (p.sms && !/^\d{3,15}$/.test(p.sms.number || '')) err(`${where}: sms.number must be digits only`);
  if (!catIds.has(p.category)) err(`${where}: category "${p.category}" is not in phoneCategories`);
  if (p.url && !isUrl(p.url)) err(`${where}: url must be a URL`);
}

for (const [i, t] of (c.testimonials || []).entries()) if (!t.name || !t.quote) err(`testimonials[${i}]: name and quote are required`);
for (const [i, l] of (c.recoveryLinks || []).entries()) if (!l.label || !isUrl(l.url)) err(`recoveryLinks[${i}]: label and URL required`);
for (const [i, n] of (c.newsletters || []).entries()) if (!n.title || !isUrl(n.url)) err(`newsletters[${i}]: title and URL required`);
for (const [i, t] of (c.training || []).entries()) if (!t.name || !isUrl(t.url)) err(`training[${i}]: name and URL required`);
for (const [i, p] of (c.programs || []).entries()) if (!p.name || !p.summary || (p.cta && !isUrl(p.cta.url))) err(`programs[${i}]: name, summary, valid cta.url required`);

if (errors.length) {
  console.error(`content.json has ${errors.length} problem(s):\n - ${errors.join('\n - ')}`);
  process.exit(1);
}
console.log(`content.json OK: ${c.events.length} events, ${c.phones.length} phone lines, ${c.testimonials.length} stories, ${c.recoveryLinks.length} links (version ${c.version})`);
