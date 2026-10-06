# October 2 feedback implementation

Base: Gnoscenti/oti-recovery-app main 910c64b3ccf05630952a41e4c6c5fee9ec319655.
Source: Gmail thread 1a0fe2d970d969f6, Julie's October 2 Chrome request and Gigi feedback relayed that evening.

## Review in Chrome

Run `npm ci && npm run check`, then `node scripts/serve.mjs 4173 dist/site`. Open the printed localhost URL. The hosted review output remains `dist/site`; no app account is required. Only synthetic data is used. Participant Calendar shows the default public calendar plus assigned active cohorts; unassigned sign-ins see only the default calendar. Activity replaces Tools. Open `/admin/` to review staff cohort membership, activities, event creation/editing/cancellation, registration and status-targeted messaging. Switch the review role to check denial of participant and board access. Demo mutations reset on reload and send nothing externally. The participant app and admin portal have separate demo instances. Chrome and Safari/WebKit desktop/mobile flows run in the PR Check workflow; `npx playwright-core install chromium webkit && node scripts/test-chrome.mjs` runs them locally after building. The review can be added to the iOS Home Screen. Its public shell/assets are cached; private records are never cached. See [the mobile/admin/reminder activation guide](ADMIN-MOBILE-REMINDERS.md) for the latest setup.

## Production setup

Production is not activated by this change. Apply `schema.sql`, `seed.sql`, then `cohorts.sql` and `admin-reminders.sql` once to an authorized Supabase database. Do not re-run legacy seed.sql after cohort activation: its global slug uniqueness assumption is obsolete. Existing unscoped topics remain stored but become inaccessible after cohort activation. Explicitly assign old content to the correct cohort only after an owner reviews the audience; never copy private records into public JSON or the review build. Create cohort topics through the authorized `create_cohort` RPC.

Admins/coaches create named cohorts with explicit begins/ends dates; the form suggests six months but never automatically moves participants. Only admins/coaches assign or remove existing accounts; only admins manage global roles. Participants cannot enroll themselves. Membership removal, inactive profiles, future cohorts and expired cohorts fail closed. Board members receive no cohort access under the newer participant-app requirement. Events/activities are cohort-scoped; Daily Affirmations retain the narrower participant/assigned-coach audience, without giving admins access to affirmation content. Admins manage event logistics and membership. Assigned coaches moderate cohort discussion.

RSVP writes use the authenticated caller's identity. Participants see only their own RSVP. Admins/coaches see event RSVP data. Recipient selection occurs in a database transaction from current active cohort participants and RSVP status (including no-response). Messages are private in-app records, not email/SMS; one-hour event push is implemented separately and remains disabled until the correct backend, VAPID keys and Cron are configured. Inbox reads recheck current membership; direct clients cannot write deliveries or spoof recipients. Avoid identifying details in event/location/activity text.

## Product decision still open

The user selected the first affirmation on October 6:

> What happened to me was not my fault. I am reclaiming my sense of safety one day at a time, and my healing journey deserves patience and respect

It appears inside an authorized cohort Daily Affirmations topic when there is no later coach post. The review fixture uses the same wording. It is not attributed to a coach in production, assigned a fabricated date, or published on the home page. Coach-authored posts remain available; the UI does not promise a fresh generated affirmation every day. A reviewable 30-day pack now lives at `www/data/affirmations-30-days.json`: the user’s first affirmation and three supplied entries are unchanged, followed by 26 original drafts informed by research on mothers in recovery, serenity and healing. Six entries are marked spiritual and 24 non-spiritual. No publisher/API passages are copied. The pack contains general encouragement only, never participant posts or personal data. Day numbers propose an order; automatic rotation, notifications, repetition and preference filtering are not enabled. Review choices: manually curated daily coach posts; an approved scheduled library; or a less frequent coach cadence. Choose source, editorial owner, timezone and missed-day behavior before automated scheduling. No production affirmation content is fabricated or auto-generated.

## Preserved home features

The existing online recovery support group remains the only public home-page program event, as explicitly requested. Other legacy static events are removed; cohort calendar events come only from the private API. Device-only day count, Ride the Urge, online recovery group and Stories of Impact remain. Donation/sponsor links and the Recovery Communities list are removed; help lines are exactly 988 and Never Use Alone. Personal saved contacts remain device-only. Activity replaces Tools in navigation while retaining the liked recovery utilities.
