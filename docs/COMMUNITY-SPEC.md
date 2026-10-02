# OTI Community — implementation spec (v1)

**Request (Julie Pierce, Sep 27, 2026):** a message board / chat with different topics, used like a messenger.
One topic for **Events**, seen by participants and board members. One for **Daily Affirmations**, seen only by
participants and Gigi. Julie could not open the Claude artifact preview (it requires a Claude account).

**Status:** implemented in this repository (schema, authorization tests, app UI, review build). What is left is
OTI's Supabase project and the first member list: see `docs/COMMUNITY-SETUP.md`.

## 1. Roles

One role per person, set by an admin on the member list (by email).

| Role | Who | Notes |
| --- | --- | --- |
| `participant` | Women in the T.H.R.I.V.E. program / support group | Default for members |
| `coach` | Gigi (peer recovery coach) | Moderates both topics; sees Daily Affirmations |
| `board` | Board members | Events only |
| `admin` | Julie (and anyone else who manages the list) | Manages members; moderates Events; **no access to Daily Affirmations** |
| `none` | Anyone who signs in but is not on the list | Sees nothing; shown "ask OTI to add you" |

"Gigi" is modeled as the `coach` role rather than a named exception so a second coach can be added without a schema change. A participant who is also on the board should be listed once, as `participant` or `board`, whichever set of topics they should see.

## 2. Visibility matrix (enforced server-side)

Levels are ordered: `read` < `post` < `moderate`. No row = no access. Stored in `channel_access`, seeded by `supabase/seed.sql`.

| Topic | participant | coach | board | admin | none / anonymous |
| --- | --- | --- | --- | --- | --- |
| **Events** | post | moderate | post | moderate | — |
| **Daily Affirmations** | post | moderate | — | — | — |

Consequences the tests check:

- A board member or admin cannot list the Daily Affirmations topic, read its messages, hide, delete, or see reports from it, even with a message id.
- Admin ≠ superuser. Admin rights are: member list, remove member. Nothing about admin grants content access outside the matrix.
- Anonymous (no session) gets `permission denied` on every table and function; a signed-in `none` gets empty results.

## 3. Data model (Postgres on Supabase; `supabase/schema.sql`)

```
profiles          id (= auth.users.id), display_name, role, status (active|removed), accepted_guidelines_at
member_allowlist  email (pk, lowercase), role, note, added_by, added_at, redeemed_by, redeemed_at
channels          id, slug, name, description, pin_moderator_latest, sort_order
channel_access    (channel_id, role) → level
messages          id, channel_id, author_id, author_name*, author_role*, body (1–2000), created_at,
                  edited_at, hidden_at, hidden_by, deleted_at
reports           id, message_id, reporter_id, reason, created_at, resolved_at, resolved_by  (unique per reporter+message)
read_marks        (user_id, channel_id) → last_read_at
```
`*` denormalized by trigger at insert (and kept in sync on rename / anonymized to "Former member" on removal), so the app never needs to read other members' profiles.

Triggers: `handle_new_user` (sign-in → profile with allowlisted role), `handle_allowlist_change` (allowlisting an email that already signed in applies the role at once), `profiles_guard` (only admins change role/status), `messages_before_insert` (author fields, rate limit, requires display name), `messages_before_update` (who may change what).

## 4. API (PostgREST + RPC, all under the member's JWT; RLS decides)

| Action | Call |
| --- | --- |
| Request code | `POST /auth/v1/otp` `{email}` → email with 6-digit code (`signInWithOtp`) |
| Verify | `POST /auth/v1/verify` `{email, token, type:"email"}` → session (`verifyOtp`) |
| My profile | `GET profiles?id=eq.<me>` · `PATCH profiles` (display_name, accepted_guidelines_at only) |
| Topics | `GET channels?order=sort_order` · `GET channel_access` (my role's row = my level; other rows = "Visible to…") |
| Messages | `GET messages?channel_id=eq.X&order=created_at.desc&limit=50[&created_at=lt.<cursor>]` |
| Post | `POST messages {channel_id, author_id:<me>, body}` |
| Edit (author, 15 min) | `PATCH messages?id=eq.X {body}` |
| Hide / unhide (moderator) | `rpc/hide_message {mid, hide}` |
| Delete (author or moderator) | `rpc/delete_message {mid}` (soft) |
| Report | `POST reports {message_id, reporter_id:<me>, reason}` |
| Open reports (moderator) | `GET reports?resolved_at=is.null` + `GET messages?id=in.(…)` |
| Resolve | `rpc/resolve_report {rid}` |
| Unread | `rpc/unread_counts` → `[{channel_id, unread}]` · `rpc/mark_read {ch}` |
| Live updates | Realtime `postgres_changes` on `messages` filtered by `channel_id` (RLS applies); 45 s polling fallback |
| Members (admin) | `GET/POST/PATCH member_allowlist` · `GET profiles` · `PATCH profiles {status:'removed'}` |

Client: `www/js/community/supabase.js` implements this behind the `CommunityApi` interface (`api.js`); `demo.js` is the in-memory twin used by the review build and tests.

## 5. Authorization rules (RLS + triggers)

- **Read a message**: not deleted, `can_access(channel,'read')`, and (not hidden or I am the author or I moderate the channel).
- **Post**: I am `author_id`, `can_access(channel,'post')`, guidelines accepted, display name set. One post per 5 s, 200 per day.
- **Edit text**: author only, within 15 minutes; sets `edited_at`. Moderators cannot rewrite others' words.
- **Hide/unhide**: channel moderator only; author still sees their own hidden post marked "hidden by a moderator".
- **Delete**: author or channel moderator; soft delete; invisible to everyone afterwards, not restorable.
- **Immutable**: id, channel_id, author_id, author_name, author_role, created_at (column grants + trigger).
- **Reports**: any reader can file one per message; visible to the reporter and the channel's moderators; resolved by moderators only.
- **Profiles**: self and admins can read; members edit only their own name/guidelines; role/status changes are admin-only.
- **Allowlist**: admin-only, all operations.
- **Anonymous**: no table or function grants at all (`revoke … from anon, public`).
- **Service role** (dashboard/SQL) bypasses RLS by design; triggers skip their row rules when `auth.uid()` is null.

## 6. Moderation defaults

- Moderators: coach in both topics; admin in Events. Board members cannot moderate.
- Members see a "Report" action on every post that isn't theirs; a reason is optional.
- Moderators get a "Reported posts" list with Hide / Delete / Dismiss; hiding is reversible, deleting is not.
- Guidelines are shown once and must be accepted before posting (text in `www/js/community/view.js`, `GUIDELINES`).
- Body limit 2,000 characters, text only (no images or attachments in v1), links stay plain text.
- Removing a member revokes access immediately and shows their posts as "Former member".
- No automated content scanning; the 988 line is shown under every composer.

## 7. Notification defaults

- In-app unread badge on the Community tab and per topic (`unread_counts`), refreshed on open and when the app returns to the foreground.
- New posts appear live while a topic is open (Realtime; polling fallback every 45 s).
- **No push notifications in v1.** Path if wanted later: `@capacitor/push-notifications` + FCM/APNs, a `device_tokens` table, and a Supabase Edge Function on message insert; per-topic opt-in, default on for Daily Affirmations only, quiet hours 9 pm–8 am.
- No emails other than the sign-in code.

## 8. Privacy boundaries

- Participant-only content never touches the public content file, the service worker cache, browser storage, the review build, or the store screenshots (those use `demo.js` sample data with invented names).
- The app ships only the anon key; it authorizes nothing by itself. Every row is gated by RLS.
- Stored per member: email (auth), chosen display name, role, guideline acceptance, messages, reports they file, read marks. No phone numbers, no location, no analytics.
- Display names should be first names or nicknames; the guidelines say so. Members can rename at any time.
- Data location: OTI's Supabase project (choose a US region). Retention: messages until deleted; a removed member's posts remain but are anonymized; full deletion on request is one SQL statement (`delete from auth.users where id = …` cascades).
- Privacy policy and store data-safety answers are updated (`www/privacy.html`, `store/listing.md`).

## 9. Tests

- `test/community-rls.test.mjs` — 24 tests against a real Postgres (PGlite) with the exact schema: matrix per role, anonymous/unlisted denial, impersonation, rate limit, guidelines/name gates, hidden/deleted visibility, moderation by role, edit window, immutability, reports, unread counts, removal + anonymization, allowlist timing, admin-only lists, realtime publication, idempotent re-apply.
- `test/community-ui.test.mjs` — 9 tests: validation, grouping, pinning, edit window, error copy, and the demo adapter mirroring the matrix and flows.
- `npm run check` runs everything (content validation, type-check, all tests, build).
- Not automated: a live Supabase project (email delivery, Realtime). Covered by the manual checklist in `docs/COMMUNITY-SETUP.md`.

## 10. No-login review handoff

- `dist/review.html` — one file, opens in any browser, no account: the whole app with the Community tab on sample data and a **"View as"** switcher (participant / coach / board / admin / new member / not on the list / signed out) so Julie can see exactly what each role sees. Send it as an email attachment or host it (GitHub Pages workflow publishes `dist/`, so it lands at `…/review.html`).
- The sideload APK (`oti-recovery-*.apk`) for Android phones; the review copy of the Community tab is not in the APK (production config).
- Feedback path: reply by email; no Claude account is needed for anything above.
