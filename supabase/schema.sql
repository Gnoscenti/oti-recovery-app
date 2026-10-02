-- ============================================================================
-- OTI Community: message board for Over the Influence Recovery
-- Schema, authorization (Row Level Security), moderation, and unread support.
--
-- Runs on Supabase (Postgres 15+). Safe to re-run: every statement is
-- idempotent (create if not exists / or replace / on conflict).
-- The same file is loaded by test/community-rls.test.mjs into an in-process
-- Postgres (PGlite) with a small shim for the auth schema, so every rule below
-- is covered by a test.
--
-- Authorization model (one sentence): a member has ONE role; each channel
-- grants a LEVEL (read < post < moderate) per role; every read/write is checked
-- server-side by RLS through can_access(). Admin manages membership but does
-- NOT gain read access to channels its role is not granted (Daily Affirmations
-- is participants + coach only, exactly as OTI asked).
-- ============================================================================

-- ---------- enums -----------------------------------------------------------
do $$ begin
  create type public.member_role as enum ('none', 'participant', 'coach', 'board', 'admin');
exception when duplicate_object then null; end $$;

-- Order matters: Postgres compares enum values by declaration order, so
-- 'moderate' >= 'post' >= 'read'.
do $$ begin
  create type public.access_level as enum ('read', 'post', 'moderate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status as enum ('active', 'removed');
exception when duplicate_object then null; end $$;

-- ---------- tables ----------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  role public.member_role not null default 'none',
  status public.member_status not null default 'active',
  accepted_guidelines_at timestamptz,
  created_at timestamptz not null default now()
);

-- Who may join, and as what. Added by an admin BEFORE (or after) the person
-- signs in with their email. Without a row here a sign-in yields role 'none'
-- and no channel is visible.
create table if not exists public.member_allowlist (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  role public.member_role not null check (role <> 'none'),
  note text check (char_length(note) <= 120),
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  redeemed_by uuid references public.profiles (id) on delete set null,
  redeemed_at timestamptz
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null check (char_length(name) between 2 and 40),
  description text not null default '' check (char_length(description) <= 200),
  -- Daily Affirmations: show the newest moderator (coach) post pinned at the top.
  pin_moderator_latest boolean not null default false,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

-- The visibility matrix. No row = no access.
create table if not exists public.channel_access (
  channel_id uuid not null references public.channels (id) on delete cascade,
  role public.member_role not null check (role <> 'none'),
  level public.access_level not null,
  primary key (channel_id, role)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  author_name text not null default '',            -- denormalized; kept in sync by trigger
  author_role public.member_role not null default 'none',  -- role at posting time (for the "Coach" badge / pinned affirmation)
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  hidden_at timestamptz,                             -- moderator hide (reversible; author still sees it)
  hidden_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz                             -- soft delete (author or moderator); invisible to all
);
alter table public.messages add column if not exists author_role public.member_role not null default 'none';
create index if not exists messages_channel_created_idx on public.messages (channel_id, created_at desc);
create index if not exists messages_author_created_idx on public.messages (author_id, created_at desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 300),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  unique (message_id, reporter_id)
);

create table if not exists public.read_marks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- ---------- authorization helpers ------------------------------------------
-- security definer + fixed search_path: these read profiles/channel_access
-- regardless of the caller's own RLS, and only answer yes/no questions.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.my_level(ch uuid)
returns public.access_level language sql stable security definer set search_path = public as $$
  select ca.level
  from profiles p
  join channel_access ca on ca.role = p.role and ca.channel_id = ch
  where p.id = auth.uid() and p.status = 'active';
$$;

create or replace function public.can_access(ch uuid, needed public.access_level)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_level(ch) >= needed, false);
$$;

create or replace function public.guidelines_accepted()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and accepted_guidelines_at is not null
  );
$$;

-- ---------- triggers: membership ------------------------------------------

-- New sign-in → profile. Role comes from the allowlist; otherwise 'none'.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  a public.member_allowlist%rowtype;
begin
  select * into a from member_allowlist where email = lower(btrim(new.email));
  insert into profiles (id, role)
  values (new.id, coalesce(a.role, 'none'))
  on conflict (id) do nothing;
  if a.email is not null then
    update member_allowlist set redeemed_by = new.id, redeemed_at = now() where email = a.email;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Allowlisting an email that already signed in → apply the role right away.
create or replace function public.handle_allowlist_change()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid;
begin
  new.email := lower(btrim(new.email));
  select id into uid from auth.users where lower(email) = new.email limit 1;
  if uid is not null then
    update profiles set role = new.role, status = 'active' where id = uid;
    new.redeemed_by := uid;
    new.redeemed_at := coalesce(new.redeemed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists on_allowlist_change on public.member_allowlist;
create trigger on_allowlist_change
  before insert or update of role on public.member_allowlist
  for each row execute function public.handle_allowlist_change();

-- Members may edit their own name and accept the guidelines; only admins may
-- change role or status. (Service role / migrations have auth.uid() = null and pass.)
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  new.display_name := btrim(new.display_name);
  if (new.role <> old.role or new.status <> old.status) and not public.is_admin() then
    raise exception 'not_allowed: only an admin can change role or status' using errcode = '42501';
  end if;
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'not_allowed: immutable columns' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Keep author names in sync; anonymize a removed member's posts.
create or replace function public.profiles_after_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Transaction-local flag so messages_before_update lets this sync through.
  perform set_config('oti.sync_author_name', 'on', true);
  if new.status = 'removed' and old.status <> 'removed' then
    update messages set author_name = 'Former member' where author_id = new.id;
  elsif new.display_name <> old.display_name and new.status = 'active' then
    update messages set author_name = new.display_name where author_id = new.id;
  end if;
  perform set_config('oti.sync_author_name', 'off', true);
  return new;
end;
$$;

drop trigger if exists profiles_after_update on public.profiles;
create trigger profiles_after_update after update on public.profiles
  for each row execute function public.profiles_after_update();

-- ---------- triggers: messages --------------------------------------------

create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  name text;
  arole public.member_role;
  recent int;
  today int;
begin
  select display_name, role into name, arole from profiles where id = new.author_id;
  if name is null or name = '' then
    raise exception 'name_required: set a display name before posting' using errcode = '23514';
  end if;
  new.author_name := name;
  new.author_role := arole;
  new.body := btrim(new.body);
  new.created_at := now();
  new.edited_at := null; new.hidden_at := null; new.hidden_by := null; new.deleted_at := null;

  -- Rate limits: one post per 5 seconds, 200 per day.
  select count(*) into recent from messages
    where author_id = new.author_id and created_at > now() - interval '5 seconds';
  if recent > 0 then
    raise exception 'slow_down: please wait a few seconds between posts' using errcode = '23514';
  end if;
  select count(*) into today from messages
    where author_id = new.author_id and created_at > now() - interval '1 day';
  if today >= 200 then
    raise exception 'daily_limit: daily posting limit reached' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

-- What each actor may change on an existing message:
--   author:    body (within 15 minutes; sets edited_at), deleted_at (own delete)
--   moderator: hidden_at/hidden_by (hide or unhide), deleted_at
--   nobody:    id, channel_id, author_id, author_name, created_at
create or replace function public.messages_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  is_author boolean;
  is_mod boolean;
begin
  if me is null then return new; end if;  -- service role / maintenance
  if current_setting('oti.sync_author_name', true) = 'on' then return new; end if;  -- profile sync
  is_author := (old.author_id = me);
  is_mod := public.can_access(old.channel_id, 'moderate');

  if new.id <> old.id or new.channel_id <> old.channel_id or new.author_id <> old.author_id
     or new.author_name <> old.author_name or new.author_role <> old.author_role or new.created_at <> old.created_at then
    raise exception 'not_allowed: immutable columns' using errcode = '42501';
  end if;

  if new.body <> old.body then
    if not is_author then
      raise exception 'not_allowed: only the author can edit the text' using errcode = '42501';
    end if;
    if old.created_at < now() - interval '15 minutes' then
      raise exception 'edit_window_closed: messages can be edited for 15 minutes' using errcode = '42501';
    end if;
    new.body := btrim(new.body);
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;

  if new.hidden_at is distinct from old.hidden_at or new.hidden_by is distinct from old.hidden_by then
    if not is_mod then
      raise exception 'not_allowed: only a moderator can hide or unhide' using errcode = '42501';
    end if;
    if new.hidden_at is not null then new.hidden_at := coalesce(old.hidden_at, now()); new.hidden_by := me;
    else new.hidden_by := null; end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if old.deleted_at is not null then
      raise exception 'not_allowed: deleted messages cannot be restored' using errcode = '42501';
    end if;
    if not (is_author or is_mod) then
      raise exception 'not_allowed: only the author or a moderator can delete' using errcode = '42501';
    end if;
    new.deleted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_before_update on public.messages;
create trigger messages_before_update before update on public.messages
  for each row execute function public.messages_before_update();

-- ---------- RPC: moderation actions ---------------------------------------
-- Hide/unhide and delete go through these functions (not direct UPDATEs) so
-- the authorization check lives in one place; the messages_before_update
-- trigger re-validates the same rules as a second line of defense.
-- One error message for "not found" and "not allowed" so ids cannot be probed.

create or replace function public.hide_message(mid uuid, hide boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into m from messages where id = mid and deleted_at is null;
  if not found or not public.can_access(m.channel_id, 'moderate') then
    raise exception 'not_allowed: only a moderator of this topic can hide or unhide' using errcode = '42501';
  end if;
  if hide then
    update messages set hidden_at = coalesce(hidden_at, now()), hidden_by = auth.uid() where id = mid;
  else
    update messages set hidden_at = null, hidden_by = null where id = mid;
  end if;
end;
$$;

create or replace function public.delete_message(mid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.messages%rowtype;
begin
  if auth.uid() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into m from messages where id = mid and deleted_at is null;
  if not found or not (m.author_id = auth.uid() or public.can_access(m.channel_id, 'moderate')) then
    raise exception 'not_allowed: only the author or a moderator can delete' using errcode = '42501';
  end if;
  update messages set deleted_at = now() where id = mid;
end;
$$;

create or replace function public.resolve_report(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  r public.reports%rowtype;
begin
  if auth.uid() is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into r from reports where id = rid;
  if not found or not exists (select 1 from messages m where m.id = r.message_id and public.can_access(m.channel_id, 'moderate')) then
    raise exception 'not_allowed: only a moderator of this topic can resolve reports' using errcode = '42501';
  end if;
  update reports set resolved_at = now(), resolved_by = auth.uid() where id = rid;
end;
$$;

-- ---------- RPC: unread counts & read marks --------------------------------
-- security INVOKER on purpose: the caller's RLS decides which messages count.

create or replace function public.mark_read(ch uuid)
returns void language sql volatile as $$
  insert into public.read_marks (user_id, channel_id, last_read_at)
  values (auth.uid(), ch, now())
  on conflict (user_id, channel_id) do update set last_read_at = now();
$$;

create or replace function public.unread_counts()
returns table (channel_id uuid, unread bigint) language sql stable as $$
  select c.id, count(m.id)
  from public.channels c
  left join public.read_marks r on r.channel_id = c.id and r.user_id = auth.uid()
  left join public.messages m on m.channel_id = c.id
       and m.author_id <> auth.uid()
       and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  group by c.id;
$$;

-- ---------- Row Level Security -------------------------------------------
alter table public.profiles         enable row level security;
alter table public.member_allowlist enable row level security;
alter table public.channels         enable row level security;
alter table public.channel_access   enable row level security;
alter table public.messages         enable row level security;
alter table public.reports          enable row level security;
alter table public.read_marks       enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- member_allowlist: admins only
drop policy if exists allowlist_admin on public.member_allowlist;
create policy allowlist_admin on public.member_allowlist for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- channels: visible only if your role has a level in it. Admin is NOT special
-- here: Daily Affirmations does not even appear for an admin. Channels and the
-- matrix are managed with supabase/seed.sql, not from the app.
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
  using (public.can_access(id, 'read'));
drop policy if exists channels_admin_write on public.channels;

-- channel_access: members can see who else can see a channel they are in
drop policy if exists channel_access_select on public.channel_access;
create policy channel_access_select on public.channel_access for select to authenticated
  using (public.can_access(channel_id, 'read'));
drop policy if exists channel_access_admin_write on public.channel_access;

-- messages (members edit their own text directly; hide/delete go through the RPCs above)
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (
    deleted_at is null
    and public.can_access(channel_id, 'read')
    and (hidden_at is null or author_id = auth.uid() or public.can_access(channel_id, 'moderate'))
  );
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_access(channel_id, 'post')
    and public.guidelines_accepted()
  );
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (deleted_at is null and author_id = auth.uid() and public.can_access(channel_id, 'read'))
  with check (author_id = auth.uid());
-- (no delete policy: rows are never hard-deleted by members)

-- reports
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_id and public.can_access(m.channel_id, 'read'))
  );
drop policy if exists reports_select on public.reports;
create policy reports_select on public.reports for select to authenticated
  using (
    reporter_id = auth.uid()
    or exists (select 1 from public.messages m where m.id = message_id and public.can_access(m.channel_id, 'moderate'))
  );
-- (resolving goes through resolve_report())

-- read_marks: your own only
drop policy if exists read_marks_own on public.read_marks;
create policy read_marks_own on public.read_marks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- grants ---------------------------------------------------------
-- Explicit and minimal. anon (signed-out) gets nothing at all.
revoke all on all tables in schema public from anon;
-- Functions are executable by PUBLIC by default in Postgres; take that away.
revoke all on all functions in schema public from public, anon;

grant usage on schema public to authenticated;
grant select, update (display_name, accepted_guidelines_at, role, status) on public.profiles to authenticated;
grant select, insert, update, delete on public.member_allowlist to authenticated;
grant select on public.channels to authenticated;
grant select on public.channel_access to authenticated;
grant select, insert, update (body) on public.messages to authenticated;
grant select, insert on public.reports to authenticated;
grant select, insert, update, delete on public.read_marks to authenticated;
grant execute on function public.is_admin(), public.my_level(uuid), public.can_access(uuid, public.access_level),
  public.guidelines_accepted(), public.mark_read(uuid), public.unread_counts(),
  public.hide_message(uuid, boolean), public.delete_message(uuid), public.resolve_report(uuid) to authenticated;

-- ---------- realtime -------------------------------------------------------
-- Realtime "postgres_changes" honors RLS, so members only receive events for
-- channels they can read.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
