process.env.TZ = 'America/Los_Angeles';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../www/js/community/helpers.js';
import { createDemoApi } from '../www/js/community/demo.js';

const NOW = new Date('2026-09-28T19:00:00-07:00');

test('email, code, and display-name validation', () => {
  assert.ok(H.isValidEmail(' Julie@Example.org '));
  assert.equal(H.normalizeEmail(' Julie@Example.org '), 'julie@example.org');
  for (const bad of ['', 'julie', 'julie@', '@x.org', 'a b@c.org']) assert.ok(!H.isValidEmail(bad), bad);
  assert.ok(H.isValidCode('123 456'));
  assert.equal(H.normalizeCode('12-34 56'), '123456');
  for (const bad of ['12345', '1234567', 'abcdef', '']) assert.ok(!H.isValidCode(bad), bad);
  assert.ok(H.isValidDisplayName('  Pam   R. '));
  assert.equal(H.normalizeDisplayName('  Pam   R. '), 'Pam R.');
  for (const bad of ['', 'P', '123', 'x'.repeat(41)]) assert.ok(!H.isValidDisplayName(bad), JSON.stringify(bad));
});

test('message body limits', () => {
  assert.equal(H.bodyProblem('   '), 'Write something first.');
  assert.equal(H.bodyProblem('hi'), null);
  assert.match(H.bodyProblem('x'.repeat(2001)) || '', /under 2000/);
  assert.equal(H.normalizeBody('a\r\nb  '), 'a\nb');
});

test('levels and visibility labels follow the matrix', () => {
  assert.ok(H.hasLevel('moderate', 'post'));
  assert.ok(H.hasLevel('post', 'read'));
  assert.ok(!H.hasLevel('read', 'post'));
  assert.ok(!H.hasLevel(null, 'read'));
  const events = [{ role: 'participant', level: 'post' }, { role: 'board', level: 'post' }, { role: 'coach', level: 'moderate' }, { role: 'admin', level: 'moderate' }];
  const aff = [{ role: 'participant', level: 'post' }, { role: 'coach', level: 'moderate' }];
  assert.equal(H.visibilityLabel(events), 'Visible to participants, your coach, board members and OTI admin');
  assert.equal(H.visibilityLabel(aff), 'Visible to participants and your coach');
  assert.deepEqual(H.moderatorRoles(aff), ['coach']);
  assert.equal(H.visibilityLabel([]), 'Visible to nobody yet');
});

test('grouping by day, ordering, merging, pinned affirmation', () => {
  const m = (id, minutesAgo, authorRole = 'participant', hiddenAt = null) => ({ id, channelId: 'c', authorId: 'u' + id, authorName: id, authorRole, body: id, createdAt: new Date(NOW.getTime() - minutesAgo * 60000).toISOString(), editedAt: null, hiddenAt });
  const msgs = [m('a', 5), m('b', 60 * 30), m('c', 60 * 24 * 3), m('coach1', 120, 'coach'), m('coach2', 30, 'coach', NOW.toISOString())];
  const groups = H.groupByDay(msgs, NOW);
  assert.deepEqual(groups.map((g) => g.label), ['Friday', 'Yesterday', 'Today']);
  assert.deepEqual(groups[2].items.map((x) => x.id), ['coach1', 'coach2', 'a']);
  const merged = H.mergeMessages(msgs, [{ ...m('a', 5), body: 'edited' }, m('z', 1)]);
  assert.equal(merged.length, 6);
  assert.equal(merged.find((x) => x.id === 'a').body, 'edited');
  assert.equal(merged[merged.length - 1].id, 'z');
  assert.equal(H.pinnedMessage(msgs, ['coach']).id, 'coach1', 'hidden coach post is not pinned');
  assert.equal(H.pinnedMessage(msgs, ['admin']), null);
});

test('edit window and unread totals', () => {
  const recent = { id: '1', channelId: 'c', authorId: 'me', authorName: '', authorRole: 'participant', body: '', createdAt: new Date(NOW.getTime() - 5 * 60000).toISOString(), editedAt: null, hiddenAt: null };
  assert.ok(H.canEdit(recent, 'me', NOW));
  assert.ok(!H.canEdit(recent, 'other', NOW));
  assert.ok(!H.canEdit({ ...recent, createdAt: new Date(NOW.getTime() - 16 * 60000).toISOString() }, 'me', NOW));
  assert.equal(H.totalUnread({ a: 2, b: 0, c: 5 }), 7);
  assert.equal(H.totalUnread({}), 0);
});

test('server errors become plain sentences', () => {
  assert.equal(H.friendlyError(new Error('slow_down: please wait')), 'Please wait a few seconds between posts.');
  assert.equal(H.friendlyError({ message: 'new row violates row-level security policy for table "messages"' }), 'You don’t have access to that.');
  assert.equal(H.friendlyError('not_allowed: only a moderator'), 'You can’t do that in this topic.');
  assert.equal(H.friendlyError(new Error('Token has expired or is invalid')), 'That code didn’t work. Check the digits or request a new one.');
  assert.equal(H.friendlyError(new TypeError('Failed to fetch')), 'No connection. Check your internet and try again.');
  assert.equal(H.friendlyError(undefined), 'Something went wrong. Please try again.');
});

test('demo adapter mirrors the visibility matrix per role', async () => {
  const api = createDemoApi({ now: () => NOW });
  const slugs = async () => (await api.listChannels()).map((c) => c.slug);
  api.setViewer('participant'); assert.deepEqual(await slugs(), ['events', 'affirmations']);
  api.setViewer('board'); assert.deepEqual(await slugs(), []);
  api.setViewer('coach'); assert.deepEqual(await slugs(), ['events', 'affirmations']);
  api.setViewer('admin'); assert.deepEqual(await slugs(), []);
  api.setViewer('pending'); assert.deepEqual(await slugs(), []);
  api.setViewer('signed-out'); assert.equal(await api.getSession(), null);
  api.setViewer('board');
  assert.equal((await api.listMessages('c-affirmations')).length, 0, 'board cannot read affirmations even by id');
  await assert.rejects(api.sendMessage('c-affirmations', 'x'), /row-level security/);
  api.setViewer('participant');
  assert.ok((await api.listMessages('c-affirmations')).length >= 4);
});

test('demo adapter: posting, moderation, reports, unread, and the onboarding gate', async () => {
  const api = createDemoApi({ now: () => NOW });
  api.setViewer('newmember');
  assert.equal((await api.getMe()).displayName, '');
  await assert.rejects(api.sendMessage('c-events', 'hello'), /row-level security|name_required/);
  await api.updateMe({ displayName: 'Nell', acceptGuidelines: true });
  api.setViewer('coach');
  await api.assignCohort('sample-a','u-newmember',true);
  api.setViewer('newmember');
  const sent = await api.sendMessage('c-events', 'hello from Nell');
  assert.equal(sent.authorName, 'Nell');
  await assert.rejects(api.sendMessage('c-events', 'again'), /slow_down/);

  api.setViewer('coach');
  const before = await api.unreadCounts();
  assert.ok(before['c-events'] >= 1);
  await api.markRead('c-events');
  assert.equal((await api.unreadCounts())['c-events'], 0);
  await api.hideMessage(sent.id, true);
  api.setViewer('participant');
  assert.ok(!(await api.listMessages('c-events')).some((m) => m.id === sent.id), 'hidden post is gone for other members');
  api.setViewer('newmember');
  assert.ok((await api.listMessages('c-events')).some((m) => m.id === sent.id), 'author still sees own hidden post');
  api.setViewer('board');
  await assert.rejects(api.hideMessage(sent.id, false), /not_allowed/);
  await assert.rejects(api.reportMessage('m1', 'test'), /not_allowed/);
  api.setViewer('participant');
  await api.reportMessage('m1', 'test');
  api.setViewer('coach');
  const reports = await api.listOpenReports();
  assert.ok(reports.some((r) => r.messageId === 'm1'));
  api.setViewer('admin');
  const members = await api.listMembers();
  assert.ok(members.allowlist.length >= 5);
  await api.addMember('new@example.org', 'participant', 'Test');
  assert.ok((await api.listMembers()).allowlist.some((a) => a.email === 'new@example.org'));
  api.setViewer('participant');
  await assert.rejects(api.listMembers(), /not_allowed/);
});

test('demo sign-in flow uses the sample code', async () => {
  const api = createDemoApi({ now: () => NOW, viewerRole: 'participant' });
  api.setViewer('signed-out');
  await api.requestCode('someone@example.org');
  await assert.rejects(api.verifyCode('someone@example.org', '000000'), /invalid/);
  const s = await api.verifyCode('someone@example.org', '123 456');
  assert.ok(s.userId);
});

