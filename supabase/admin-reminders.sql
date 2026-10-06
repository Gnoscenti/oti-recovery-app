-- Apply once after cohorts.sql. No live backend or external messages are activated by this file.
begin;
alter table public.cohort_events add column if not exists cancelled boolean not null default false;
drop policy if exists event_read on public.cohort_events;
create policy event_read on public.cohort_events for select to authenticated using((not cancelled and oti_private.member(cohort_id)) or oti_private.manage(cohort_id));
create policy event_update on public.cohort_events for update to authenticated using(oti_private.manage(cohort_id)) with check(oti_private.manage(cohort_id));
grant update(title,starts_at,ends_at,location,cancelled) on public.cohort_events to authenticated;
-- No RSVP, inbox or broadcasts can use a cancelled event.
create or replace function oti_private.event_access(eid uuid, management boolean default false) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.cohort_events e where e.id=eid and not e.cancelled and
 (case when management then oti_private.manage(e.cohort_id) else oti_private.member(e.cohort_id) or oti_private.manage(e.cohort_id) end));
$$;
drop policy if exists rsvp_update on public.event_rsvps;
create policy rsvp_update on public.event_rsvps for update to authenticated using(user_id=auth.uid() and oti_private.event_access(event_id) and exists(select 1 from public.cohort_events e where e.id=event_id and oti_private.member(e.cohort_id))) with check(user_id=auth.uid() and oti_private.event_access(event_id) and exists(select 1 from public.cohort_events e where e.id=event_id and oti_private.member(e.cohort_id)));
create table public.pending_cohort_assignments (
 email text not null references public.member_allowlist(email) on delete cascade,
 cohort_id uuid not null references public.cohorts(id) on delete cascade,
 primary key(email,cohort_id)
);
alter table public.pending_cohort_assignments enable row level security;
create policy pending_admin on public.pending_cohort_assignments for all to authenticated using(public.is_admin()) with check(public.is_admin());
grant select,insert,delete on public.pending_cohort_assignments to authenticated;
create table public.admin_audit (
 id bigint generated always as identity primary key,
 actor_id uuid,
 action text not null,
 entity_type text not null,
 entity_id text,
 created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
create policy audit_admin_read on public.admin_audit for select to authenticated using(public.is_admin());
grant select on public.admin_audit to authenticated;
-- Audit IDs and actions only: never email, message text or notification endpoints.
create function oti_private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare rowdata jsonb;
begin
 rowdata:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.admin_audit(actor_id,action,entity_type,entity_id) values(auth.uid(),lower(tg_op),tg_table_name,coalesce(rowdata->>'id',rowdata->>'cohort_id',rowdata->>'redeemed_by'));
 return case when tg_op='DELETE' then old else new end;
end; $$;
create trigger audit_cohorts after insert or update or delete on public.cohorts for each row execute function oti_private.audit_change();
create trigger audit_membership after insert or delete on public.cohort_members for each row execute function oti_private.audit_change();
create trigger audit_events after insert or update or delete on public.cohort_events for each row execute function oti_private.audit_change();
create trigger audit_allowlist after insert or update or delete on public.member_allowlist for each row execute function oti_private.audit_change();
create trigger audit_profile_access after update of role,status on public.profiles for each row when(old.role is distinct from new.role or old.status is distinct from new.status) execute function oti_private.audit_change();
-- Auth emails are never copied into public profiles. Exact login lookup is staff-only.
create function public.assign_cohort_by_login(cid uuid, login_email text, add_member boolean) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 if not oti_private.staff() then raise exception 'not_allowed' using errcode='42501'; end if;
 if not exists(select 1 from public.cohorts where id=cid) then raise exception 'invalid cohort'; end if;
 select p.id into uid from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=lower(btrim(login_email)) and p.status='active' and p.role in ('participant','coach');
 if uid is null then raise exception 'No active participant has that login email.'; end if;
 if add_member then insert into public.cohort_members values(cid,uid) on conflict do nothing;
 else delete from public.cohort_members where cohort_id=cid and user_id=uid; end if;
end; $$;
create function public.register_participant(login_email text,cid uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(btrim(login_email)); uid uuid; existing_role public.member_role;
begin
 if not public.is_admin() then raise exception 'not_allowed' using errcode='42501'; end if;
 if normalized is null or normalized !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(normalized)>254 then raise exception 'invalid email'; end if;
 if cid is not null and not exists(select 1 from public.cohorts where id=cid) then raise exception 'invalid cohort'; end if;
 select p.id,p.role into uid,existing_role from auth.users u join public.profiles p on p.id=u.id where lower(u.email)=normalized;
 if existing_role in ('admin','coach','board') or exists(select 1 from public.member_allowlist where email=normalized and role<>'participant') then raise exception 'Use role management for an existing staff account.'; end if;
 insert into public.member_allowlist(email,role,added_by) values(normalized,'participant',auth.uid()) on conflict(email) do update set role='participant';
 if cid is not null then
  if uid is not null then insert into public.cohort_members values(cid,uid) on conflict do nothing;
  else insert into public.pending_cohort_assignments values(normalized,cid) on conflict do nothing; end if;
 end if;
end; $$;
create function oti_private.apply_pending_cohorts() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.cohort_members(cohort_id,user_id) select a.cohort_id,new.id from public.pending_cohort_assignments a join auth.users u on lower(u.email)=a.email where u.id=new.id and new.role='participant' and new.status='active' on conflict do nothing;
 delete from public.pending_cohort_assignments a using auth.users u where u.id=new.id and lower(u.email)=a.email and new.role='participant' and new.status='active';
 return new;
end; $$;
create trigger apply_pending_cohorts after insert or update of role,status on public.profiles for each row execute function oti_private.apply_pending_cohorts();
create function public.manage_participant(uid uuid,new_role public.member_role,new_status public.member_status) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'not_allowed' using errcode='42501'; end if;
 if uid=auth.uid() then raise exception 'Cannot change your own staff access.'; end if;
 update public.profiles set role=new_role,status=new_status where id=uid;
 if not found then raise exception 'Participant not found.'; end if;
 if new_role='none' then delete from public.member_allowlist where redeemed_by=uid;
 else update public.member_allowlist set role=new_role where redeemed_by=uid; end if;
 -- The legacy allowlist trigger restores active; apply requested status last.
 update public.profiles set status=new_status where id=uid;
end; $$;
create function oti_private.protect_last_admin() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.role='admin' and old.status='active' and (new.role<>'admin' or new.status<>'active') then
  -- Serialize admin removals so two concurrent requests cannot remove both.
  perform pg_advisory_xact_lock(783121);
  if not exists(select 1 from public.profiles where id<>old.id and role='admin' and status='active') then raise exception 'Cannot remove the last active admin.'; end if;
 end if;
 return new;
end; $$;
create trigger protect_last_admin before update of role,status on public.profiles for each row execute function oti_private.protect_last_admin();

create or replace function public.message_event_rsvp(eid uuid, target_status text, message_body text) returns integer language plpgsql security definer set search_path='' as $$
declare cid uuid; sent integer;
begin
 select cohort_id into cid from public.cohort_events where id=eid;
 if not oti_private.event_access(eid,true) then raise exception 'not_allowed' using errcode='42501'; end if;
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

-- Each device subscription is visible only to its owner; even admins cannot inspect it.
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique check(char_length(endpoint)<=2000 and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com)/[^[:space:]]+$'),
 p256dh text not null check(p256dh ~ '^[A-Za-z0-9_-]{87,88}={0,2}$'),
 auth_key text not null check(auth_key ~ '^[A-Za-z0-9_-]{22,24}={0,2}$'),
 created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create function oti_private.active_participant() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and role in ('participant','coach'));$$;
create policy subscription_read on public.push_subscriptions for select to authenticated using(user_id=auth.uid());
create policy subscription_insert on public.push_subscriptions for insert to authenticated with check(user_id=auth.uid() and oti_private.active_participant());
create policy subscription_update on public.push_subscriptions for update to authenticated using(user_id=auth.uid() and oti_private.active_participant()) with check(user_id=auth.uid() and oti_private.active_participant());
create policy subscription_delete on public.push_subscriptions for delete to authenticated using(user_id=auth.uid());
grant select,insert,delete,update(p256dh,auth_key) on public.push_subscriptions to authenticated;
-- Upsert includes owner and endpoint, so use INSERT-or-existing fallback in the client rather than allowing owner mutation.
create function oti_private.limit_subscriptions() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtext(new.user_id::text));
 if (select count(*) from public.push_subscriptions where user_id=new.user_id)>=10 then raise exception 'Device limit reached. Remove an old device first.'; end if;return new;
end; $$;
create trigger limit_push_devices before insert on public.push_subscriptions for each row execute function oti_private.limit_subscriptions();
create function oti_private.revoke_removed_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status<>'active' or new.role not in ('participant','coach') then delete from public.push_subscriptions where user_id=new.id; end if;return new;
end; $$;
create trigger revoke_removed_push after update of role,status on public.profiles for each row execute function oti_private.revoke_removed_push();

-- Mirrors the public default calendar. DST-safe weekly schedule, editable by staff.
create table public.default_calendar_reminders (
 id text primary key,
 weekday integer not null check(weekday between 0 and 6),
 local_start time not null,
 time_zone text not null default 'America/Los_Angeles',
 enabled boolean not null default true
);
insert into public.default_calendar_reminders values('monday-group',1,'19:00','America/Los_Angeles',true);
alter table public.default_calendar_reminders enable row level security;
create policy default_reminder_staff on public.default_calendar_reminders for all to authenticated using(oti_private.staff()) with check(oti_private.staff());
grant select,update on public.default_calendar_reminders to authenticated;
create table oti_private.push_jobs (
 id uuid primary key default gen_random_uuid(),
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 event_key text not null,
 cohort_event_id uuid references public.cohort_events(id) on delete cascade,
 starts_at timestamptz not null,
 sent_at timestamptz,
 lease_token uuid,
 leased_until timestamptz,
 attempts integer not null default 0,
 unique(subscription_id,event_key,starts_at)
);
alter table oti_private.push_jobs enable row level security;
-- Only the scheduler service can claim jobs; no browser role can execute this.
create function public.claim_event_reminders() returns table(job_id uuid,lease uuid,endpoint text,p256dh text,auth_key text,starts_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 delete from oti_private.push_jobs where starts_at<now()-interval '30 days';
 insert into oti_private.push_jobs(subscription_id,event_key,cohort_event_id,starts_at)
 select s.id,e.id::text,e.id,e.starts_at from public.cohort_events e join public.cohorts c on c.id=e.cohort_id join public.cohort_members m on m.cohort_id=e.cohort_id join public.profiles p on p.id=m.user_id join public.push_subscriptions s on s.user_id=p.id
 where p.status='active' and p.role in ('participant','coach') and c.starts_at<=now() and c.ends_at>now() and not e.cancelled
 and e.starts_at-interval '1 hour'<=now() and e.starts_at-interval '1 hour'>now()-interval '5 minutes'
 and not exists(select 1 from public.event_rsvps r where r.event_id=e.id and r.user_id=p.id and r.status='declined') on conflict do nothing;
 insert into oti_private.push_jobs(subscription_id,event_key,starts_at)
 select s.id,'default:'||d.id,occ.start_at from public.default_calendar_reminders d cross join lateral(select (day::date+d.local_start) at time zone d.time_zone as start_at from generate_series(current_date-2,current_date+2,interval '1 day') day where extract(dow from day)=d.weekday) occ
 cross join public.push_subscriptions s join public.profiles p on p.id=s.user_id
 where d.enabled and p.status='active' and p.role in ('participant','coach') and occ.start_at-interval '1 hour'<=now() and occ.start_at-interval '1 hour'>now()-interval '5 minutes' on conflict do nothing;
 return query
 with eligible as (
  select j.id from oti_private.push_jobs j join public.push_subscriptions s on s.id=j.subscription_id join public.profiles p on p.id=s.user_id
  where j.sent_at is null and j.attempts<3 and (j.leased_until is null or j.leased_until<now()) and j.starts_at-interval '1 hour'>now()-interval '5 minutes' and j.starts_at-interval '1 hour'<=now()
  and p.status='active' and p.role in ('participant','coach') and (
   (j.cohort_event_id is null and exists(select 1 from public.default_calendar_reminders d where 'default:'||d.id=j.event_key and d.enabled)) or
   exists(select 1 from public.cohort_events e join public.cohorts c on c.id=e.cohort_id join public.cohort_members m on m.cohort_id=e.cohort_id where e.id=j.cohort_event_id and not e.cancelled and e.starts_at=j.starts_at and m.user_id=s.user_id and c.starts_at<=now() and c.ends_at>now() and not exists(select 1 from public.event_rsvps r where r.event_id=e.id and r.user_id=s.user_id and r.status='declined'))
  ) order by j.starts_at limit 20 for update of j skip locked
 ), claimed as (
  update oti_private.push_jobs j set lease_token=gen_random_uuid(),leased_until=now()+interval '1 minute',attempts=j.attempts+1 from eligible x where x.id=j.id returning j.*
 ) select j.id,j.lease_token,s.endpoint,s.p256dh,s.auth_key,j.starts_at from claimed j join public.push_subscriptions s on s.id=j.subscription_id;
end; $$;
create function public.finish_event_reminder(jid uuid,token uuid,delivered boolean,expired boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if expired then delete from public.push_subscriptions where id in(select subscription_id from oti_private.push_jobs where id=jid and lease_token=token);return;end if;
 update oti_private.push_jobs set sent_at=case when delivered then now() else null end where id=jid and lease_token=token;
end; $$;
revoke all on function public.claim_event_reminders(),public.finish_event_reminder(uuid,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.claim_event_reminders(),public.finish_event_reminder(uuid,uuid,boolean,boolean) to service_role;
revoke all on function public.assign_cohort_by_login(uuid,text,boolean),public.register_participant(text,uuid),public.manage_participant(uuid,public.member_role,public.member_status) from public,anon;
grant execute on function public.assign_cohort_by_login(uuid,text,boolean),public.register_participant(text,uuid),public.manage_participant(uuid,public.member_role,public.member_status) to authenticated;
revoke all on function oti_private.audit_change(),oti_private.apply_pending_cohorts(),oti_private.protect_last_admin(),oti_private.limit_subscriptions(),oti_private.revoke_removed_push(),oti_private.active_participant() from public;
grant execute on function oti_private.active_participant() to authenticated;
commit;
