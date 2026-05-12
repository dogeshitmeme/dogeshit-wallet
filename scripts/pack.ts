// Build the extension and zip dist/ contents into wallet/dogeshit-wallet-v<ver>.zip
// for distribution / sideload / Chrome Web Store upload.
//
// The zip contains the *contents* of dist/ at root (manifest.json, popup.html,
// background.js, ...) — NOT a wrapping `dist/` directory. Chrome and the Web
// Store both expect manifest at root.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { $ } from 'bun';

const ROOT = resolve(import.meta.dir, '..');
const DIST = resolve(ROOT, 'dist');
const MANIFEST = resolve(ROOT, 'manifest.json');

// 1. Rebuild fresh
console.log('▶ build');
await $`bun run scripts/build.ts`.cwd(ROOT);

// 2. Read version from manifest for filename
const { version, name } = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  version: string;
  name: string;
};
const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const zipName = `${slug}-v${version}.zip`;
const zipPath = resolve(ROOT, zipName);

if (existsSync(zipPath)) rmSync(zipPath);

// 3. Zip dist/ contents (cd into dist so the archive entries are relative,
// no leading `dist/` directory). Defensive excludes: dist/ should never
// contain these (esbuild bundles in place + minify=false → no maps), but
// if a stale node_modules / .map / .DS_Store ever leaks into the build
// output, we don't want it shipped to the Web Store.
console.log(`▶ zip → ${zipName}`);
await $`zip -qr ${zipPath} . -x 'node_modules/*' '*.map' '.DS_Store' '*/.DS_Store'`.cwd(DIST);

// 4. Show size summary
const stat = Bun.file(zipPath).size;
const kb = (stat / 1024).toFixed(1);
console.log(`✔ ${zipName} (${kb} KB)`);
console.log(`  Chrome Web Store: chrome://extensions → Load unpacked (dev) or upload to dashboard.`);
console.log(`  Sideload: extract zip, point Load unpacked at the extracted folder.`);
