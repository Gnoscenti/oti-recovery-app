// @ts-check
/**
 * Build-time and deployment configuration. `__APP_VERSION__` is replaced by
 * scripts/build.mjs with the version from package.json.
 */
export const CONFIG = {
  appVersion: '__APP_VERSION__',

  /**
   * Optional: a public HTTPS URL of a newer content.json. When set, the app
   * checks it on launch and swaps in the newer content (by `version`) without
   * an app-store release. Leave null to use only the bundled file.
   * Example once the repo is on GitHub:
   *   'https://raw.githubusercontent.com/<org>/<repo>/main/www/data/content.json'
   */
  remoteContentUrl: /** @type {string|null} */ (null),

  /** Public privacy policy URL (also required in the Play Console and App Store Connect). */
  privacyUrl: /** @type {string|null} */ (null),

  /** Milestones shown on the sobriety counter, in days. Years continue automatically. */
  milestones: [1, 7, 14, 30, 60, 90, 120, 180, 270, 365],

  /**
   * Members' Community (Events + Daily Affirmations message board).
   * Fill in after following docs/COMMUNITY-SETUP.md. The anon key is safe to
   * ship: every read and write is authorized by Row Level Security on the server.
   * Until both values are set, the Community tab shows "not switched on yet".
   */
  community: {
    supabaseUrl: /** @type {string|null} */ (null),      // e.g. 'https://abcdefghijkl.supabase.co'
    supabaseAnonKey: /** @type {string|null} */ (null),  // the project's anon/public key
    pollSeconds: 45,        // fallback refresh when realtime is unavailable
    demo: false,            // true = sample data, no sign-in (review builds set this automatically)
  },
};
