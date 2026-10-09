// Builds the app.
//   dist/          the installable app (put this folder on any static web host)
//   docs/          the same files, served by GitHub Pages
//   preview.html   the whole app in one file (pictures and fonts inside), for a quick look
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

await build({ entryPoints: [path.join(src, 'js/main.js')], bundle: true, minify: true, format: 'iife', target: ['es2020'], loader: { '.csv': 'text' }, outfile: path.join(dist, 'app.js'), legalComments: 'none' });

const copyDir = (name) => fs.cpSync(path.join(src, name), path.join(dist, name), { recursive: true });
copyDir('img');
copyDir('fonts');
copyDir('icons');
fs.copyFileSync(path.join(src, 'index.html'), path.join(dist, 'index.html'));
fs.copyFileSync(path.join(src, 'css/app.css'), path.join(dist, 'app.css'));
fs.copyFileSync(path.join(src, 'manifest.webmanifest'), path.join(dist, 'manifest.webmanifest'));
// settings.json holds the link to the shared rate sheet. Phones read it fresh every time they
// have internet, so the link can be changed without the phones re-installing anything.
const settings = JSON.parse(fs.readFileSync(path.join(src, 'settings.json'), 'utf8'));
if (typeof settings.ratesUrl !== 'string') throw new Error('src/settings.json needs a "ratesUrl" (use "" for none)');
if (settings.ratesUrl && !/^https:\/\//.test(settings.ratesUrl)) throw new Error('ratesUrl in src/settings.json must start with https://');
fs.writeFileSync(path.join(dist, 'settings.json'), JSON.stringify({ ratesUrl: settings.ratesUrl.trim() }, null, 2) + '\n');

// service worker: every file except itself and settings.json is kept on the phone
const files = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files.push(path.relative(dist, full).split(path.sep).join('/'));
  }
};
walk(dist);
const cached = files.filter((f) => f !== 'settings.json' && f !== 'sw.js');
const hash = crypto.createHash('sha256');
for (const f of cached) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
const version = 'mangal-bill-' + hash.digest('hex').slice(0, 12);
const sw = fs.readFileSync(path.join(src, 'sw.js'), 'utf8').replace("'__VERSION__'", JSON.stringify(version)).replace('__FILES__', JSON.stringify(['./', ...cached]));
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

// single-file preview
const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
let css = fs.readFileSync(path.join(src, 'css/app.css'), 'utf8').replace(/url\((fonts\/[^)]+)\)/g, (_, f) => `url(${dataUri(path.join(src, f), 'font/woff2')})`);
const assets = {};
for (const f of fs.readdirSync(path.join(src, 'img'))) assets[f.replace(/\.webp$/, '')] = dataUri(path.join(src, 'img', f), 'image/webp');
const js = fs.readFileSync(path.join(dist, 'app.js'), 'utf8').replace(/<\/script/g, '<\\/script');
const preview = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0F1E33">
<title>Mangal Bill</title>
<style>
${css}
</style>
</head>
<body>
<div id="screen"></div>
<div id="overlay"></div>
<div id="toast" aria-live="polite"></div>
<script>window.__MB_ASSETS = ${JSON.stringify(assets)};</script>
<script>
${js}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'preview.html'), preview);

// the same single file without <html>/<head>/<body>, for publishing as a hosted preview page
const artifact = `<title>Mangal Bill</title>
<style>
${css}
html, body { height: 100%; }
</style>
<div id="screen"></div>
<div id="overlay"></div>
<div id="toast" aria-live="polite"></div>
<script>window.__MB_ASSETS = ${JSON.stringify(assets)};</script>
<script>
${js}
</script>
`;
fs.writeFileSync(path.join(root, 'artifact.html'), artifact);

// docs/ is what GitHub Pages serves: an exact copy of dist/
const docs = path.join(root, 'docs');
fs.rmSync(docs, { recursive: true, force: true });
fs.cpSync(dist, docs, { recursive: true });
fs.writeFileSync(path.join(docs, '.nojekyll'), '');

const size = (f) => fs.statSync(f).size;
const total = files.concat('sw.js').reduce((s, f) => s + (fs.existsSync(path.join(dist, f)) ? size(path.join(dist, f)) : 0), 0);
console.log(`built ${version}: ${files.length + 1} files, ${(total / 1024).toFixed(0)} KB; app.js ${(size(path.join(dist, 'app.js')) / 1024).toFixed(0)} KB; preview.html ${(size(path.join(root, 'preview.html')) / 1024).toFixed(0)} KB`);
