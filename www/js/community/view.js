import { disablePush } from '../push/client.js';
// @ts-check
/**
 * Community tab UI: sign in with an emailed code → topics → messages,
 * plus moderation (reports) and member administration.
 * Talks only to a CommunityApi (supabase.js in production, demo.js in the
 * review build). All authorization is server-side; the UI just hides
 * controls the member cannot use.
 */
import { el, append, icon, clear, toast, copyText } from '../dom.js';
import * as H from './helpers.js';
import { STARTER_AFFIRMATION } from './affirmations.js';

/** @typedef {import('./api.js').CommunityApi} CommunityApi */
/** @typedef {import('./helpers.js').Channel} Channel */
/** @typedef {import('./helpers.js').Message} Message */
/** @typedef {import('./helpers.js').Profile} Profile */
/** @typedef {import('./helpers.js').Role} Role */

export const GUIDELINES = [
  'Be kind. Everyone here is doing hard work.',
  'What is shared here stays here. Don’t screenshot or repeat what other members post.',
  'Use a first name or nickname. Don’t post phone numbers, addresses, or anything about your kids that identifies them.',
  'No selling, no recruiting, and no talk that glamorizes using.',
  'Your coach and OTI moderate this space and may hide posts that don’t fit. You can report a post any time.',
  'This is peer support, not crisis care. If you or someone here is in danger, call 911 or 988.',
];

/**
 * @param {HTMLElement} root
 * @param {{
 *   api: CommunityApi|null,
 *   now: () => Date,
 *   orgEmail: string,
 *   review?: boolean,
 *   onUnread?: (total: number) => void,
 * }} ctx
 */
export function mountCommunity(root, ctx) {
  const api = ctx.api;
  const state = {
    /** @type {'loading'|'not-configured'|'signed-out'|'code'|'pending'|'onboarding'|'channels'|'channel'|'reports'|'members'} */
    screen: 'loading',
    email: '',
    /** @type {import('./api.js').Session|null} */ session: null,
    /** @type {Profile|null} */ me: null,
    /** @type {Channel[]} */ channels: [],
    /** @type {Channel|null} */ channel: null,
    /** @type {Message[]} */ messages: [],
    hasMore: false,
    /** @type {Record<string, number>} */ unread: {},
    /** @type {null | (() => void)} */ unsubscribe: null,
    busy: false,
  };

  // ---------------------------------------------------------------- lifecycle

  async function init() {
    if (!api) { state.screen = 'not-configured'; render(); return; }
    state.screen = 'loading'; render();
    try {
      state.session = await api.getSession();
      await route();
    } catch (err) {
      state.screen = 'signed-out'; render(H.friendlyError(err));
    }
  }

  /** Decide the screen from session + profile. */
  async function route() {
    if (!api) return;
    if (!state.session) { state.screen = 'signed-out'; render(); return; }
    state.me = await api.getMe();
    if (!state.me || state.me.role === 'none' || state.me.status !== 'active') { state.screen = 'pending'; render(); return; }
    if (!H.isValidDisplayName(state.me.displayName) || !state.me.acceptedGuidelines) { state.screen = 'onboarding'; render(); return; }
    await loadChannels();
    state.screen = 'channels'; render();
  }

  async function loadChannels() {
    if (!api) return;
    state.channels = await api.listChannels();
    try { state.unread = await api.unreadCounts(); } catch { state.unread = {}; }
    ctx.onUnread?.(H.totalUnread(state.unread));
  }

  function leaveChannel() {
    if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }
    state.channel = null; state.messages = [];
  }

  /** @param {Channel} c */
  async function openChannel(c) {
    if (!api) return;
    leaveChannel();
    state.channel = c; state.screen = 'channel'; state.messages = []; render();
    try {
      const page = await api.listMessages(c.id, { limit: 50 });
      state.messages = H.sortOldestFirst(page);
      state.hasMore = page.length >= 50;
      state.unsubscribe = api.subscribe(c.id, (m, kind) => {
        if (kind === 'update' && !m.body) { state.messages = state.messages.filter((x) => x.id !== m.id); }
        else state.messages = H.mergeMessages(state.messages, [m]);
        if (state.screen === 'channel' && state.channel?.id === c.id) { render(); scrollToEnd(); markRead(); }
      });
      render(); scrollToEnd(); markRead();
    } catch (err) { render(H.friendlyError(err)); }
  }

  async function markRead() {
    if (!api || !state.channel) return;
    try { await api.markRead(state.channel.id); state.unread[state.channel.id] = 0; ctx.onUnread?.(H.totalUnread(state.unread)); } catch { /* not critical */ }
  }

  function scrollToEnd() {
    requestAnimationFrame(() => {
      const anchor = root.querySelector('#msg-end');
      if (anchor) anchor.scrollIntoView({ block: 'end' });
    });
  }

  // ---------------------------------------------------------------- rendering

  /** @param {string|null} [error] */
  function render(error = null) {
    clear(root);
    const parts = [];
    if (ctx.review && api && api.mode === 'demo') parts.push(reviewBanner());
    if (error) parts.push(el('div', { class: 'notice danger', role: 'alert' }, error));
    switch (state.screen) {
      case 'loading': parts.push(el('div', { class: 'loading' }, 'Loading…')); break;
      case 'not-configured': parts.push(notConfigured()); break;
      case 'signed-out': parts.push(signIn()); break;
      case 'code': parts.push(codeEntry()); break;
      case 'pending': parts.push(pending()); break;
      case 'onboarding': parts.push(onboarding()); break;
      case 'channels': parts.push(channelList()); break;
      case 'channel': parts.push(channelView()); break;
      case 'reports': parts.push(reportsView()); break;
      case 'members': parts.push(membersView()); break;
    }
    append(root, parts);
  }

  function reviewBanner() {
    const demo = /** @type {any} */ (api);
    const options = [['participant', 'Participant'], ['coach', 'Coach'], ['board', 'Board member'], ['admin', 'Admin (Julie)'], ['gigi', 'Admin (Gigi)'], ['newmember', 'New member (first sign-in)'], ['pending', 'Not on the member list'], ['signed-out', 'Signed out']];
    const sel = el('select', { id: 'review-viewer', 'aria-label': 'View as', onChange: (/** @type {Event} */ e) => { demo.setViewer(/** @type {HTMLSelectElement} */ (e.target).value); leaveChannel(); init(); } },
      options.map(([v, label]) => el('option', { value: v, selected: demo.viewer() === v ? true : null }, label)));
    return el('div', { class: 'review-banner' },
      el('div', {}, el('strong', {}, 'Review copy · sample data'), el('span', { class: 'small' }, ' Nothing here is real. Names and messages are made up.')),
      el('label', { class: 'row', style: { gap: '8px' } }, el('span', { class: 'small', style: { fontWeight: '800' } }, 'View as'), sel));
  }

  function notConfigured() {
    return el('div', { class: 'card stack' },
      el('h2', {}, 'Community'),
      el('p', { class: 'muted' }, 'Topics for members: Events, and Daily Affirmations with your coach. This part of the app is not switched on yet.'),
      el('p', { class: 'small muted' }, 'OTI: follow docs/COMMUNITY-SETUP.md, then add the project URL and key to www/js/config.js.'));
  }

  function signIn() {
    const input = el('input', { id: 'signin-email', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'you@example.com', value: state.email || '', required: true });
    const err = el('p', { class: 'error', role: 'alert', hidden: true });
    const btn = el('button', { class: 'btn primary block', type: 'submit' }, 'Email me a code');
    return el('div', { class: 'stack', style: { gap: '16px' } },
      el('div', { class: 'card stack' },
        el('h2', {}, 'Members’ community'),
        el('p', { class: 'muted' }, 'A private place for OTI participants: Events, and Daily Affirmations with your coach. Sign in with the email OTI has on file. No password: we email you a 6-digit code.'),
        el('form', { class: 'stack', onSubmit: async (/** @type {Event} */ e) => {
          e.preventDefault();
          const email = H.normalizeEmail(/** @type {HTMLInputElement} */ (input).value);
          if (!H.isValidEmail(email)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; input.focus(); return; }
          err.hidden = true; btn.setAttribute('disabled', ''); btn.textContent = 'Sending…';
          try { await api?.requestCode(email); state.email = email; state.screen = 'code'; render(); }
          catch (ex) { err.textContent = H.friendlyError(ex); err.hidden = false; btn.removeAttribute('disabled'); btn.textContent = 'Email me a code'; }
        } },
          el('div', { class: 'field' }, el('label', { for: 'signin-email' }, 'Email'), input),
          err, btn)),
      el('p', { class: 'about' }, `Not a member yet? Email ${ctx.orgEmail} or ask your coach to add you.`));
  }

  function codeEntry() {
    const input = el('input', { id: 'signin-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]*', maxlength: '8', placeholder: '6-digit code', 'aria-label': 'Code from your email' });
    const err = el('p', { class: 'error', role: 'alert', hidden: true });
    const btn = el('button', { class: 'btn primary block', type: 'submit' }, 'Sign in');
    return el('div', { class: 'card stack' },
      el('h2', {}, 'Check your email'),
      el('p', { class: 'muted' }, `We sent a code to ${state.email}. It works for 10 minutes.`),
      api?.mode === 'demo' ? el('p', { class: 'small muted' }, 'Sample: the code is 123456.') : null,
      el('form', { class: 'stack', onSubmit: async (/** @type {Event} */ e) => {
        e.preventDefault();
        const code = H.normalizeCode(/** @type {HTMLInputElement} */ (input).value);
        if (!H.isValidCode(code)) { err.textContent = 'Enter the 6 digits from the email.'; err.hidden = false; input.focus(); return; }
        err.hidden = true; btn.setAttribute('disabled', ''); btn.textContent = 'Checking…';
        try { state.session = await api?.verifyCode(state.email, code) || null; await route(); }
        catch (ex) { err.textContent = H.friendlyError(ex); err.hidden = false; btn.removeAttribute('disabled'); btn.textContent = 'Sign in'; }
      } },
        el('div', { class: 'field' }, el('label', { for: 'signin-code' }, 'Code'), input), err, btn),
      el('div', { class: 'row' },
        el('button', { class: 'btn small outline', type: 'button', onClick: async () => { try { await api?.requestCode(state.email); toast('New code sent'); } catch (ex) { toast(H.friendlyError(ex)); } } }, 'Send a new code'),
        el('button', { class: 'btn small', type: 'button', onClick: () => { state.screen = 'signed-out'; render(); } }, 'Use a different email')));
  }

  function pending() {
    const email = state.session?.email || '';
    return el('div', { class: 'card stack' },
      el('h2', {}, 'Almost there'),
      el('p', { class: 'muted' }, 'You’re signed in, but this email isn’t on OTI’s member list yet. Ask your coach or OTI to add it, then come back and this page will open.'),
      el('div', { class: 'row' }, el('span', { class: 'mono' }, email),
        el('button', { class: 'btn small outline', type: 'button', onClick: async () => toast((await copyText(email)) ? 'Email copied' : 'Could not copy') }, icon('copy'), 'Copy')),
      el('p', { class: 'small muted' }, `OTI contact: ${ctx.orgEmail}`),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary small', type: 'button', onClick: () => init() }, 'Check again'),
        el('button', { class: 'btn small', type: 'button', onClick: signOut }, 'Sign out')));
  }

  function onboarding() {
    const name = el('input', { id: 'ob-name', type: 'text', maxlength: '40', autocomplete: 'given-name', value: state.me?.displayName || '', placeholder: 'First name or nickname' });
    const agree = el('input', { id: 'ob-agree', type: 'checkbox', style: { width: 'auto', minHeight: '0' } });
    const err = el('p', { class: 'error', role: 'alert', hidden: true });
    return el('div', { class: 'card stack' },
      el('h2', {}, 'Welcome to the community'),
      el('p', { class: 'muted' }, 'Two quick things before you join the conversation.'),
      el('form', { class: 'stack', onSubmit: async (/** @type {Event} */ e) => {
        e.preventDefault();
        const n = H.normalizeDisplayName(/** @type {HTMLInputElement} */ (name).value);
        if (!H.isValidDisplayName(n)) { err.textContent = 'Use 2–40 characters for your name.'; err.hidden = false; name.focus(); return; }
        if (!/** @type {HTMLInputElement} */ (agree).checked) { err.textContent = 'Please agree to the community guidelines.'; err.hidden = false; return; }
        err.hidden = true;
        try { state.me = await api?.updateMe({ displayName: n, acceptGuidelines: true }) || state.me; await route(); toast('Welcome!'); }
        catch (ex) { err.textContent = H.friendlyError(ex); err.hidden = false; }
      } },
        el('div', { class: 'field' }, el('label', { for: 'ob-name' }, 'How should we show your name?'), name, el('p', { class: 'help' }, 'Other members see this name on your posts. A first name is enough.')),
        el('div', {}, el('strong', {}, 'Community guidelines'), el('ul', { class: 'guidelines' }, GUIDELINES.map((g) => el('li', {}, g)))),
        el('label', { class: 'row', for: 'ob-agree', style: { alignItems: 'center', fontWeight: '700', color: 'inherit' } }, agree, 'I agree to the guidelines'),
        err,
        el('button', { class: 'btn primary block', type: 'submit' }, 'Join the community')));
  }

  function channelList() {
    const me = /** @type {Profile} */ (state.me);
    const isMod = state.channels.some((c) => H.hasLevel(c.myLevel, 'moderate'));
    return el('div', { class: 'stack', style: { gap: '16px' } },
      el('div', {}, el('h2', {}, 'Topics'), el('p', { class: 'muted small' }, `Signed in as ${me.displayName} · ${H.ROLE_LABEL[me.role]}`)),
      state.channels.length
        ? el('div', { class: 'stack' }, state.channels.map((c) => el('button', { class: 'topic', type: 'button', onClick: () => openChannel(c) },
            el('span', { class: 'topic-main' },
              el('span', { class: 'row', style: { gap: '8px' } }, el('strong', {}, c.name), state.unread[c.id] > 0 ? el('span', { class: 'badge', 'aria-label': `${state.unread[c.id]} unread` }, String(state.unread[c.id])) : null),
              el('span', { class: 'muted small' }, c.description),
              el('span', { class: 'vis' }, icon('people'), H.visibilityLabel(c.access))),
            el('span', { class: 'chev' }, icon('chev')))))
        : el('div', { class: 'empty' }, 'No topics are open to your role yet.'),
      (isMod || me.role === 'admin') ? el('div', { class: 'stack' },
        el('h3', {}, 'For moderators'),
        isMod ? el('button', { class: 'topic', type: 'button', onClick: () => openReports() }, el('span', { class: 'topic-main' }, el('strong', {}, 'Reported posts'), el('span', { class: 'muted small' }, 'Posts members flagged in topics you moderate.')), el('span', { class: 'chev' }, icon('chev'))) : null,
        me.role === 'admin' ? el('button', { class: 'topic', type: 'button', onClick: () => openMembers() }, el('span', { class: 'topic-main' }, el('strong', {}, 'Members'), el('span', { class: 'muted small' }, 'Add people by email and set their role.')), el('span', { class: 'chev' }, icon('chev'))) : null) : null,
      el('div', { class: 'row' },
        el('button', { class: 'btn small outline', type: 'button', onClick: () => { state.screen = 'onboarding'; render(); } }, 'Change my name'),
        el('button', { class: 'btn small', type: 'button', onClick: signOut }, 'Sign out')),
      el('p', { class: 'about' }, 'Messages here are stored on OTI’s private community server and are visible only to the roles listed on each topic. Moderators can hide posts; you can report any post.'));
  }

  function channelView() {
    const c = /** @type {Channel} */ (state.channel);
    const me = /** @type {Profile} */ (state.me);
    const now = ctx.now();
    const canPost = H.hasLevel(c.myLevel, 'post');
    const isMod = H.hasLevel(c.myLevel, 'moderate');
    const modRoles = H.moderatorRoles(c.access);
    const pinned = c.pinModeratorLatest ? H.pinnedMessage(state.messages, modRoles) : null;

    const header = el('div', { class: 'chan-head' },
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back to topics', onClick: () => back() }, icon('left')),
      el('div', { class: 'chan-title' }, el('h2', {}, c.name), el('span', { class: 'vis' }, icon('people'), H.visibilityLabel(c.access))));

    const groups = H.groupByDay(state.messages, now);
    const list = el('div', { class: 'msgs', id: 'msgs' },
      state.hasMore ? el('button', { class: 'btn small outline', type: 'button', style: { alignSelf: 'center' }, onClick: loadEarlier }, 'Load earlier messages') : null,
      !state.messages.length ? el('div', { class: 'empty' }, canPost ? 'No messages yet. Start the conversation.' : 'No messages yet.') : null,
      groups.map((g) => [el('div', { class: 'day-sep' }, el('span', {}, g.label)), g.items.map((m) => messageBubble(m, me, isMod, now))]),
      el('div', { id: 'msg-end' }));

    return el('div', { class: 'chan' },
      header,
      !pinned && c.slug === 'affirmations' ? el('div', { class: 'pinned' }, el('span', { class: 'eyebrow' }, 'Starting affirmation'), el('p', {}, STARTER_AFFIRMATION)) : null,
      pinned ? el('div', { class: 'pinned' }, el('span', { class: 'eyebrow' }, 'Latest coach affirmation'), el('p', {}, pinned.body), el('span', { class: 'muted small' }, `${pinned.authorName} · ${H.dayLabel(new Date(pinned.createdAt), now)}`)) : null,
      list,
      canPost ? composer() : el('p', { class: 'about' }, 'You can read this topic but not post in it.'));
  }

  /**
   * @param {Message} m
   * @param {Profile} me
   * @param {boolean} isMod
   * @param {Date} now
   */
  function messageBubble(m, me, isMod, now) {
    const mine = m.authorId === me.id;
    const wrap = el('article', { class: `msg${mine ? ' mine' : ''}${m.hiddenAt ? ' hidden-msg' : ''}`, 'aria-label': `${m.authorName}, ${H.timeLabel(new Date(m.createdAt))}` });
    const actions = el('div', { class: 'msg-actions', hidden: true });
    const meta = el('div', { class: 'msg-meta' },
      !mine ? el('strong', {}, m.authorName) : el('strong', {}, 'You'),
      !mine && (m.authorRole === 'coach' || m.authorRole === 'admin' || m.authorRole === 'board') ? el('span', { class: 'pill role' }, H.ROLE_LABEL[m.authorRole]) : null,
      el('span', { class: 'num' }, H.timeLabel(new Date(m.createdAt))),
      m.editedAt ? el('span', {}, '· edited') : null,
      m.hiddenAt ? el('span', { class: 'hidden-tag' }, mine ? '· hidden by a moderator' : '· hidden') : null,
      el('button', { class: 'msg-more', type: 'button', 'aria-label': 'Message actions', onClick: () => { actions.hidden = !actions.hidden; } }, icon('more')));
    const body = el('p', { class: 'msg-body' }, m.body);

    const btns = [];
    if (H.canEdit(m, me.id, now)) btns.push(el('button', { class: 'btn small outline', type: 'button', onClick: () => startEdit(m, wrap) }, 'Edit'));
    if (mine || isMod) btns.push(el('button', { class: 'btn small danger', type: 'button', onClick: () => confirmInline(actions, 'Delete this message for everyone?', 'Delete', async () => { await api?.deleteMessage(m.id); state.messages = state.messages.filter((x) => x.id !== m.id); render(); toast('Deleted'); }) }, 'Delete'));
    if (isMod && !mine) btns.push(el('button', { class: 'btn small outline', type: 'button', onClick: async () => { try { await api?.hideMessage(m.id, !m.hiddenAt); m.hiddenAt = m.hiddenAt ? null : new Date().toISOString(); render(); toast(m.hiddenAt ? 'Hidden from members' : 'Visible again'); } catch (ex) { toast(H.friendlyError(ex)); } } }, m.hiddenAt ? 'Unhide' : 'Hide'));
    if (!mine) btns.push(el('button', { class: 'btn small', type: 'button', onClick: () => reportInline(actions, m) }, 'Report'));
    append(actions, btns);
    append(wrap, [meta, body, actions]);
    return wrap;
  }

  /**
   * @param {HTMLElement} host
   * @param {string} question
   * @param {string} yes
   * @param {() => Promise<void>} run
   */
  function confirmInline(host, question, yes, run) {
    clear(host);
    append(host, [el('span', { class: 'small muted' }, question),
      el('button', { class: 'btn small danger', type: 'button', onClick: async () => { try { await run(); } catch (ex) { toast(H.friendlyError(ex)); } } }, yes),
      el('button', { class: 'btn small', type: 'button', onClick: () => render() }, 'Keep')]);
  }

  /** @param {HTMLElement} host @param {Message} m */
  function reportInline(host, m) {
    clear(host);
    const reason = el('input', { type: 'text', maxlength: '300', placeholder: 'What’s wrong? (optional)', 'aria-label': 'Reason' });
    append(host, [reason,
      el('button', { class: 'btn small primary', type: 'button', onClick: async () => {
        try { await api?.reportMessage(m.id, H.normalizeBody(/** @type {HTMLInputElement} */ (reason).value) || 'Reported by a member'); toast('Thanks. A moderator will take a look.'); render(); }
        catch (ex) { toast(H.friendlyError(ex)); }
      } }, 'Send report'),
      el('button', { class: 'btn small', type: 'button', onClick: () => render() }, 'Cancel')]);
  }

  /** @param {Message} m @param {HTMLElement} wrap */
  function startEdit(m, wrap) {
    const ta = el('textarea', { rows: '3', maxlength: String(H.MAX_BODY) }, m.body);
    const form = el('form', { class: 'stack', onSubmit: async (/** @type {Event} */ e) => {
      e.preventDefault();
      const problem = H.bodyProblem(/** @type {HTMLTextAreaElement} */ (ta).value);
      if (problem) { toast(problem); return; }
      try { const updated = await api?.editMessage(m.id, H.normalizeBody(/** @type {HTMLTextAreaElement} */ (ta).value)); if (updated) state.messages = H.mergeMessages(state.messages, [updated]); render(); toast('Saved'); }
      catch (ex) { toast(H.friendlyError(ex)); }
    } }, ta, el('div', { class: 'row' }, el('button', { class: 'btn small primary', type: 'submit' }, 'Save'), el('button', { class: 'btn small', type: 'button', onClick: () => render() }, 'Cancel')));
    clear(wrap); append(wrap, [form]); ta.focus();
  }

  function composer() {
    const ta = el('textarea', { id: 'composer', rows: '2', maxlength: String(H.MAX_BODY), placeholder: state.channel?.slug === 'affirmations' ? 'Share an affirmation or a reply…' : 'Write a message…', 'aria-label': 'Message' });
    const count = el('span', { class: 'small muted num', 'aria-live': 'polite' }, '');
    const send = el('button', { class: 'btn primary', type: 'submit' }, 'Send');
    ta.addEventListener('input', () => { const n = /** @type {HTMLTextAreaElement} */ (ta).value.length; count.textContent = n > H.MAX_BODY - 200 ? `${H.MAX_BODY - n} left` : ''; });
    ta.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); /** @type {HTMLFormElement} */ (form).requestSubmit(); } });
    const form = el('form', { class: 'composer', onSubmit: async (/** @type {Event} */ e) => {
      e.preventDefault();
      if (state.busy || !state.channel) return;
      const text = /** @type {HTMLTextAreaElement} */ (ta).value;
      const problem = H.bodyProblem(text);
      if (problem) { toast(problem); return; }
      state.busy = true; send.setAttribute('disabled', '');
      try {
        const m = await api?.sendMessage(state.channel.id, H.normalizeBody(text));
        if (m) state.messages = H.mergeMessages(state.messages, [m]);
        /** @type {HTMLTextAreaElement} */ (ta).value = ''; count.textContent = '';
        render(); scrollToEnd(); markRead();
      } catch (ex) { toast(H.friendlyError(ex)); }
      finally { state.busy = false; send.removeAttribute('disabled'); }
    } }, ta, el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('span', { class: 'small muted' }, 'In crisis? Call or text 988.'), el('span', { class: 'row' }, count, send)));
    return form;
  }

  async function loadEarlier() {
    if (!api || !state.channel || !state.messages.length) return;
    try {
      const page = await api.listMessages(state.channel.id, { before: state.messages[0].createdAt, limit: 50 });
      state.messages = H.mergeMessages(state.messages, page);
      state.hasMore = page.length >= 50;
      render();
    } catch (ex) { toast(H.friendlyError(ex)); }
  }

  async function openReports() {
    if (!api) return;
    leaveChannel(); state.screen = 'reports'; render();
    try { reportsCache = await api.listOpenReports(); render(); } catch (ex) { render(H.friendlyError(ex)); }
  }
  /** @type {import('./api.js').Report[]} */
  let reportsCache = [];

  function reportsView() {
    return el('div', { class: 'stack', style: { gap: '14px' } },
      el('div', { class: 'chan-head' }, el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back to topics', onClick: () => back() }, icon('left')), el('div', { class: 'chan-title' }, el('h2', {}, 'Reported posts'))),
      reportsCache.length ? reportsCache.map((r) => {
        const ch = state.channels.find((c) => c.id === r.message?.channelId);
        return el('div', { class: 'card stack' },
          el('div', { class: 'msg-meta' }, el('strong', {}, r.message?.authorName || 'Unknown'), el('span', { class: 'muted small' }, `in ${ch?.name || 'a topic'} · ${r.message ? H.dayLabel(new Date(r.message.createdAt), ctx.now()) : ''}`)),
          el('p', {}, r.message?.body || '(message no longer available)'),
          el('p', { class: 'small muted' }, `Report: ${r.reason}`),
          el('div', { class: 'row' },
            r.message ? el('button', { class: 'btn small outline', type: 'button', onClick: async () => { try { await api?.hideMessage(r.messageId, true); await api?.resolveReport(r.id); await openReports(); toast('Hidden'); } catch (ex) { toast(H.friendlyError(ex)); } } }, 'Hide post') : null,
            r.message ? el('button', { class: 'btn small danger', type: 'button', onClick: async () => { try { await api?.deleteMessage(r.messageId); await api?.resolveReport(r.id); await openReports(); toast('Deleted'); } catch (ex) { toast(H.friendlyError(ex)); } } }, 'Delete post') : null,
            el('button', { class: 'btn small', type: 'button', onClick: async () => { try { await api?.resolveReport(r.id); await openReports(); toast('Dismissed'); } catch (ex) { toast(H.friendlyError(ex)); } } }, 'Dismiss')));
      }) : el('div', { class: 'empty' }, 'No open reports. Nice.'));
  }

  /** @type {{allowlist: import('./api.js').AllowlistEntry[], profiles: import('./api.js').MemberProfile[]}} */
  let membersCache = { allowlist: [], profiles: [] };

  async function openMembers() {
    if (!api) return;
    leaveChannel(); state.screen = 'members'; render();
    try { membersCache = await api.listMembers(); render(); } catch (ex) { render(H.friendlyError(ex)); }
  }

  function membersView() {
    const email = el('input', { id: 'mem-email', type: 'email', inputmode: 'email', placeholder: 'person@example.com', required: true });
    const role = el('select', { id: 'mem-role' }, ['participant', 'board', 'coach', 'admin'].map((r) => el('option', { value: r }, H.ROLE_LABEL[/** @type {Role} */ (r)])));
    const note = el('input', { id: 'mem-note', type: 'text', maxlength: '120', placeholder: 'Note (optional), e.g. first name' });
    const err = el('p', { class: 'error', role: 'alert', hidden: true });
    const form = el('form', { class: 'stack', onSubmit: async (/** @type {Event} */ e) => {
      e.preventDefault();
      const em = H.normalizeEmail(/** @type {HTMLInputElement} */ (email).value);
      if (!H.isValidEmail(em)) { err.textContent = 'Enter a valid email address.'; err.hidden = false; return; }
      err.hidden = true;
      try { await api?.addMember(em, /** @type {Role} */ (/** @type {HTMLSelectElement} */ (role).value), /** @type {HTMLInputElement} */ (note).value.trim()); toast(`${em} added`); await openMembers(); }
      catch (ex) { err.textContent = H.friendlyError(ex); err.hidden = false; }
    } },
      el('div', { class: 'field' }, el('label', { for: 'mem-email' }, 'Email'), email),
      el('div', { class: 'grid-2' }, el('div', { class: 'field' }, el('label', { for: 'mem-role' }, 'Role'), role), el('div', { class: 'field' }, el('label', { for: 'mem-note' }, 'Note'), note)),
      el('p', { class: 'help' }, 'Participants and assigned coaches see their cohort topics. Board members have no cohort access. Admins manage members and cohort event logistics, and do not see Daily Affirmations.'),
      err,
      el('button', { class: 'btn primary', type: 'submit' }, 'Add member'));

    const rows = membersCache.allowlist.map((a) => {
      const prof = membersCache.profiles.find((p) => p.id === a.redeemedBy);
      const sel = el('select', { 'aria-label': `Role for ${a.email}`, onChange: async (/** @type {Event} */ e) => { try { await api?.setMemberRole(a.email, /** @type {Role} */ (/** @type {HTMLSelectElement} */ (e.target).value)); toast('Role updated'); } catch (ex) { toast(H.friendlyError(ex)); } } },
        ['participant', 'board', 'coach', 'admin'].map((r) => el('option', { value: r, selected: a.role === r ? true : null }, H.ROLE_LABEL[/** @type {Role} */ (r)])));
      const acts = el('div', { class: 'acts' }, sel);
      const card = el('div', { class: 'person' },
        el('div', { class: 'who' }, el('strong', {}, a.email), el('span', {}, [a.note, prof ? (prof.status === 'removed' ? 'Removed' : `Joined as ${prof.displayName || '(no name yet)'}`) : 'Not signed in yet'].filter(Boolean).join(' · '))),
        acts);
      if (prof && prof.status === 'active') acts.appendChild(el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${a.email}`, onClick: () => {
        const confirm = el('div', { class: 'confirm' }, `Remove ${a.email}? They lose access now and their posts show as “Former member”.`,
          el('button', { class: 'btn danger small', type: 'button', onClick: async () => { try { await api?.removeMember(prof.id); toast('Removed'); await openMembers(); } catch (ex) { toast(H.friendlyError(ex)); } } }, 'Remove'),
          el('button', { class: 'btn small', type: 'button', onClick: () => confirm.remove() }, 'Keep'));
        card.appendChild(confirm);
      } }, icon('x')));
      return card;
    });

    return el('div', { class: 'stack', style: { gap: '14px' } },
      el('div', { class: 'chan-head' }, el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back to topics', onClick: () => back() }, icon('left')), el('div', { class: 'chan-title' }, el('h2', {}, 'Members'))),
      el('div', { class: 'card' }, el('h3', { style: { marginBottom: '8px' } }, 'Add someone'), form),
      el('h3', {}, `Member list (${membersCache.allowlist.length})`),
      rows.length ? el('div', { class: 'stack' }, rows) : el('div', { class: 'empty' }, 'Nobody yet.'));
  }

  // ---------------------------------------------------------------- actions

  async function signOut() {
    leaveChannel();
    try { if(api)await disablePush(api);await api?.signOut(); } catch { toast('Could not finish sign-out. Please try again.'); return; }
    state.session = null; state.me = null; state.channels = []; state.unread = {}; ctx.onUnread?.(0);
    state.screen = 'signed-out'; render();
  }

  /** Back within the tab: channel/reports/members → topics. Returns true when consumed. */
  function back() {
    if (['channel', 'reports', 'members'].includes(state.screen)) {
      leaveChannel();
      state.screen = 'channels';
      loadChannels().then(() => render()).catch(() => render());
      render();
      return true;
    }
    return false;
  }

  init();
  return {
    handleBack: back,
    refresh: async () => { leaveChannel(); state.messages = []; await init(); },
    destroy: () => { leaveChannel(); },
  };
}

