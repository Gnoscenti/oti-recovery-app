// Captures phone screenshots of each tab for the store listings (and for a quick
// visual check). Requires a Chromium: set PW_CHROMIUM to its executable path,
// or install with `npx playwright install chromium`.
//   node scripts/screenshots.mjs [outDir]
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'store/screenshots');
await mkdir(out, { recursive: true });

const port = 4174;
const server = spawn(process.execPath, [path.join(root, 'scripts', 'serve.mjs'), String(port), 'dist'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const exe = process.env.PW_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath: exe });
try {
  for (const [scheme, suffix] of [['light', ''], ['dark', '-dark']]) {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
      colorScheme: scheme, locale: 'en-US', timezoneId: 'America/Los_Angeles',
    });
    const page = await ctx.newPage();
    // Pin "now" so screenshots are reproducible, and seed a demo sobriety date + contact.
    await page.addInitScript(() => {
      window.__OTI_NOW__ = '2026-09-28T19:00:00-07:00';
      window.__OTI_REVIEW__ = true; // Community tab on sample data (no sign-in) for the store screenshots
      try {
        localStorage.setItem('oti.sobrietyDate', JSON.stringify('2026-07-14'));
        localStorage.setItem('oti.people', JSON.stringify([{ id: '1', name: 'Coach Dana', number: '6195550100', note: 'my coach' }]));
      } catch {}
    });
    for (const tab of ['home', 'calendar', 'phones', 'activity', 'more', 'community']) {
      await page.goto(`http://localhost:${port}/index.html#${tab}`);
      await page.waitForSelector(`#view-${tab}:not([hidden])`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, `${tab}${suffix}.png`) });
    }
    // Community: a topic open (sample data)
    await page.goto(`http://localhost:${port}/index.html#community`);
    await page.waitForSelector('#view-community .topic');
    await page.click('#view-community .topic');
    await page.waitForSelector('#view-community .msg');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `community-topic${suffix}.png`) });
    await page.selectOption('#review-viewer', 'coach');
    await page.waitForSelector('#view-community .topic');
    await page.click('#view-community .topic:nth-of-type(2)');
    await page.waitForSelector('#view-community .pinned');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `community-affirmations${suffix}.png`) });
    // Breathing tool open
    await page.goto(`http://localhost:${port}/index.html#activity`);
    await page.waitForSelector('#view-activity:not([hidden])');
    await page.click('#view-activity .tool');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(out, `breathe${suffix}.png`) });
    await ctx.close();
  }
  console.log(`Screenshots written to ${out}`);
} finally {
  await browser.close();
  server.kill();
}

