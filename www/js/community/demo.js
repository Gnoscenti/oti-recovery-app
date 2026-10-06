// @ts-check
/**
 * In-memory Community API with SAMPLE data. Used by:
 *   - the no-login review build (dist/review.html) so OTI can see the feature
 *     without an account, and switch between roles to see what each one sees;
 *   - unit tests for the UI logic.
 * Names and messages are fictional. It mirrors the visibility matrix in
 * supabase/seed.sql; the real enforcement is Row Level Security on the server.
 */
import { demoCohorts } from '../cohorts/api.js';
import { hasLevel } from './helpers.js';

/** @typedef {import('./api.js').CommunityApi} CommunityApi */
/** @typedef {import('./helpers.js').Message} Message */
/** @typedef {import('./helpers.js').Role} Role */
/** @typedef {import('./helpers.js').Level} Level */

const MATRIX = /** @type {Record<string, Partial<Record<Role, Level>>>} */ ({
  events: { participant: 'post', coach: 'moderate' },
  affirmations: { participant: 'post', coach: 'moderate' },
});

/**
 * @param {{now?: () => Date, viewerRole?: Role}} [opts]
 * @returns {CommunityApi & {setViewer: (role: 'participant'|'coach'|'board'|'admin'|'newmember'|'pending'|'signed-out') => void, viewer: () => string}}
 */
export function createDemoApi(opts = {}) {
  const now = opts.now || (() => new Date());
  const iso = (/** @type {number} */ minutesAgo) => new Date(now().getTime() - minutesAgo * 60000).toISOString();

  const users = {
    participant: { id: 'u-sample-participant', email: 'sample.participant@example.org', displayName: 'Sam', role: /** @type {Role} */ ('participant') },
    newmember: { id: 'u-newmember', email: 'newmember@example.org', displayName: '', role: /** @type {Role} */ ('participant') },
    coach: { id: 'u-gigi', email: 'coach@example.org', displayName: 'Gigi', role: /** @type {Role} */ ('coach') },
    board: { id: 'u-board', email: 'board@example.org', displayName: 'Dana (board)', role: /** @type {Role} */ ('board') },
    admin: { id: 'u-admin', email: 'admin@example.org', displayName: 'Julie', role: /** @type {Role} */ ('admin') },
    pending: { id: 'u-pending', email: 'newperson@example.org', displayName: '', role: /** @type {Role} */ ('none') },
  };
  const others = {
    maya: { id: 'u-maya', displayName: 'Maya', role: /** @type {Role} */ ('participant') },
    tess: { id: 'u-tess', displayName: 'Tess R.', role: /** @type {Role} */ ('participant') },
  };

  const channels = [
    { id: 'c-events', slug: 'events', name: 'Events', description: 'Upcoming OTI events, TnT outings, rides, and who is coming.', pinModeratorLatest: false, sortOrder: 10 },
    { id: 'c-affirmations', slug: 'affirmations', name: 'Daily Affirmations', description: 'A daily affirmation from your coach, and a place to share yours.', pinModeratorLatest: true, sortOrder: 20 },
  ];

  /** @type {Message[]} */
  let messages = [
    m('m1', 'c-events', users.coach, 'TnT this month: ferry ride to Coronado on Saturday the 11th. Meet at Broadway Pier at 10:30. Kids welcome. Reply here if you need a ride.', 60 * 26),
    m('m2', 'c-events', others.maya, 'I can drive from Chula Vista, room for 2 more (plus car seats).', 60 * 25),
    m('m3', 'c-events', users.board, 'Board note: we have 4 extra tickets from Here to Thrive sponsors for the Padres family night on the 18th. First come, first served.', 60 * 20),
    m('m4', 'c-events', others.tess, 'Monday group is still 7pm on Zoom this week, right?', 60 * 3),
    m('m5', 'c-events', users.coach, 'Yes, same link. See you all tonight.', 60 * 2 + 40),
    m('a1', 'c-affirmations', users.coach, 'Today’s affirmation: I don’t have to have it all figured out to take the next right step.', 60 * 30),
    m('a2', 'c-affirmations', others.maya, 'Needed this. Rough morning with school drop-off but I’m here.', 60 * 29),
    m('a3', 'c-affirmations', others.tess, 'Mine for today: my kids get the mom I’m becoming, not the one I was.', 60 * 27),
    m('a4', 'c-affirmations', users.coach, 'Today’s affirmation: My past is a chapter, not the whole book. I get to write today.', 45),
    m('a5', 'c-affirmations', others.maya, '❤️ Day 62 today.', 30),
  ];

  /** @type {{id:string, messageId:string, reason:string, createdAt:string, resolvedAt:string|null}[]} */
  const reports = [{ id: 'r1', messageId: 'm3', reason: 'Not sure this belongs in Events', createdAt: iso(60), resolvedAt: null }];
  /** @type {Record<string, string>} */
  const readMarks = {};
  /** @type {Set<string>} */
  const accepted = new Set(['u-gigi', 'u-board', 'u-admin', 'u-sample-participant']);
  /** @type {Record<string, string>} */
  const names = Object.fromEntries(Object.values(users).map((u) => [u.id, u.displayName]));
  /** @type {Array<{email:string, role:Role, note:string|null, addedAt:string, redeemedAt:string|null, redeemedBy:string|null}>} */
  const allowlist = [
    { email: 'coach@example.org', role: 'coach', note: 'Gigi', addedAt: iso(60 * 24 * 30), redeemedAt: iso(60 * 24 * 29), redeemedBy: 'u-gigi' },
    { email: 'board@example.org', role: 'board', note: 'Dana', addedAt: iso(60 * 24 * 20), redeemedAt: iso(60 * 24 * 19), redeemedBy: 'u-board' },
    { email: 'maya@example.org', role: 'participant', note: null, addedAt: iso(60 * 24 * 10), redeemedAt: iso(60 * 24 * 9), redeemedBy: 'u-maya' },
    { email: 'tess@example.org', role: 'participant', note: null, addedAt: iso(60 * 24 * 8), redeemedAt: iso(60 * 24 * 8), redeemedBy: 'u-tess' },
    { email: 'sample.participant@example.org', role: 'participant', note: 'sample', addedAt: iso(60 * 24 * 2), redeemedAt: iso(60 * 24), redeemedBy: 'u-sample-participant' },
    { email: 'newmember@example.org', role: 'participant', note: 'just joined', addedAt: iso(30), redeemedAt: iso(5), redeemedBy: 'u-newmember' },
    { email: 'invited@example.org', role: 'participant', note: 'invited, not signed in yet', addedAt: iso(20), redeemedAt: null, redeemedBy: null },
  ];

  /** @type {keyof typeof users | 'signed-out'} */
  let viewerKey = opts.viewerRole && opts.viewerRole !== 'none' ? opts.viewerRole : 'participant';
  /** @type {Set<(m: Message, kind: 'insert'|'update') => void>} */
  const listeners = new Set();
  /** @type {Set<(s: import('./api.js').Session|null) => void>} */
  const authListeners = new Set();

  function viewer() { return viewerKey === 'signed-out' ? null : users[viewerKey]; }
  /** @param {string} channelId */
  function levelFor(channelId) {
    const v = viewer(); if (!v) return null;
    const c = channels.find((x) => x.id === channelId); if (!c) return null;
    if (!cohort.cohortMember('sample-a')) return null;
    return MATRIX[c.slug][v.role] || null;
  }
  /** @param {string} id */
  function slugOf(id) { return channels.find((c) => c.id === id)?.slug || ''; }
  /** @param {Message} msg */
  function visible(msg) {
    const v = viewer(); if (!v) return false;
    if (!hasLevel(levelFor(msg.channelId), 'read')) return false;
    if (msg.hiddenAt && msg.authorId !== v.id && !hasLevel(levelFor(msg.channelId), 'moderate')) return false;
    return true;
  }
  /** @param {any} u */
  function session(u) { return u ? { userId: u.id, email: u.email } : null; }

  const cohort = demoCohorts(viewer, now);
  return {
    ...cohort,
    mode: 'demo',
    setViewer(role) { viewerKey = /** @type {any} */ (role); authListeners.forEach((cb) => cb(session(viewer()))); },
    viewer() { return viewerKey; },
    async getSession() { return session(viewer()); },
    onAuthChange(cb) { authListeners.add(cb); return () => authListeners.delete(cb); },
    async requestCode() { /* sample: nothing is sent */ },
    async verifyCode(email, code) {
      if (code.replace(/\D/g, '') !== '123456') throw new Error('invalid code');
      viewerKey = 'participant';
      const s = session(viewer());
      authListeners.forEach((cb) => cb(s));
      return /** @type {import('./api.js').Session} */ (s);
    },
    async signOut() { this.setViewer('signed-out'); },
    async getMe() {
      const v = viewer(); if (!v) return null;
      return { id: v.id, displayName: names[v.id] ?? v.displayName, role: v.role, status: 'active', acceptedGuidelines: accepted.has(v.id) };
    },
    async updateMe(patch) {
      const v = viewer(); if (!v) throw new Error('not signed in');
      if (patch.displayName != null) { names[v.id] = patch.displayName; messages = messages.map((x) => (x.authorId === v.id ? { ...x, authorName: patch.displayName || '' } : x)); }
      if (patch.acceptGuidelines) accepted.add(v.id);
      return /** @type {import('./helpers.js').Profile} */ (await this.getMe());
    },
    async listChannels() {
      return channels.filter((c) => hasLevel(levelFor(c.id), 'read')).map((c) => ({
        id: c.id, slug: c.slug, name: c.name, description: c.description, pinModeratorLatest: c.pinModeratorLatest,
        access: Object.entries(MATRIX[c.slug]).map(([role, level]) => ({ role: /** @type {Role} */ (role), level: /** @type {Level} */ (level) })),
        myLevel: levelFor(c.id),
      }));
    },
    async listMessages(channelId, o = {}) {
      const limit = o.limit ?? 50;
      return messages.filter((x) => x.channelId === channelId && visible(x) && (!o.before || x.createdAt < o.before))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    },
    async sendMessage(channelId, body) {
      const v = viewer(); if (!v) throw new Error('not signed in');
      if (!hasLevel(levelFor(channelId), 'post')) throw new Error('new row violates row-level security policy');
      if (!accepted.has(v.id)) throw new Error('new row violates row-level security policy');
      if (!(names[v.id] ?? v.displayName)) throw new Error('name_required');
      const last = messages.filter((x) => x.authorId === v.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (last && now().getTime() - new Date(last.createdAt).getTime() < 5000) throw new Error('slow_down');
      const msg = { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, channelId, authorId: v.id, authorName: names[v.id] ?? v.displayName, authorRole: v.role, body: body.trim(), createdAt: now().toISOString(), editedAt: null, hiddenAt: null };
      messages.push(msg);
      listeners.forEach((cb) => cb(msg, 'insert'));
      return msg;
    },
    async editMessage(id, body) {
      const v = viewer(); const msg = messages.find((x) => x.id === id);
      if (!v || !msg || msg.authorId !== v.id) throw new Error('not_allowed');
      if (now().getTime() - new Date(msg.createdAt).getTime() > 15 * 60000) throw new Error('edit_window_closed');
      msg.body = body.trim(); msg.editedAt = now().toISOString();
      listeners.forEach((cb) => cb(msg, 'update'));
      return msg;
    },
    async hideMessage(id, hide) {
      const msg = messages.find((x) => x.id === id);
      if (!msg || !hasLevel(levelFor(msg.channelId), 'moderate')) throw new Error('not_allowed');
      msg.hiddenAt = hide ? now().toISOString() : null;
      listeners.forEach((cb) => cb(msg, 'update'));
    },
    async deleteMessage(id) {
      const v = viewer(); const msg = messages.find((x) => x.id === id);
      if (!v || !msg || !(msg.authorId === v.id || hasLevel(levelFor(msg.channelId), 'moderate'))) throw new Error('not_allowed');
      messages = messages.filter((x) => x.id !== id);
      listeners.forEach((cb) => cb({ ...msg, body: '' }, 'update'));
    },
    async reportMessage(id, reason) {
      const msg = messages.find((x) => x.id === id);
      if (!msg || !visible(msg)) throw new Error('not_allowed');
      if (!reports.some((r) => r.messageId === id && !r.resolvedAt)) reports.push({ id: `r-${Date.now()}`, messageId: id, reason, createdAt: now().toISOString(), resolvedAt: null });
    },
    async listOpenReports() {
      return reports.filter((r) => !r.resolvedAt).map((r) => ({ ...r, message: messages.find((x) => x.id === r.messageId) || null }))
        .filter((r) => r.message && hasLevel(levelFor(r.message.channelId), 'moderate'));
    },
    async resolveReport(id) { const r = reports.find((x) => x.id === id); if (r) r.resolvedAt = now().toISOString(); },
    async markRead(channelId) { const v = viewer(); if (v) readMarks[`${v.id}:${channelId}`] = now().toISOString(); },
    async unreadCounts() {
      const v = viewer();
      /** @type {Record<string, number>} */
      const out = {};
      if (!v) return out;
      for (const c of channels) {
        if (!hasLevel(levelFor(c.id), 'read')) continue;
        const since = readMarks[`${v.id}:${c.id}`] || '';
        out[c.id] = messages.filter((x) => x.channelId === c.id && x.authorId !== v.id && x.createdAt > since && visible(x)).length;
      }
      return out;
    },
    subscribe(channelId, onChange) {
      /** @param {Message} msg @param {'insert'|'update'} kind */
      const cb = (msg, kind) => { if (msg.channelId === channelId && visible(msg)) onChange(msg, kind); };
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    async listMembers() {
      const v = viewer(); if (!v || v.role !== 'admin') throw new Error('not_allowed');
      const profiles = [...Object.values(users).filter((u) => u.role !== 'none' && u.id !== 'u-newmember'), ...Object.values(others)].map((u) => ({ id: u.id, displayName: names[u.id] ?? u.displayName, role: u.role, status: /** @type {'active'} */ ('active'), createdAt: iso(60 * 24 * 5) }));
      return { allowlist: [...allowlist], profiles };
    },
    async addMember(email, role, note) {
      const v = viewer(); if (!v || v.role !== 'admin') throw new Error('not_allowed');
      const existing = allowlist.find((a) => a.email === email);
      if (existing) { existing.role = role; existing.note = note || null; }
      else allowlist.unshift({ email, role, note: note || null, addedAt: now().toISOString(), redeemedAt: null, redeemedBy: null });
    },
    async setMemberRole(email, role) { const a = allowlist.find((x) => x.email === email); if (a) a.role = role; },
    async removeMember(userId) {
      const v = viewer(); if (!v || v.role !== 'admin') throw new Error('not_allowed');
      messages = messages.map((x) => (x.authorId === userId ? { ...x, authorName: 'Former member' } : x));
    },
  };

  /**
   * @param {string} id @param {string} channelId @param {{id:string, displayName:string, role:Role}} author @param {string} body @param {number} minutesAgo
   * @returns {Message}
   */
  function m(id, channelId, author, body, minutesAgo) {
    return { id, channelId, authorId: author.id, authorName: author.displayName, authorRole: author.role, body, createdAt: iso(minutesAgo), editedAt: null, hiddenAt: null };
  }
}

