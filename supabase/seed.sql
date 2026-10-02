-- ============================================================================
-- OTI Community seed: the two topics OTI asked for and their visibility matrix.
-- Safe to re-run; re-running converges the matrix to exactly what is below.
-- ============================================================================

insert into public.channels (slug, name, description, pin_moderator_latest, sort_order) values
  ('events', 'Events',
   'Upcoming OTI events, TnT outings, rides, and who is coming.',
   false, 10),
  ('affirmations', 'Daily Affirmations',
   'A daily affirmation from your coach, and a place to share yours.',
   true, 20)
on conflict (slug) do update
  set name = excluded.name, description = excluded.description,
      pin_moderator_latest = excluded.pin_moderator_latest, sort_order = excluded.sort_order;

-- Events: participants + board post; coach + admin moderate.
insert into public.channel_access (channel_id, role, level)
select c.id, r.role::public.member_role, r.level::public.access_level
from public.channels c,
     (values ('participant', 'post'), ('board', 'post'), ('coach', 'moderate'), ('admin', 'moderate')) as r(role, level)
where c.slug = 'events'
on conflict (channel_id, role) do update set level = excluded.level;
delete from public.channel_access
 where channel_id = (select id from public.channels where slug = 'events')
   and role not in ('participant', 'board', 'coach', 'admin');

-- Daily Affirmations: participants post; coach (Gigi) moderates. Board and admin have NO access.
insert into public.channel_access (channel_id, role, level)
select c.id, r.role::public.member_role, r.level::public.access_level
from public.channels c,
     (values ('participant', 'post'), ('coach', 'moderate')) as r(role, level)
where c.slug = 'affirmations'
on conflict (channel_id, role) do update set level = excluded.level;
delete from public.channel_access
 where channel_id = (select id from public.channels where slug = 'affirmations')
   and role not in ('participant', 'coach');
