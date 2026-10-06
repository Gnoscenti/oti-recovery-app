# October 2 feedback implementation

Base: Gnoscenti/oti-recovery-app main 910c64b3ccf05630952a41e4c6c5fee9ec319655.
Source: Gmail thread 1a0fe2d970d969f6, Julie's October 2 Chrome request and Gigi feedback relayed that evening.

## Review in Chrome

Run `npm ci && npm run check && npm run serve`, then open the printed localhost URL and `/review.html`. Hosted review output remains `dist/site`. No iPhone, Safari, Claude account or installation is required. Only synthetic data is used. Community and Activity/Calendar share a demo session. Switch to Coach to create cohorts, assign membership, post activities, create events and message participants by going/maybe/declined/no-response. Switch back to Participant to RSVP and read the private event inbox. Demo mutations reset on reload and send nothing externally. Desktop and mobile Chromium flows run in the PR Check workflow. `npx playwright-core install chromium && node scripts/test-chrome.mjs` also runs them locally after building.

## Production setup

Production is not activated by this change. Apply `schema.sql`, `seed.sql`, then `cohorts.sql` once to an authorized Supabase database. Do not re-run legacy seed.sql after cohort activation: its global slug uniqueness assumption is obsolete. Existing unscoped topics remain stored but become inaccessible after cohort activation. Explicitly assign old content to the correct cohort only after an owner reviews the audience; never copy private records into public JSON or the review build. Create cohort topics through the authorized `create_cohort` RPC.

Admins/coaches create named cohorts with explicit begins/ends dates; the form suggests six months but never automatically moves participants. Only admins/coaches assign or remove existing accounts; only admins manage global roles. Participants cannot enroll themselves. Membership removal, inactive profiles, future cohorts and expired cohorts fail closed. Board members receive no cohort access under the newer participant-app requirement. Events/activities are cohort-scoped; Daily Affirmations retain the narrower participant/assigned-coach audience, without giving admins access to affirmation content. Admins manage event logistics and membership. Assigned coaches moderate cohort discussion.

RSVP writes use the authenticated caller's identity. Participants see only their own RSVP. Admins/coaches see event RSVP data. Recipient selection occurs in a database transaction from current active cohort participants and RSVP status (including no-response). Messages are private in-app records, not email/SMS; no external notification service is configured. Inbox reads recheck current membership; direct clients cannot write deliveries or spoof recipients. Avoid identifying details in event/location/activity text.

## Product decision still open

No affirmation content source is approved. Coach-authored posts remain available; the UI does not promise a fresh generated affirmation every day. Review choices: manually curated daily coach posts; an approved scheduled library; or a less frequent coach cadence. Choose source, editorial owner, timezone and missed-day behavior before automated scheduling. No production affirmation content is fabricated or auto-generated.

## Preserved home features

The existing online recovery support group remains the only public home-page program event, as explicitly requested. Other legacy static events are removed; cohort calendar events come only from the private API. Device-only day count, Ride the Urge, online recovery group and Stories of Impact remain. Donation/sponsor links and the Recovery Communities list are removed; help lines are exactly 988 and Never Use Alone. Personal saved contacts remain device-only. Activity replaces Tools in navigation while retaining the liked recovery utilities.
