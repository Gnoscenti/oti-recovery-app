// Authorization tests for the OTI Community schema, run against a real Postgres
// (PGlite, in-process) with a small shim for Supabase's auth schema.
// Every rule in supabase/schema.sql that decides who can see or do what is
// exercised here as the roles OTI defined: participant, coach (Gigi), board,
// admin (Julie), a signed-in person who was never allowlisted, and anonymous.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite();

// Minimal stand-in for what Supabase provides out of the box.
const SHIM = `
  create schema auth;
  create table auth.users (id uuid primary key, email text unique, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub')::uuid
  $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create publication supabase_realtime;
`;

/** @type {Record<string, {id:string, email:string}>} */
const users = {};
/** @type {Record<string, string>} */
const ch = {};

/** Act as a signed-in member (RLS applies) or as anonymous. */
async function as(who) {
  await db.exec('reset role');
  if (!who) {
    await db.query("select set_config('request.jwt.claims', '', false)");
    await db.exec('set role anon');
  } else {
    await db.query('select set_config($1, $2, false)', ['request.jwt.claims', JSON.stringify({ sub: users[who].id, role: 'authenticated' })]);
    await db.exec('set role authenticated');
  }
}
/** Act as the database owner (migrations / service role): no RLS, no auth.uid(). */
async function asService() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims', '', false)");
}
async function signUp(name, email) {
  await asService();
  const r = await db.query('insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id', [email]);
  users[name] = { id: r.rows[0].id, email };
}
async function allowlist(email, role) {
  await asService();
  await db.query('insert into public.member_allowlist (email, role) values ($1, $2) on conflict (email) do update set role = excluded.role', [email, role]);
}
async function setName(who, name) {
  await as(who);
  await db.query('update public.profiles set display_name = $1, accepted_guidelines_at = now() where id = $2', [name, users[who].id]);
}
/** Post as a member. Backdates the row 10s afterwards so the 5-second rate limit does not trip the next test post. */
async function post(who, channel, body, { keepTime = false } = {}) {
  await as(who);
  const r = await db.query('insert into public.messages (channel_id, author_id, body) values ($1, $2, $3) returning id', [ch[channel], users[who].id, body]);
  if (!keepTime) await backdate(r.rows[0].id, 10);
  return r.rows[0].id;
}
async function backdate(messageId, seconds) {
  await asService();
  await db.query(`update public.messages set created_at = created_at - make_interval(secs => $2) where id = $1`, [messageId, seconds]);
}
async function bodies(who, channel) {
  await as(who);
  const r = await db.query('select body from public.messages where channel_id = $1 order by created_at', [ch[channel]]);
  return r.rows.map((x) => x.body);
}
async function channelSlugs(who) {
  await as(who);
  const r = await db.query('select slug from public.channels order by sort_order');
  return r.rows.map((x) => x.slug);
}

before(async () => {
  await db.exec(SHIM);
  await db.exec(await readFile(path.join(root, 'supabase', 'schema.sql'), 'utf8'));
  await db.exec(await readFile(path.join(root, 'supabase', 'seed.sql'), 'utf8'));
  const rows = (await db.query('select id, slug from public.channels')).rows;
  for (const r of rows) ch[r.slug] = r.id;

  // Julie (admin) and Gigi (coach) are allowlisted before they sign in.
  await allowlist('Julie@Example.org', 'admin');
  await allowlist('gigi@example.org', 'coach');
  await signUp('julie', 'julie@example.org');
  await signUp('gigi', 'gigi@example.org');
  // Members are added by the admin through the app.
  await as('julie');
  for (const [email, role] of [['bea@example.org', 'board'], ['pam@example.org', 'participant'], ['pat@example.org', 'participant'], ['rae@example.org', 'participant']]) {
    await db.query('insert into public.member_allowlist (email, role) values ($1, $2)', [email, role]);
  }
  await signUp('bea', 'bea@example.org');
  await signUp('pam', 'pam@example.org');
  await signUp('pat', 'pat@example.org');
  await signUp('rae', 'rae@example.org');
  // Nora signs in but was never added.
  await signUp('nora', 'nora@example.org');
  for (const [who, name] of [['julie', 'Julie'], ['gigi', 'Gigi'], ['bea', 'Bea'], ['pam', 'Pam'], ['pat', 'Pat'], ['rae', 'Rae'], ['nora', 'Nora']]) await setName(who, name);
});

test('seed: the two topics and the exact visibility matrix', async () => {
  await asService();
  const m = (await db.query(`select c.slug, a.role, a.level from public.channel_access a join public.channels c on c.id = a.channel_id order by 1, 2`)).rows;
  assert.deepEqual(m.map((r) => `${r.slug}:${r.role}=${r.level}`).sort(), [
    'affirmations:coach=moderate', 'affirmations:participant=post',
    'events:admin=moderate', 'events:board=post', 'events:coach=moderate', 'events:participant=post',
  ]);
});

test('sign-in creates a profile with the allowlisted role, case-insensitively', async () => {
  await asService();
  const r = (await db.query('select p.role, u.email from public.profiles p join auth.users u on u.id = p.id order by u.email')).rows;
  assert.deepEqual(Object.fromEntries(r.map((x) => [x.email, x.role])), {
    'bea@example.org': 'board', 'gigi@example.org': 'coach', 'julie@example.org': 'admin',
    'nora@example.org': 'none', 'pam@example.org': 'participant', 'pat@example.org': 'participant', 'rae@example.org': 'participant',
  });
  const redeemed = (await db.query("select redeemed_by is not null as ok from public.member_allowlist where email = 'julie@example.org'")).rows[0].ok;
  assert.equal(redeemed, true);
});

test('channel visibility: participants see both; board sees Events only; coach sees both; admin sees Events only; others nothing', async () => {
  assert.deepEqual(await channelSlugs('pam'), ['events', 'affirmations']);
  assert.deepEqual(await channelSlugs('bea'), ['events']);
  assert.deepEqual(await channelSlugs('gigi'), ['events', 'affirmations']);
  assert.deepEqual(await channelSlugs('julie'), ['events']);
  assert.deepEqual(await channelSlugs('nora'), []);
  await assert.rejects(channelSlugs(null), /permission denied/);
});

test('anonymous and un-allowlisted users cannot read anything', async () => {
  for (const who of [null, 'nora']) {
    await as(who);
    for (const table of ['messages', 'channels', 'channel_access', 'member_allowlist', 'reports', 'read_marks']) {
      if (who === null) await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
      else assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, table);
    }
  }
});

test('posting: participants post in both; board only in Events; admin cannot post in Affirmations; Nora nowhere', async () => {
  await post('pam', 'events', 'Who is going to the ferry ride Saturday?');
  await post('pam', 'affirmations', 'Today I choose progress over perfection.');
  await post('bea', 'events', 'Board here: parking at KPBS is free after 6.');
  await post('gigi', 'affirmations', 'You are allowed to take up space.');
  await post('julie', 'events', 'Tickets for Here to Thrive are live.');
  await assert.rejects(post('bea', 'affirmations', 'x'), /row-level security/);
  await assert.rejects(post('julie', 'affirmations', 'x'), /row-level security/);
  await assert.rejects(post('nora', 'events', 'x'), /row-level security/);
  await assert.rejects(async () => { await as(null); await db.query('insert into public.messages (channel_id, author_id, body) values ($1, $2, $3)', [ch.events, users.pam.id, 'x']); }, /permission denied/);
});

test('posting requires a display name and accepting the community guidelines', async () => {
  await allowlist('quinn@example.org', 'participant');
  await signUp('quinn', 'quinn@example.org');
  await as('quinn');
  await db.query('update public.profiles set accepted_guidelines_at = now() where id = $1', [users.quinn.id]);
  await assert.rejects(post('quinn', 'events', 'hi'), /name_required/);           // no name yet
  await db.query("update public.profiles set display_name = 'Quinn', accepted_guidelines_at = null where id = $1", [users.quinn.id]);
  await assert.rejects(post('quinn', 'events', 'hi'), /row-level security/);     // name, but guidelines not accepted
  await setName('quinn', 'Quinn');
  await post('quinn', 'events', 'hi from Quinn');
});

test('nobody can post as someone else', async () => {
  await as('pam');
  await assert.rejects(db.query('insert into public.messages (channel_id, author_id, body) values ($1, $2, $3)', [ch.events, users.pat.id, 'impersonation']), /row-level security/);
});

test('rate limit: one post per 5 seconds per member, across channels', async () => {
  const id = await post('pat', 'events', 'first', { keepTime: true });
  await assert.rejects(post('pat', 'events', 'second right away'), /slow_down/);
  await assert.rejects(post('pat', 'affirmations', 'other channel right away'), /slow_down/);
  await backdate(id, 10);
  await post('pat', 'events', 'second after waiting');
});

test('message visibility: Affirmations are invisible to board and admin; everyone in a channel sees the same list', async () => {
  const aff = await bodies('pam', 'affirmations');
  assert.deepEqual(aff, ['Today I choose progress over perfection.', 'You are allowed to take up space.']);
  assert.deepEqual(await bodies('gigi', 'affirmations'), aff);
  assert.deepEqual(await bodies('bea', 'affirmations'), []);
  assert.deepEqual(await bodies('julie', 'affirmations'), []);
  assert.deepEqual(await bodies('nora', 'affirmations'), []);
  assert.ok((await bodies('bea', 'events')).includes('Who is going to the ferry ride Saturday?'));
  assert.ok((await bodies('julie', 'events')).includes('Board here: parking at KPBS is free after 6.'));
});

test('author_name and author_role come from the profile; the name follows renames', async () => {
  await as('pam');
  const row = (await db.query("select author_name, author_role from public.messages where body like 'Who is going%'")).rows[0];
  assert.equal(row.author_name, 'Pam');
  assert.equal(row.author_role, 'participant');
  await as('gigi');
  assert.equal((await db.query("select author_role from public.messages where body like 'You are allowed%'")).rows[0].author_role, 'coach');
  await as('pam');
  const before = row.author_name;
  await db.query("update public.profiles set display_name = 'Pam R.' where id = $1", [users.pam.id]);
  const after = (await db.query("select author_name from public.messages where body like 'Who is going%'")).rows[0].author_name;
  assert.equal(after, 'Pam R.');
});

test('members cannot change their own role or status; admins can', async () => {
  await as('pam');
  await assert.rejects(db.query("update public.profiles set role = 'admin' where id = $1", [users.pam.id]), /only an admin/);
  await as('bea');
  // Board cannot even see other profiles, so the update matches no rows.
  const r = await db.query("update public.profiles set role = 'board' where id = $1 returning id", [users.pam.id]);
  assert.equal(r.rows.length, 0);
  await as('julie');
  await db.query("update public.profiles set role = 'board' where id = $1", [users.pat.id]);
  assert.deepEqual(await channelSlugs('pat'), ['events']);
  await as('julie');
  await db.query("update public.profiles set role = 'participant' where id = $1", [users.pat.id]);
});

test('moderation: coach hides an affirmation; hidden post is visible only to its author and moderators', async () => {
  const id = await post('pat', 'affirmations', 'Something off-topic and unkind.');
  for (const who of ['bea', 'pam', 'pat', 'julie']) {
    await as(who);
    await assert.rejects(db.query('select public.hide_message($1, true)', [id]), /not_allowed/, `${who} cannot hide`);
    await assert.rejects(db.query('update public.messages set hidden_at = now() where id = $1', [id]), /permission denied/, `${who} cannot hide by direct update`);
  }
  await as(null);
  await assert.rejects(db.query('select public.hide_message($1, true)', [id]), /permission denied/);
  await as('gigi');
  await db.query('select public.hide_message($1, true)', [id]);
  const hidden = (await db.query('select hidden_by from public.messages where id = $1', [id])).rows[0];
  assert.equal(hidden.hidden_by, users.gigi.id);
  assert.ok(!(await bodies('pam', 'affirmations')).includes('Something off-topic and unkind.'), 'other members no longer see it');
  assert.ok((await bodies('pat', 'affirmations')).includes('Something off-topic and unkind.'), 'author still sees it');
  assert.ok((await bodies('gigi', 'affirmations')).includes('Something off-topic and unkind.'), 'moderator still sees it');
  await as('gigi');
  await db.query('select public.hide_message($1, false)', [id]);
  assert.ok((await bodies('pam', 'affirmations')).includes('Something off-topic and unkind.'), 'unhide restores it');
});

test('admin moderates Events but cannot touch Affirmations', async () => {
  await as('julie');
  const evId = (await db.query("select id from public.messages where body = 'hi from Quinn'")).rows[0].id;
  await db.query('select public.hide_message($1, true)', [evId]);
  assert.ok(!(await bodies('pam', 'events')).includes('hi from Quinn'));
  await as('julie');
  await db.query('select public.hide_message($1, false)', [evId]);
  await as('gigi');
  const affId = (await db.query("select id from public.messages where body like 'Today I choose%'")).rows[0].id;
  await as('julie');
  await assert.rejects(db.query('select public.hide_message($1, true)', [affId]), /not_allowed/);
  await assert.rejects(db.query('select public.delete_message($1)', [affId]), /not_allowed/);
});

test('editing: author within 15 minutes only; immutable columns stay immutable', async () => {
  const id = await post('pam', 'events', 'Typo hree');
  await as('pat');
  assert.equal((await db.query("update public.messages set body = 'hijack' where id = $1 returning id", [id])).rows.length, 0);
  await as('gigi');
  assert.equal((await db.query("update public.messages set body = 'mod rewrite' where id = $1 returning id", [id])).rows.length, 0, 'moderators cannot rewrite text');
  await as('pam');
  const edited = (await db.query("update public.messages set body = 'Typo here' where id = $1 returning edited_at", [id])).rows[0];
  assert.ok(edited.edited_at);
  await assert.rejects(db.query('update public.messages set channel_id = $2 where id = $1', [id, ch.affirmations]), /permission denied|immutable/);
  await assert.rejects(db.query('update public.messages set author_id = $2 where id = $1', [id, users.pat.id]), /permission denied|immutable/);
  await backdate(id, 20 * 60);
  await as('pam');
  await assert.rejects(db.query("update public.messages set body = 'too late' where id = $1", [id]), /edit_window_closed/);
});

test('deleting: author or moderator soft-deletes; deleted is gone for everyone and cannot be restored', async () => {
  const id = await post('pat', 'events', 'Delete me');
  await as('bea');
  await assert.rejects(db.query('select public.delete_message($1)', [id]), /not_allowed/, 'a non-author non-moderator cannot delete');
  await assert.rejects(db.query('update public.messages set deleted_at = now() where id = $1', [id]), /permission denied/);
  await as('pat');
  await db.query('select public.delete_message($1)', [id]);
  for (const who of ['pat', 'gigi', 'julie']) assert.ok(!(await bodies(who, 'events')).includes('Delete me'), who);
  await as('gigi');
  await assert.rejects(db.query('select public.delete_message($1)', [id]), /not_allowed/, 'already deleted');
  await assert.rejects(db.query('select public.hide_message($1, false)', [id]), /not_allowed/, 'cannot be restored');
  await as('pam');
  await assert.rejects(db.query('delete from public.messages where id = $1', [id]), /permission denied/);
  // A moderator can delete someone else's post.
  const id2 = await post('pam', 'events', 'Moderator will delete this');
  await as('julie');
  await db.query('select public.delete_message($1)', [id2]);
  assert.ok(!(await bodies('pam', 'events')).includes('Moderator will delete this'));
});

test('reports: any reader can report; moderators of that channel see and resolve; others do not', async () => {
  const id = await post('bea', 'events', 'Spammy link spam');
  await as('pam');
  await db.query("insert into public.reports (message_id, reporter_id, reason) values ($1, $2, 'spam')", [id, users.pam.id]);
  await assert.rejects(db.query("insert into public.reports (message_id, reporter_id, reason) values ($1, $2, 'x')", [id, users.pat.id]), /row-level security/);
  await as('bea');
  assert.equal((await db.query('select * from public.reports')).rows.length, 0, 'board is not a moderator');
  await as('pam');
  assert.equal((await db.query('select * from public.reports')).rows.length, 1, 'reporter sees own report');
  await as('julie');
  const rid = (await db.query('select id from public.reports where message_id = $1', [id])).rows[0].id;
  await db.query('select public.resolve_report($1)', [rid]);
  assert.ok((await db.query('select resolved_by from public.reports where id = $1', [rid])).rows[0].resolved_by === users.julie.id, 'admin moderates Events');
  await as('bea');
  await assert.rejects(db.query('select public.resolve_report($1)', [rid]), /not_allowed/);
  // An affirmation report is invisible to admin.
  const affId = (await (async () => { await as('gigi'); return (await db.query("select id from public.messages where body like 'You are allowed%'")).rows[0].id; })());
  await as('pam');
  await db.query("insert into public.reports (message_id, reporter_id, reason) values ($1, $2, 'test')", [affId, users.pam.id]);
  await as('julie');
  assert.equal((await db.query('select * from public.reports where message_id = $1', [affId])).rows.length, 0);
  await as('gigi');
  assert.equal((await db.query('select * from public.reports where message_id = $1', [affId])).rows.length, 1);
  const affRid = (await db.query('select id from public.reports where message_id = $1', [affId])).rows[0].id;
  await as('julie');
  await assert.rejects(db.query('select public.resolve_report($1)', [affRid]), /not_allowed/, 'admin cannot resolve an Affirmations report');
});

test('unread counts respect visibility and exclude your own posts; mark_read clears them', async () => {
  await as('bea');
  let counts = Object.fromEntries((await db.query('select * from public.unread_counts()')).rows.map((r) => [r.channel_id, Number(r.unread)]));
  assert.equal(Object.keys(counts).length, 1, 'board only gets a count for Events');
  const beaEventsBefore = counts[ch.events];
  assert.ok(beaEventsBefore >= 5);
  await db.query('select public.mark_read($1)', [ch.events]);
  counts = Object.fromEntries((await db.query('select * from public.unread_counts()')).rows.map((r) => [r.channel_id, Number(r.unread)]));
  assert.equal(counts[ch.events], 0);
  await post('pam', 'events', 'New since Bea last looked', { keepTime: true });
  await as('bea');
  counts = Object.fromEntries((await db.query('select * from public.unread_counts()')).rows.map((r) => [r.channel_id, Number(r.unread)]));
  assert.equal(counts[ch.events], 1);
  await as('pam');
  counts = Object.fromEntries((await db.query('select * from public.unread_counts()')).rows.map((r) => [r.channel_id, Number(r.unread)]));
  assert.ok(!(counts[ch.events] > 0 && (await db.query('select count(*)::int as n from public.messages where channel_id = $1 and author_id <> $2', [ch.events, users.pam.id])).rows[0].n < counts[ch.events]), 'own posts never count');
  await as('bea');
  await assert.rejects(db.query('insert into public.read_marks (user_id, channel_id) values ($1, $2)', [users.pam.id, ch.events]), /row-level security/);
});

test('removing a member revokes access immediately and anonymizes their posts', async () => {
  await post('rae', 'affirmations', 'Rae was here');
  await as('julie');
  await db.query("update public.profiles set status = 'removed' where id = $1", [users.rae.id]);
  assert.deepEqual(await channelSlugs('rae'), []);
  await assert.rejects(post('rae', 'events', 'x'), /row-level security/);
  await as('gigi');
  const row = (await db.query("select author_name from public.messages where body = 'Rae was here'")).rows[0];
  assert.equal(row.author_name, 'Former member');
});

test('allowlisting after sign-in grants the role at once', async () => {
  assert.deepEqual(await channelSlugs('nora'), []);
  await as('julie');
  await db.query("insert into public.member_allowlist (email, role) values ('NORA@example.org', 'participant')");
  assert.deepEqual(await channelSlugs('nora'), ['events', 'affirmations']);
  await as('julie');
  const a = (await db.query("select email, redeemed_by from public.member_allowlist where email = 'nora@example.org'")).rows[0];
  assert.equal(a.redeemed_by, users.nora.id);
});

test('allowlist is admin-only', async () => {
  for (const who of ['gigi', 'bea', 'pam', 'nora']) {
    await as(who);
    assert.equal((await db.query('select * from public.member_allowlist')).rows.length, 0, who);
    await assert.rejects(db.query("insert into public.member_allowlist (email, role) values ('x@example.org', 'participant')"), /row-level security/, who);
  }
  await as('julie');
  assert.ok((await db.query('select * from public.member_allowlist')).rows.length >= 8);
});

test('profiles: members see only themselves; admins see everyone', async () => {
  await as('pam');
  assert.equal((await db.query('select id from public.profiles')).rows.length, 1);
  await as('julie');
  assert.ok((await db.query('select id from public.profiles')).rows.length >= 8);
});

test('members can see who else has access to a channel they are in (transparency), and nothing more', async () => {
  await as('pam');
  const rows = (await db.query('select c.slug, a.role, a.level from public.channel_access a join public.channels c on c.id = a.channel_id order by 1,2')).rows;
  assert.equal(rows.length, 6);
  await as('bea');
  const boardRows = (await db.query('select c.slug from public.channel_access a join public.channels c on c.id = a.channel_id')).rows;
  assert.ok(boardRows.every((r) => r.slug === 'events'));
});

test('realtime publication carries messages (RLS still applies to subscribers)', async () => {
  await asService();
  const pub = (await db.query("select tablename from pg_publication_tables where pubname = 'supabase_realtime'")).rows.map((r) => r.tablename);
  assert.deepEqual(pub, ['messages']);
});

test('schema is idempotent: re-applying schema and seed changes nothing', async () => {
  await asService();
  const before = (await db.query('select count(*)::int as n from public.channel_access')).rows[0].n;
  await db.exec(await readFile(path.join(root, 'supabase', 'schema.sql'), 'utf8'));
  await db.exec(await readFile(path.join(root, 'supabase', 'seed.sql'), 'utf8'));
  const after = (await db.query('select count(*)::int as n from public.channel_access')).rows[0].n;
  assert.equal(after, before);
  assert.deepEqual(await channelSlugs('pam'), ['events', 'affirmations']);
});
