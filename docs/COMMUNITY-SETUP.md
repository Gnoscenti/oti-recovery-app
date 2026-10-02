# Switching on the Community (Supabase) — about 30 minutes

The app is already built for it. This creates OTI's private community server and connects the app to it.

## 1. Create the project (free tier is enough)

1. https://supabase.com → New project. Name `oti-community`, region **West US (Oregon)**, generate a strong database password and store it in a password manager (it is only needed for direct database access, never by the app).
2. Wait for the project to finish provisioning (~2 minutes).

## 2. Load the schema

SQL Editor → New query → paste the whole of `supabase/schema.sql` → Run. Then the same with `supabase/seed.sql`.
Both can be run again at any time; they only converge to the same state.

## 3. First members

Edit `supabase/first-members.sql` with Julie's and Gigi's real email addresses (roles `admin` and `coach`), run it once. From then on, admins add everyone else inside the app (Community → Members).

## 4. Sign-in by emailed code

Authentication → Providers → Email: keep **Enable email provider** on, turn **Confirm email** off (the code itself proves ownership), set **OTP expiry** to 600 seconds.

Authentication → Email Templates → **Magic Link**: replace the body with:

```html
<h2>Your OTI Recovery sign-in code</h2>
<p>Enter this code in the app within 10 minutes:</p>
<p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>If you didn’t request this, you can ignore this email.</p>
```

The `{{ .Token }}` placeholder is what makes Supabase send a 6-digit code instead of a link. Subject: `Your OTI sign-in code`.

Optional but recommended before more than a handful of members: Authentication → SMTP settings → use OTI's own sender (e.g. Google Workspace SMTP or a free Resend/Postmark account) so codes come from `@otirecovery.org` and are not rate-limited (the built-in sender allows only a few emails per hour).

## 5. Connect the app

Project Settings → API: copy **Project URL** and the **anon public** key into `www/js/config.js`:

```js
community: {
  supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',
  supabaseAnonKey: 'eyJ…',
  pollSeconds: 45,
  demo: false,
},
```

The anon key is meant to ship in the app; Row Level Security is what protects the data. Never put the `service_role` key anywhere near the app.

Then `npm run check`, `npm run sync`, and build/upload as in `STORE-LAUNCH.md`. The Community tab switches from "not switched on yet" to the sign-in screen.

## 6. Realtime

Database → Publications → `supabase_realtime` should list `messages` (the schema adds it). If it doesn't, toggle it on for `public.messages`. Without it the app still works; new posts appear within 45 seconds instead of instantly.

## 7. Manual acceptance test (do this once with two phones or a phone + laptop)

1. Julie signs in with her email → code → lands on Topics with **Events** only, sees Members.
2. Gigi signs in → sees Events and Daily Affirmations, "Coach" badge on her posts.
3. Julie adds a participant's email in Members. The participant signs in → onboarding (name + guidelines) → sees both topics.
4. Participant posts in Daily Affirmations. Gigi sees it live. Julie cannot see the topic.
5. Gigi hides the post → participant still sees it marked hidden; a second participant does not.
6. Participant reports a post in Events → Julie and Gigi see it under Reported posts; a board member does not.
7. Julie removes a member → that phone drops to "Almost there" on next refresh; their posts read "Former member".
8. Kill and reopen the app: still signed in; unread badge shows counts.

## 8. Day-to-day

- **Add / remove people:** Community → Members (admins). Role changes apply immediately.
- **Rename a topic or change who sees it:** edit `supabase/seed.sql` and run it in the SQL editor (the app reads the matrix; nothing to rebuild).
- **Delete someone's data completely:** SQL editor → `delete from auth.users where email = 'person@example.org';` (cascades to profile, messages, reports, read marks).
- **Backups:** Supabase free tier keeps no automatic backups; run Database → Backups → download, or upgrade to Pro ($25/mo) for daily backups once the community is active.
