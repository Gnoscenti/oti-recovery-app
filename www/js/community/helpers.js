// @ts-check
/**
 * Pure helpers for the Community feature (validation, grouping, labels).
 * No DOM, no network: everything here is unit-tested in Node.
 */

/** @typedef {'none'|'participant'|'coach'|'board'|'admin'} Role */
/** @typedef {'read'|'post'|'moderate'} Level */

/**
 * @typedef {Object} Channel
 * @property {string} id
 * @property {string} slug
 * @property {string} name
 * @property {string} description
 * @property {boolean} pinModeratorLatest
 * @property {{role: Role, level: Level}[]} access
 * @property {Level|null} myLevel
 *
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} channelId
 * @property {string} authorId
 * @property {string} authorName
 * @property {Role} authorRole
 * @property {string} body
 * @property {string} createdAt   ISO
 * @property {string|null} editedAt
 * @property {string|null} hiddenAt
 *
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} displayName
 * @property {Role} role
 * @property {'active'|'removed'} status
 * @property {boolean} acceptedGuidelines
 */

export const ROLE_LABEL = { none: 'No access', participant: 'Participant', coach: 'Coach', board: 'Board member', admin: 'Admin' };
export const ROLE_PLURAL = { participant: 'participants', coach: 'your coach', board: 'board members', admin: 'OTI admin' };
export const LEVEL_RANK = { read: 1, post: 2, moderate: 3 };
export const MAX_BODY = 2000;
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** @param {string} s */
export function normalizeEmail(s) { return String(s || '').trim().toLowerCase(); }

/** @param {string} s */
export function isValidEmail(s) {
  const e = normalizeEmail(s);
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

/** 6-digit one-time code, spaces allowed while typing. @param {string} s */
export function normalizeCode(s) { return String(s || '').replace(/\D/g, ''); }
/** @param {string} s */
export function isValidCode(s) { return /^\d{6}$/.test(normalizeCode(s)); }

/** @param {string} s */
export function normalizeDisplayName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
/** 2–40 characters, must contain a letter. @param {string} s */
export function isValidDisplayName(s) {
  const n = normalizeDisplayName(s);
  return n.length >= 2 && n.length <= 40 && /\p{L}/u.test(n);
}

/** @param {string} s */
export function normalizeBody(s) { return String(s || '').replace(/\r\n/g, '\n').trim(); }
/** @param {string} s */
export function bodyProblem(s) {
  const b = normalizeBody(s);
  if (!b) return 'Write something first.';
  if (b.length > MAX_BODY) return `Keep it under ${MAX_BODY} characters (${b.length} now).`;
  return null;
}

/**
 * @param {Level|null} mine
 * @param {Level} needed
 */
export function hasLevel(mine, needed) { return !!mine && LEVEL_RANK[mine] >= LEVEL_RANK[needed]; }

/**
 * "Visible to participants, board members, your coach" from the access matrix.
 * @param {{role: Role, level: Level}[]} access
 */
export function visibilityLabel(access) {
  const order = ['participant', 'coach', 'board', 'admin'];
  const names = order.filter((r) => access.some((a) => a.role === r)).map((r) => ROLE_PLURAL[/** @type {keyof typeof ROLE_PLURAL} */ (r)]);
  if (!names.length) return 'Visible to nobody yet';
  return `Visible to ${names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]}`;
}

/**
 * Which moderator roles a channel has (for the "Moderated by" line).
 * @param {{role: Role, level: Level}[]} access
 */
export function moderatorRoles(access) { return access.filter((a) => a.level === 'moderate').map((a) => a.role); }

/**
 * @param {Message[]} messages   any order
 * @returns {Message[]}          oldest first
 */
export function sortOldestFirst(messages) {
  return [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Merge a page of messages into an existing list without duplicates, oldest first.
 * @param {Message[]} existing
 * @param {Message[]} incoming
 */
export function mergeMessages(existing, incoming) {
  /** @type {Map<string, Message>} */
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return sortOldestFirst([...map.values()]);
}

/**
 * Group oldest-first messages by local calendar day.
 * @param {Message[]} messages
 * @param {Date} now
 * @returns {{label: string, items: Message[]}[]}
 */
export function groupByDay(messages, now) {
  /** @type {{label: string, key: string, items: Message[]}[]} */
  const groups = [];
  for (const m of sortOldestFirst(messages)) {
    const d = new Date(m.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, label: dayLabel(d, now), items: [m] });
  }
  return groups.map(({ label, items }) => ({ label, items }));
}

/**
 * "Today", "Yesterday", "Monday", or "Sep 12".
 * @param {Date} d
 * @param {Date} now
 */
export function dayLabel(d, now) {
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

/** @param {Date} d */
export function timeLabel(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

/**
 * @param {Message} m
 * @param {string} myId
 * @param {Date} now
 */
export function canEdit(m, myId, now) {
  return m.authorId === myId && now.getTime() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
}

/**
 * The newest visible post by a moderator-role author (pinned "Today's affirmation").
 * @param {Message[]} messages
 * @param {Role[]} modRoles
 */
export function pinnedMessage(messages, modRoles) {
  const list = sortOldestFirst(messages).filter((m) => !m.hiddenAt && modRoles.includes(m.authorRole));
  return list.length ? list[list.length - 1] : null;
}

/** @param {Record<string, number>} counts */
export function totalUnread(counts) { return Object.values(counts || {}).reduce((a, b) => a + (b > 0 ? b : 0), 0); }

/**
 * Translate a server error into a sentence a member can act on. Never leaks internals.
 * @param {unknown} err
 */
export function friendlyError(err) {
  const msg = String((err && typeof err === 'object' && 'message' in err) ? /** @type {any} */ (err).message : err || '');
  if (/slow_down/.test(msg)) return 'Please wait a few seconds between posts.';
  if (/daily_limit/.test(msg)) return 'You have reached today’s posting limit.';
  if (/name_required/.test(msg)) return 'Add a display name first.';
  if (/edit_window_closed/.test(msg)) return 'Messages can only be edited for 15 minutes.';
  if (/not_allowed/.test(msg)) return 'You can’t do that in this topic.';
  if (/row-level security|permission denied/.test(msg)) return 'You don’t have access to that.';
  if (/rate limit|too many requests|429/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.';
  if (/invalid|expired|otp/i.test(msg)) return 'That code didn’t work. Check the digits or request a new one.';
  if (/network|fetch|Failed to fetch|offline/i.test(msg)) return 'No connection. Check your internet and try again.';
  return 'Something went wrong. Please try again.';
}
