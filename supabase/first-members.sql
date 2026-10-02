-- ============================================================================
-- First members. Run ONCE in the Supabase SQL editor after schema.sql and
-- seed.sql, with the real addresses. Anyone listed here can sign in with a
-- one-time email code and lands with the given role; everyone else who signs
-- in gets no access until an admin adds them (in the app: More → Members).
--
-- Roles:
--   admin        manages members and channels; sees Events (moderates); does NOT see Daily Affirmations
--   coach        Gigi: sees and moderates both Events and Daily Affirmations
--   board        sees and posts in Events only
--   participant  sees and posts in Events and Daily Affirmations
-- ============================================================================

insert into public.member_allowlist (email, role, note) values
  ('julie@example.org', 'admin', 'Julie'),        -- replace
  ('gigi@example.org',  'coach', 'Gigi')          -- replace
on conflict (email) do update set role = excluded.role, note = excluded.note;
