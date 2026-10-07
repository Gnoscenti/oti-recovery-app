# Participant calendars, administration and Home Screen app

Participant language is used throughout the new interfaces. Login name currently means the verified sign-in email, not the editable display name. The admin portal uses an exact email match on the server, avoiding accidental assignment to people who share a display name.

## Calendar and cohorts

Calendar always shows the default public month/agenda and upcoming support-group events. An active participant or assigned coach also sees their assigned active cohort calendar below it, with RSVP and private event messages. Unassigned, signed-out, board and removed accounts see only the default calendar. Staff management of other cohorts lives in `/admin/`, not in the participant calendar. Activity remains the replacement for Tools; device-local recovery helpers remain available there.

Cohorts have explicit start/end dates, suggested at roughly six months when created. Staff create a new cohort and assign participants deliberately; there is no silent re-enrollment. Expired and future cohorts do not expose participant content. Removing a cohort assignment takes effect on server reads and reminders immediately. Navigation, foregrounding and auth changes reload private views.

## Admin portal

`/admin/` is a separate staff login interface. The review alias is `oti-recovery-admin.vercel.app`, redirected to `/admin/` by the hosting config. It hosts synthetic sample data until the production backend is configured. It is no-indexed and not cached. Its public HTML is not an authorization boundary: every sensitive server operation validates the current active role.

Admins can register participants by sign-in email, optionally assigning a cohort before their first login. Registration creates an allowlist entry; it does **not** send an email. Pending assignments are applied when the participant first signs in. Admins can change account roles and suspend/restore access. The portal prevents changing your own staff access, and the database protects the last active admin. Suspended accounts cannot read private content, and their push device registrations are removed.

Admins and coaches can create/edit cohorts, assign/remove active participants by login email, post activities, create/edit/cancel events, and send private in-app messages by RSVP status. Admins can read immutable administrative audit entries. Coaches cannot register accounts, promote roles or read administrative audit history. Audit entries contain actions and record IDs, not message text, sign-in emails or device endpoint secrets. Admins retain logistics access without access to participant-only affirmation discussions. This portal does not provide a bypass to private conversation policies or collect clinical/medical records.

## iPhone and Android web app

On an iPhone, open the participant URL in Safari, tap Share, choose **Add to Home Screen**, then launch the new icon. If Safari offers **Open as Web App**, leave it enabled. Sign in again from that icon if needed; the Home Screen app can have a separate browser session. The manifest uses a stable app ID and `standalone` display. Local fonts/icons/images and the public app shell are cached. Safe-area spacing, 44px touch targets and 16px minimum input text support mobile Safari without keyboard focus zoom. Private participant/cohort records are fetched under the current sign-in and are never put into the service-worker cache. Offline public pages and device-local helpers remain usable; private views require connectivity.

The admin portal is also responsive and optimized for a desktop browser. Mobile review checks use WebKit (Safari engine) and Chrome at 390×844 and 375×667, plus desktop 1280×900. A physical iPhone install and Apple push receipt must still be tested after configuring the live backend; WebKit automation is not proof of an APNs delivery.

## One-hour alerts

Participants opt in by tapping **Enable event alerts** under Calendar. Permission is requested only from a direct button tap, as iOS requires. Web push works on an installed iOS/iPadOS Home Screen web app on 16.4+, and supported Android/desktop browsers. The server schedules a reminder at event start minus one hour; a one-minute Cron means dispatch is normally within one minute of that time. Device/provider/Focus delays can affect receipt.

An opted-in device receives reminders for the default calendar and the participant's current active cohort events. Declined, cancelled, expired-cohort and revoked-membership events are excluded. The weekly default calendar reminder mirrors Monday 7 PM America/Los_Angeles, using a timezone conversion that handles DST. Its legacy native local reminder is also moved from 30 to 60 minutes before start. This iteration targets the requested website/Home Screen app; existing Capacitor binaries require rebuilding and do not yet have a remote native APNs/FCM plugin.

Lock-screen text is always generic: “Event reminder” and “An event on your calendar starts in one hour. Open the app for details.” Notification taps open Calendar, where current authorization is rechecked. No names, event descriptions, RSVP status or conversation text go to a push provider. Device endpoints and encryption keys are owner-private, including from admins, with no client capability to invoke the scheduler or spoof ownership. Arbitrary/local network endpoints are rejected. Notifications are disabled server-side on account suspension and removed from the device before sign-out. The participant can also tap **Turn off event alerts**. Notifications already handed to a provider cannot be recalled, so their content remains generic.

The queue claims a maximum of 20 deliveries with leases and retries transient failures at most three times. Confirmed sends are not re-claimed. Provider 404/410 deletes the expired device endpoint. Retries recheck current event time/cancellation, role, membership and RSVP. A crash after provider acceptance but before acknowledgement can cause a repeated generic notification; the notification tag groups the same occurrence. Jobs more than five minutes past the one-hour dispatch time are not sent late, and old jobs are cleaned up after 30 days.

## Activate on the correct backend

The connected account currently exposes no identified active OTI Supabase project. No unrelated project has been modified and no live push messages have been sent.

1. Identify OTI's active project. Apply `schema.sql` and `seed.sql` only if initializing a new database; apply `cohorts.sql` once if not already applied. Do not rerun legacy seed against an activated cohort database. Then apply `admin-reminders.sql` once.
2. Configure production sign-in email delivery with a custom SMTP provider and an OTI-approved sender/domain in Supabase Auth. The default Supabase mail service only delivers to project team addresses and is unsuitable for participant sign-ins. Set the production Site URL and allowed redirect URLs to the actual participant and admin origins. Add Julie and Gigi with admin roles using their confirmed login emails; the review personas are synthetic and do not create live accounts. Add the real admin's verified email to the member allowlist, with admin role, through trusted database setup. Use the provider's email OTP template for sign-in codes. No staff identity or authority comes from participant-editable metadata.
3. Configure the deployment with `OTI_LIVE=1`, `OTI_SUPABASE_URL`, `OTI_SUPABASE_PUBLIC_KEY` (public/publishable key only), and `OTI_VAPID_PUBLIC_KEY`. The build copies only these public config values into the browser. **Never** put a service-role/secret/private VAPID key in browser config.
4. Generate a VAPID key pair using the documented `web-push` tool; store `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (a valid operator contact), and a random `REMINDER_CRON_SECRET` as Edge Function secrets. Deploy `supabase/functions/event-reminders/index.ts` with gateway JWT verification disabled; the handler verifies its own scheduler secret. Service role is server-only, and the database grants scheduler RPCs only to that role.
5. Enable pg_cron/pg_net. Store the actual project URL and matching Cron secret in Supabase Vault as `oti_project_url` and `oti_reminder_cron_secret`. Run `reminders-cron.sql`. Never put secrets in source, SQL files or logs.
6. Configure the admin hostname on this project. The supplied Vercel alias uses a root redirect. For an organization-owned `admin.<domain>`, add that exact host to the redirect or direct its root to `/admin/`; use the actual DNS values returned by the host. Separate origins require separate staff sign-in.
7. Verify a test account can see default calendar while unassigned, assign it by exact email, then verify cohort events/RSVP. Test notification permission, closed-app receipt about one hour before a test event, cancellation/removal, sign-out and offline public navigation on a real iPhone and Android device. Run platform security advisors after activating the SQL.

The 30-day affirmation pack and its explicit reviewable rotation decision are unchanged.

Primary implementation references: [Apple WebKit Home Screen Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [Web Push library](https://github.com/web-push-libs/web-push).

## Login-free review and ownership

The isolated `oti-recovery-review` hosting project is public and explicitly uses `OTI_LIVE=0`, with synthetic participants and no live credentials. Participant review: https://oti-recovery-review.vercel.app . Admin review: https://oti-recovery-admin.vercel.app . Julie and Gigi each appear as Admin in review selectors. The existing hosting project retains its deployment protection. Keep this public review project in sample mode; activate live service on the separate production project after access testing.

OTI should own the Supabase organization, project, billing and approved email sender, and invite its implementation consultant through provider access controls. Confirm recurring hosting/email costs and the separate implementation fee before activation. Production sign-in, private persistence and actual push receipt remain blocked until this setup and physical-device testing are complete.
