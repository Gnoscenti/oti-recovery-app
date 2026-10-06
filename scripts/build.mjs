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
const live=process.env.OTI_LIVE==='1';
const publicConfig={supabaseUrl:process.env.OTI_SUPABASE_URL||null,supabasePublicKey:process.env.OTI_SUPABASE_PUBLIC_KEY||null,pushPublicKey:process.env.OTI_VAPID_PUBLIC_KEY||null};
if(live&&(!publicConfig.supabaseUrl||!publicConfig.supabasePublicKey))throw new Error('Live build requires OTI_SUPABASE_URL and OTI_SUPABASE_PUBLIC_KEY.');

async function copyStatic() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  for (const entry of ['index.html', 'privacy.html', 'styles.css', 'manifest.webmanifest', 'assets', 'fonts', 'data']) {
    await cp(path.join(www, entry), path.join(dist, entry), { recursive: true });
  }
  const sw = await readFile(path.join(www, 'sw.js'), 'utf8');
  await writeFile(path.join(dist, 'sw.js'), sw.replace('__APP_VERSION__', pkg.version));
  await cp(path.join(www,'admin'),path.join(dist,'admin'),{recursive:true});
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

/** Hosted review uses local assets and a synthetic-only API. */
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
  const js=(await readFile(path.join(site,'app.js'),'utf8')).replaceAll('__APP_VERSION__',pkg.version);
  await writeFile(path.join(site,'app.js'),js);
  for(const entry of ['styles.css','manifest.webmanifest','assets','fonts','data','privacy.html','admin'])await cp(path.join(www,entry),path.join(site,entry),{recursive:true});
  await cp(path.join(dist,'sw.js'),path.join(site,'sw.js'));
  const content=await readFile(path.join(www,'data/content.json'),'utf8');
  const html=(await readFile(path.join(www,'index.html'),'utf8')).replace('<html lang="en">','<html lang="en" data-theme="dark">').replace('<title>OTI Recovery</title>','<title>OTI Recovery (review copy)</title>').replace('<script src="app.js" defer></script>',`<script>window.__OTI_CONTENT__=${content};window.__OTI_REVIEW__=true;</script>\n<script src="app.js" defer></script>`);
  await writeFile(path.join(site,'index.html'),html);
  await build({...esbuildOptions,entryPoints:[path.join(www,'js/admin/app.js')],outfile:path.join(site,'admin/admin.js'),banner:{js:'window.__OTI_REVIEW__=true;'},plugins:[{name:'admin-review-stub',setup(b){b.onResolve({filter:/community\/supabase\.js$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"export function createSupabaseApi(){throw new Error('review copy: no server');}",loader:'js'}));}}]});
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
  banner: {js:`window.__OTI_PUBLIC_CONFIG__=${JSON.stringify(publicConfig)};`},
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
  await build({...esbuildOptions,entryPoints:[path.join(www,'js/admin/app.js')],outfile:path.join(dist,'admin/admin.js')});
  await standalone();
  await standalone('review.html', { review: true });
  if(live){const site=path.join(dist,'site');await mkdir(site,{recursive:true});for(const entry of ['index.html','app.js','sw.js','styles.css','manifest.webmanifest','assets','fonts','data','privacy.html','admin'])await cp(path.join(dist,entry),path.join(site,entry),{recursive:true});}else await reviewSite();
  console.log(`Built dist/ (v${pkg.version}), dist/standalone.html, dist/review.html (sample-data review copy), dist/site/ (hosted review copy)`);
}

