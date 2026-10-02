# Store launch guide — OTI Recovery

This is the shortest path from this repository to a live app on Google Play, then TestFlight/App Store. Steps marked **(OTI)** need someone with authority at Over the Influence Recovery; everything else you can do yourself.

## 0. What you need

| Item | Notes |
| --- | --- |
| GitHub repo | Push this folder. CI (`.github/workflows/`) builds the Android bundle, the iOS build, and hosts the web version + privacy policy on GitHub Pages. |
| Google Play developer account | $25 one-time. **Register it as an Organization** in OTI's name (needs a D-U-N-S number, free from Dun & Bradstreet; nonprofits usually already have one). Personal accounts created after Nov 2023 must run a 14-day closed test with 12+ testers before they can publish — organization accounts skip that. |
| Apple Developer Program | $99/yr, or **free for US 501(c)(3) nonprofits** (apply for the fee waiver during enrollment; also needs a D-U-N-S number). Enroll the organization, not an individual, so the listing shows "Over the Influence Recovery" and you don't need to transfer later. Enrollment can take a few days to two weeks. |
| Privacy policy URL | Both stores require one. `dist/privacy.html` is ready; it goes live at `https://<owner>.github.io/<repo>/privacy.html` once Pages is enabled, or upload it to otirecovery.org. Put the URL in `www/js/config.js` (`privacyUrl`) too. |
| OTI's phone number **(OTI)** | The website lists no phone number. If OTI has one, put it in `www/data/content.json` → `org.phone` (digits only). |

## 1. Android: first upload (today)

1. Create the upload keystore **on your own machine** (never in CI, never committed):
   ```bash
   npm run keystore
   ```
   It writes `release/oti-upload.jks` and `android/keystore.properties` (both git-ignored) and prints the base64 for CI. Store the .jks and password in a password manager.
2. Build the App Bundle locally (needs Android Studio or the Android SDK + JDK 21):
   ```bash
   npm install
   npm run android:bundle
   # → android/app/build/outputs/bundle/release/app-release.aab
   ```
   Or add the four `ANDROID_*` secrets to GitHub and push a tag `v1.0.0`; the **Android release** workflow produces the same `.aab` as a downloadable artifact.
3. Play Console → **Create app** → name "OTI Recovery", App, Free.
4. Complete the **Dashboard** tasks. All answers are in `store/listing.md`: privacy policy URL, app access (no login), ads (none), content rating, target audience (18+), data safety (**no data collected**), health declaration.
5. **Store listing**: paste the copy from `store/listing.md`; upload `store/play-icon-512.png`, `store/feature-graphic-1024x500.png`, and the phone screenshots in `store/screenshots/` (1080×2400; Play accepts 16:9–9:16, up to 8).
6. **Testing → Internal testing → Create release** → upload the `.aab` → add your own email as a tester → roll out. You'll get an install link within minutes. This is the fastest way to get the app on OTI's phones today.
7. When OTI signs off, **Production → Create release** → same bundle → **Send for review**. First reviews typically take 1–7 days.

Optional automation: create a service account in Google Cloud, grant it "Release manager" in Play Console → Users and permissions, and store its JSON key as the `PLAY_SERVICE_ACCOUNT_JSON` secret. Every tag push then uploads straight to the internal track.

## 2. iOS: TestFlight without owning a Mac

1. After Apple enrollment: App Store Connect → **Apps → +** → bundle ID `org.otirecovery.app` (register it under Certificates, Identifiers & Profiles first, capabilities: none needed).
2. Users and Access → **Integrations → App Store Connect API** → generate a key with **App Manager** access. Note the Key ID and Issuer ID; download the `.p8`.
3. Add secrets `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8_BASE64` (`base64 -i AuthKey_XXXX.p8`).
4. Push a tag (or run **iOS TestFlight** manually). The macOS runner archives with automatic signing and uploads to TestFlight (≈15 minutes; GitHub charges macOS minutes at 10× on private repos, so a run costs about 150 minutes of the plan's allowance).
5. In App Store Connect, add internal testers, then external testers (Beta App Review, usually < 24 h).
6. For the App Store: fill in the listing from `store/listing.md`, upload 6.7" and 6.5" screenshots (resize `store/screenshots/*.png` to 1290×2796 with `scripts/screenshots.mjs` after changing the viewport, or use the Play ones scaled), set age rating, submit for review. Add the reviewer notes from `store/listing.md`; they explain the native features so the app is not mistaken for a plain website wrapper (App Review guideline 4.2).

If you do have a Mac: `npm run sync && npm run ios:open`, then Product → Archive → Distribute. Same result.

## 3. Updating content without a release

Events and phone numbers live in `www/data/content.json`. Two ways to ship a change:

- **Instant (no store review):** set `remoteContentUrl` in `www/js/config.js` to the raw GitHub URL of `content.json` on `main` (or the Pages URL `https://<owner>.github.io/<repo>/data/content.json`). The app fetches it on launch and uses it when its `version` date is newer than the bundled one. Bump `version` on every edit; `npm run validate:content` catches mistakes.
- **With a release:** edit, bump `version` in `package.json`, tag `vX.Y.Z`. CI builds both platforms.

## 4. Version numbers

- Android `versionCode` = 1000 + GitHub run number (always increasing). `versionName` = the git tag.
- iOS build number = same formula; marketing version = the git tag.
- Local builds use `APP_VERSION_CODE` / `APP_VERSION_NAME` env vars (default 1 / 1.0.0). Bump `APP_VERSION_CODE` above the last uploaded one if you upload by hand.

## 4b. Community (message board)

Switch it on by following `docs/COMMUNITY-SETUP.md` (Supabase project, ~30 minutes), then fill in `www/js/config.js → community`. Until then the tab shows "not switched on yet" and the store data-safety answers stay "no data collected". When it is on, use the Community answers in `store/listing.md` and give Apple a demo member account.

To let someone review the Community without an account, send them `dist/review.html` (built by `npm run build`): it runs on sample data with a "View as" role switcher.

## 5. Checklist before submitting

- [ ] `npm run check` passes (content validation, type-check, tests, build)
- [ ] OTI confirmed the phone list, event dates, and that the Zoom links may be public
- [ ] OTI supplied additional participant stories with consent (only one is on the website today)
- [ ] Privacy policy URL is live and set in `config.js`
- [ ] Screenshots regenerated after any visual change (`npm run screenshots`)
- [ ] Test on a real Android phone: install from the internal-testing link, set a reminder, tap Call on 988 (then hang up), add a contact, kill and reopen the app (data persists)
