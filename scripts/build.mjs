// Build the web app into dist/ (used by Capacitor and for web hosting) and a
// single-file dist/standalone.html for previews.
//   node scripts/build.mjs          one-off build
//   node scripts/build.mjs --watch  rebuild on change
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'www');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const watch = process.argv.includes('--watch');

async function copyStatic() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  for (const entry of ['index.html', 'privacy.html', 'styles.css', 'manifest.webmanifest', 'assets', 'fonts', 'data']) {
    await cp(path.join(www, entry), path.join(dist, entry), { recursive: true });
  }
  const sw = await readFile(path.join(www, 'sw.js'), 'utf8');
  await writeFile(path.join(dist, 'sw.js'), sw.replace('__APP_VERSION__', pkg.version));
}

/**
 * One self-contained HTML file: CSS, fonts (data URIs), images, JS, and content inlined.
 * @param {string} outName
 * @param {{review?: boolean}} [opts]  review = Community tab on sample data, no sign-in (for people without an app account)
 */
async function standalone(outName = 'standalone.html', opts = {}) {
  let html = await readFile(path.join(dist, 'index.html'), 'utf8');
  const css = await readFile(path.join(dist, 'styles.css'), 'utf8');
  const js = await readFile(path.join(dist, 'app.js'), 'utf8');
  const content = await readFile(path.join(dist, 'data', 'content.json'), 'utf8');
  let fontCss = await readFile(path.join(dist, 'fonts', 'fonts.css'), 'utf8');
  for (const f of await readdir(path.join(dist, 'fonts'))) {
    if (!f.endsWith('.woff2')) continue;
    const b64 = (await readFile(path.join(dist, 'fonts', f))).toString('base64');
    fontCss = fontCss.replaceAll(`url('${f}')`, `url('data:font/woff2;base64,${b64}')`);
  }
  const assetUri = async (rel, mime) => `data:${mime};base64,${(await readFile(path.join(dist, rel))).toString('base64')}`;
  const images = {
    'assets/logo.png': await assetUri('assets/logo.png', 'image/png'),
    'assets/community.jpg': await assetUri('assets/community.jpg', 'image/jpeg'),
    'assets/here-to-thrive.jpg': await assetUri('assets/here-to-thrive.jpg', 'image/jpeg'),
  };
  html = html
    .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
    .replace('<link rel="stylesheet" href="fonts/fonts.css">', `<style>${fontCss}</style>`)
    .replace('<link rel="stylesheet" href="styles.css">', `<style>${css}</style>`)
    .replace('<script src="app.js" defer></script>', `<script>window.__OTI_CONTENT__=${content};${opts.review ? 'window.__OTI_REVIEW__=true;' : ''}</script>\n<script>${js}</script>`);
  if (opts.review) html = html.replace('<title>OTI Recovery</title>', '<title>OTI Recovery (review copy)</title>');
  for (const [rel, uri] of Object.entries(images)) html = html.replaceAll(`"${rel}"`, `"${uri}"`);
  // content.json image paths (e.g. event images) are relative too
  for (const [rel, uri] of Object.entries(images)) html = html.replaceAll(`src:"${rel}"`, `src:"${uri}"`).replaceAll(`"image":"${rel}"`, `"image":"${uri}"`);
  await writeFile(path.join(dist, outName), html);
}

/**
 * Static site for hosting the review copy (dist/site/): same page, but fonts come from
 * Google Fonts, images from OTI's own CDN, and the Supabase client is stubbed out
 * (the review copy runs on sample data and never talks to a server). Small enough
 * to upload through a hosting API.
 */
const CDN_IMAGES = {
  'assets/logo.png': 'https://static.wixstatic.com/media/727706_0cb4f0faeaec4e39990f350adbb2a703~mv2.png/v1/fill/w_240,h_240,al_c,q_90/logo.png',
  'assets/community.jpg': 'https://static.wixstatic.com/media/727706_fe77ad1c0d8f4e9bb0d2111855647f7e~mv2.jpg/v1/fill/w_900,h_450,al_c,q_70/group.jpg',
  'assets/here-to-thrive.jpg': 'https://static.wixstatic.com/media/727706_fa0e131ca65247d181aaace3806021bb~mv2.png/v1/fill/w_700,h_466,al_c,q_70/thrive.jpg',
};
const GOOGLE_FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Nunito+Sans:ital,opsz,wght@0,6..12,400..800;1,6..12,400..800&display=swap">';

async function reviewSite() {
  const site = path.join(dist, 'site');
  await rm(site, { recursive: true, force: true });
  await mkdir(site, { recursive: true });
  await build({
    ...esbuildOptions,
    outfile: path.join(site, 'app.js'),
    plugins: [{
      name: 'review-stub-supabase',
      setup(b) {
        b.onResolve({ filter: /community\/supabase\.js$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: "export function createSupabaseApi() { throw new Error('review copy: no server'); }", loader: 'js' }));
      },
    }],
  });
  let js = await readFile(path.join(site, 'app.js'), 'utf8');
  js = js.replaceAll('__APP_VERSION__', pkg.version);
  for (const [rel, url] of Object.entries(CDN_IMAGES)) js = js.replaceAll(`"${rel}"`, `"${url}"`);
  await writeFile(path.join(site, 'app.js'), js);
  let css = await readFile(path.join(www, 'styles.css'), 'utf8');
  await writeFile(path.join(site, 'styles.css'), css);
  let content = await readFile(path.join(www, 'data', 'content.json'), 'utf8');
  for (const [rel, url] of Object.entries(CDN_IMAGES)) content = content.replaceAll(`"${rel}"`, `"${url}"`);
  let html = await readFile(path.join(www, 'index.html'), 'utf8');
  html = html
    .replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
    .replace('<link rel="stylesheet" href="fonts/fonts.css">', GOOGLE_FONTS)
    .replace('<title>OTI Recovery</title>', '<title>OTI Recovery (review copy)</title>')
    .replace('<html lang="en">', '<html lang="en" data-theme="dark">')  // the look OTI signed off on; the installed app follows the phone's setting
    .replace('<script src="app.js" defer></script>', `<script>window.__OTI_CONTENT__=${JSON.stringify(JSON.parse(content))};window.__OTI_REVIEW__=true;</script>\n<script src="app.js" defer></script>`);
  for (const [rel, url] of Object.entries(CDN_IMAGES)) html = html.replaceAll(`"${rel}"`, `"${url}"`);
  await writeFile(path.join(site, 'index.html'), html);
  await cp(path.join(www, 'privacy.html'), path.join(site, 'privacy.html'));
}

const esbuildOptions = {
  entryPoints: [path.join(www, 'js', 'app.js')],
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['es2020', 'chrome90', 'safari15'],
  format: 'iife',
  outfile: path.join(dist, 'app.js'),
  logLevel: 'info',
};

await copyStatic();
if (watch) {
  const ctx = await context({ ...esbuildOptions, plugins: [{ name: 'standalone', setup(b) { b.onEnd(async () => { await standalone(); await standalone('review.html', { review: true }); }); } }] });
  await ctx.watch();
  console.log('Watching www/ …');
} else {
  await build(esbuildOptions);
  // config.js keeps the placeholder as a string literal; swap it in the bundle too.
  const out = path.join(dist, 'app.js');
  await writeFile(out, (await readFile(out, 'utf8')).replaceAll('__APP_VERSION__', pkg.version));
  await standalone();
  await standalone('review.html', { review: true });
  await reviewSite();
  console.log(`Built dist/ (v${pkg.version}), dist/standalone.html, dist/review.html (sample-data review copy), dist/site/ (hosted review copy)`);
}
