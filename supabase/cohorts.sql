-- Apply AFTER schema.sql and seed.sql. Existing unscoped topics are retained
-- for a deliberate owner migration, but become inaccessible (fail closed).
begin;
create schema if not exists oti_private;
revoke all on schema oti_private from public;
grant usage on schema oti_private to authenticated;
create table if not exists public.cohorts (
 id uuid primary key default gen_random_uuid(),
 name text not null check (char_length(btrim(name)) between 2 and 80),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 check (ends_at > starts_at)
);
create table if not exists public.cohort_members (
 cohort_id uuid references public.cohorts(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 primary key(cohort_id,user_id)
);
alter table public.channels add column if not exists cohort_id uuid references public.cohorts(id);
alter table public.channels drop constraint if exists channels_slug_key;
create unique index if not exists channels_cohort_slug on public.channels(cohort_id,slug);
create or replace function oti_private.staff() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and status='active' and role in ('admin','coach'));
$$;
create or replace function oti_private.member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cohort_members m join public.profiles p on p.id=m.user_id
 join public.cohorts c on c.id=m.cohort_id where m.cohort_id=cid and m.user_id=auth.uid()
 and p.status='active' and p.role in ('participant','coach') and c.starts_at<=now() and c.ends_at>now());
$$;
create or replace function oti_private.manage(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select oti_private.staff() and exists(select 1 from public.cohorts where id=cid and starts_at<=now() and ends_at>now());
$$;
-- Overrides all existing message, moderation, unread and realtime predicates.
create or replace function public.my_level(ch uuid) returns public.access_level language sql stable security definer set search_path='' as $$
 select ca.level from public.profiles p join public.channel_access ca on ca.role=p.role
 join public.channels c on c.id=ca.channel_id where c.id=ch and p.id=auth.uid() and p.status='active'
 and oti_private.member(c.cohort_id);
$$;
create table if not exists public.cohort_events (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.cohorts(id),
 title text not null check(char_length(btrim(title)) between 2 and 120),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 location text not null default '' check(char_length(location)<=200),
 check(ends_at>starts_at)
);
create table if not exists public.cohort_activities (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.cohorts(id),
 title text not null check(char_length(btrim(title)) between 2 and 120),
 body text not null check(char_length(btrim(body)) between 1 and 2000)
);
create table if not exists public.event_rsvps (
 event_id uuid references public.cohort_events(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 status text not null check(status in ('going','maybe','declined')),
 primary key(event_id,user_id)
);
create table if not exists public.event_deliveries (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.cohort_events(id) on delete cascade,
 recipient_id uuid not null references public.profiles(id) on delete cascade,
 sender_id uuid not null references public.profiles(id),
 body text not null check(char_length(btrim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);
create or replace function oti_private.event_access(eid uuid, management boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cohort_events e where e.id=eid and
 (case when management then oti_private.manage(e.cohort_id) else oti_private.member(e.cohort_id) or oti_private.manage(e.cohort_id) end));
$$;
alter table public.cohorts enable row level security;
alter table public.cohort_members enable row level security;
alter table public.cohort_events enable row level security;
alter table public.cohort_activities enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.event_deliveries enable row level security;
create policy cohort_read on public.cohorts for select to authenticated using(oti_private.member(id) or oti_private.staff());
create policy cohort_write on public.cohorts for all to authenticated using(oti_private.staff()) with check(oti_private.staff());
create policy membership_read on public.cohort_members for select to authenticated using((user_id=auth.uid() and oti_private.member(cohort_id)) or oti_private.staff());
create policy membership_write on public.cohort_members for all to authenticated using(oti_private.staff()) with check(oti_private.staff());
create policy event_read on public.cohort_events for select to authenticated using(oti_private.member(cohort_id) or oti_private.manage(cohort_id));
create policy event_create on public.cohort_events for insert to authenticated with check(oti_private.manage(cohort_id));
create policy activity_read on public.cohort_activities for select to authenticated using(oti_private.member(cohort_id) or oti_private.manage(cohort_id));
create policy activity_create on public.cohort_activities for insert to authenticated with check(oti_private.manage(cohort_id));
create policy rsvp_read on public.event_rsvps for select to authenticated using(oti_private.event_access(event_id,true) or (user_id=auth.uid() and oti_private.event_access(event_id)));
create policy rsvp_insert on public.event_rsvps for insert to authenticated with check(user_id=auth.uid() and oti_private.event_access(event_id) and exists(select 1 from public.cohort_events e where e.id=event_id and oti_private.member(e.cohort_id)));
create policy rsvp_update on public.event_rsvps for update to authenticated using(user_id=auth.uid() and exists(select 1 from public.cohort_events e where e.id=event_id and oti_private.member(e.cohort_id))) with check(user_id=auth.uid() and exists(select 1 from public.cohort_events e where e.id=event_id and oti_private.member(e.cohort_id)));
create policy delivery_read on public.event_deliveries for select to authenticated using(oti_private.event_access(event_id) and (recipient_id=auth.uid() or (sender_id=auth.uid() and oti_private.event_access(event_id,true))));
-- Coaches can select existing participant/coach IDs for assignment, never
-- promote themselves or edit global roles. Membership is assigned explicitly.
create policy coach_roster on public.profiles for select to authenticated using(oti_private.staff() and role in ('participant','coach'));
create or replace function public.create_cohort(cname text, begins timestamptz, finishes timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid; ch uuid;
begin
 if not oti_private.staff() then raise exception 'not_allowed' using errcode='42501'; end if;
 insert into public.cohorts(name,starts_at,ends_at) values(cname,begins,finishes) returning id into cid;
 insert into public.cohort_members values(cid,auth.uid());
 insert into public.channels(cohort_id,slug,name,description,sort_order) values(cid,'events','Events','Private cohort event discussion.',10) returning id into ch;
 insert into public.channel_access values(ch,'participant','post'),(ch,'coach','moderate');
 insert into public.channels(cohort_id,slug,name,description,pin_moderator_latest,sort_order) values(cid,'affirmations','Daily Affirmations','Coach posts; daily cadence awaiting content-source approval.',true,20) returning id into ch;
 insert into public.channel_access values(ch,'participant','post'),(ch,'coach','moderate');
 return cid;
end; $$;
create or replace function public.message_event_rsvp(eid uuid, target_status text, message_body text) returns integer language plpgsql security definer set search_path='' as $$
declare cid uuid; sent integer;
begin
 select cohort_id into cid from public.cohort_events where id=eid;
 if not oti_private.manage(cid) then raise exception 'not_allowed' using errcode='42501'; end if;
 if target_status not in ('going','maybe','declined','no-response') or target_status is null then raise exception 'invalid RSVP status'; end if;
 if message_body is null or char_length(btrim(message_body)) not between 1 and 2000 then raise exception 'invalid message'; end if;
 -- Resolve recipients server-side in the same transaction. No supplied IDs,
 -- mailing list, addresses, or external sends. Only active current participants.
 insert into public.event_deliveries(event_id,recipient_id,sender_id,body)
 select eid,m.user_id,auth.uid(),btrim(message_body) from public.cohort_members m
 join public.profiles p on p.id=m.user_id
 left join public.event_rsvps r on r.user_id=m.user_id and r.event_id=eid
 where m.cohort_id=cid and p.role='participant' and p.status='active'
 and coalesce(r.status,'no-response')=target_status;
 get diagnostics sent=row_count; return sent;
end; $$;
-- Former members cannot use the legacy owner-delete RPC to bypass cohort access.
create or replace function public.delete_message(mid uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.messages%rowtype;
begin
 select * into m from public.messages where id=mid and deleted_at is null;
 if not found or not public.can_access(m.channel_id,'read') or not (m.author_id=auth.uid() or public.can_access(m.channel_id,'moderate')) then
 raise exception 'not_allowed' using errcode='42501'; end if;
 update public.messages set deleted_at=now() where id=mid;
end; $$;
revoke all on public.cohorts,public.cohort_members,public.cohort_events,public.cohort_activities,public.event_rsvps,public.event_deliveries from anon,authenticated;
grant select,insert,update,delete on public.cohorts,public.cohort_members to authenticated;
grant select,insert on public.cohort_events,public.cohort_activities to authenticated;
grant select,insert,update(status) on public.event_rsvps to authenticated;
grant select on public.event_deliveries to authenticated;
revoke all on all functions in schema oti_private from public,anon;
grant execute on all functions in schema oti_private to authenticated;
revoke all on function public.create_cohort(text,timestamptz,timestamptz),public.message_event_rsvp(uuid,text,text) from public,anon;
grant execute on function public.create_cohort(text,timestamptz,timestamptz),public.message_event_rsvp(uuid,text,text) to authenticated;
commit;
