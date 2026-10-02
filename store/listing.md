# Store listing copy — OTI Recovery

Paste-ready text for Google Play Console and App Store Connect. Character limits are noted.

## App name
**OTI Recovery** (Play: 30 chars max · App Store: 30 chars max)

Subtitle (App Store, 30 max): **Moms in recovery, San Diego**

## Short description (Play, 80 max)
Meetings, help lines, and daily tools for mothers in recovery with OTI.

## Full description (Play 4,000 max · App Store 4,000 max)

Over the Influence Recovery (OTI) is a San Diego non-profit that supports mothers in recovery to live over the influence of drugs, shame, and regret and build a life they love for themselves and their children. This is our community app.

WHAT'S INSIDE

• Calendar — the Monday online women-only support group, Thoughtful & Thrive (TnT) community events, peer-training cohorts, and special events like Here to Thrive. Add anything to your own calendar in one tap, and turn on a weekly reminder for the Monday group.

• Help lines — 988 Suicide & Crisis Lifeline, the SAMHSA National Helpline, the San Diego Access & Crisis Line, Crisis Text Line, the National Maternal Mental Health Hotline, Postpartum Support International, NAMI, the National Domestic Violence Hotline, Poison Control, 2-1-1 San Diego, and local AA/NA lines. Call, text, or copy a number in one tap. Add your own coach, sponsor, or friend to "My people."

• Tools for right now — a private day counter with milestones, box breathing, a 15-minute "ride the urge" timer, and a HALT check-in. Plus links to SMART Recovery, Women for Sobriety, SHE RECOVERS, Recovery Dharma, In The Rooms, FindTreatment.gov, and family support.

• Stories & programs — stories of impact from OTI participants, the T.H.R.I.V.E. six-month peer recovery coaching program, individual coaching, our newsletters, and CalMHSA-approved peer support specialist training.

PRIVATE BY DESIGN

No accounts, no ads, no analytics. Your day count and your contacts stay on your phone.

This app offers peer and community resources; it is not medical care. If you are in danger, call 911.

Over the Influence Recovery · otirecovery.org · info@otirecovery.org

## Keywords (App Store, 100 chars max, comma-separated)
recovery,sobriety,sober,moms,mothers,support group,addiction,peer support,San Diego,helpline

## Category
- Google Play: **Health & Fitness** (alternative: Medical)
- App Store: **Health & Fitness** (secondary: Lifestyle)

## Contact & URLs
- Website: https://www.otirecovery.org
- Support email: info@otirecovery.org
- Privacy policy: (host `dist/privacy.html`, e.g. GitHub Pages URL or a page on otirecovery.org) — required by both stores

## Google Play: Content rating questionnaire (IARC)
- Category: Utility / Productivity / Communication / Other → answer "No" to violence, sexuality, language, controlled substances *depiction*; the app references drug recovery resources but does not depict or promote use.
- Expected rating: Everyone / PEGI 3 (Play may assign "Teen" for "references to drugs"; either is acceptable).

## Google Play: Data safety form (with the Community feature switched on)
- Does the app collect or share any of the required user data types? **Yes** (collected, not shared)
  - Personal info → **Email address**: required for the optional Community sign-in; purpose: account management.
  - Personal info → **Name**: optional display name; purpose: app functionality.
  - Messages → **Other in-app messages**: posts in member topics; purpose: app functionality.
  - App activity → **Other user-generated content**: reports about posts; purpose: app functionality.
- Is all collected data encrypted in transit? **Yes** (HTTPS/TLS to Supabase).
- Do you provide a way for users to request deletion? **Yes** — email info@otirecovery.org (also stated in the privacy policy).
- Data shared with third parties: **No**. (Supabase is a processor/hosting provider, not a recipient for its own purposes.)
- Notes for reviewer: the calendar, help lines, and tools need no account. The Community section is restricted to people OTI adds to its member list; sign-in is by emailed one-time code. Sobriety date and personal contacts are stored on-device only. The app opens external links (Zoom, Donorbox, Thinkific) in the browser.

If you ship before the Community is switched on (`community.supabaseUrl` unset), answer **No** to collection instead; update the form when you enable it.

## Google Play: App access
- "All functionality is available without special access" (no login).

## Google Play: Ads
- "No, my app does not contain ads."

## Google Play: Target audience
- 18 and over. (Do not select any age group under 18.)

## Google Play: Health apps declaration
- Select "Health and fitness" → "Mental health and recovery resources / support" style category if prompted; the app provides information and links, no medical device or health data collection.

## App Store: App Privacy ("nutrition label") (with the Community feature switched on)
- Data Linked to You: Contact Info → Email Address (App Functionality); User Content → Other User Content (App Functionality); Identifiers → User ID (App Functionality).
- Not used for tracking. No third-party advertising or analytics.
- Before the Community is switched on: "Data Not Collected".

## App Store: Age rating
- Answer questionnaire honestly: "Medical/Treatment Information: Infrequent/Mild" and "Alcohol, Tobacco, or Drug Use or References: Infrequent/Mild" → typically 12+ or 17+. Rating 17+ is fine for this audience.

## App Store: Review notes (paste into "Notes" for the reviewer)
OTI Recovery is the companion app for Over the Influence Recovery, a San Diego 501(c)(3) supporting mothers in recovery. Beyond web content, the app provides native weekly meeting reminders (local notifications), a private on-device sobriety counter and personal call list, breathing and urge-timer tools that work offline, and one-tap call/text to crisis lines. No login is required for any of that. The Community tab is a members-only message board (sign-in by emailed one-time code); reviewer test account: add the email you'd like us to allowlist in the review notes reply, or use the demo credentials below. Organization website: https://www.otirecovery.org

Apple requires a demo account when there is a login: before submitting, allowlist a dedicated address (e.g. `appreview@otirecovery.org`, role participant) and give Apple that email; the code arrives in that inbox, so use an inbox OTI can forward from, or set up the account and provide the sign-in code procedure in the notes.
