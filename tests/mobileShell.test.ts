import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'src/index.css'), 'utf8');
const main = readFileSync(join(root, 'src/main.tsx'), 'utf8');
const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');
const manifestPath = join(root, 'public/manifest.webmanifest');
const serviceWorkerPath = join(root, 'public/sw.js');

assert.match(html, /viewport-fit=cover/, 'viewport should opt into iOS safe-area layout');
assert.match(html, /name="theme-color"/, 'theme color should be declared for Android browser chrome');
assert.match(html, /apple-mobile-web-app-capable/, 'iOS standalone mode should be enabled');
assert.match(html, /rel="manifest"/, 'web app manifest should be linked');
assert.ok(existsSync(manifestPath), 'manifest.webmanifest should exist');
assert.ok(existsSync(serviceWorkerPath), 'service worker should exist for installable mobile shell');
assert.ok(existsSync(join(root, 'public/apple-touch-icon.png')), 'iOS touch icon should exist');
assert.ok(existsSync(join(root, 'public/icon-192.png')), 'Android 192px icon should exist');
assert.ok(existsSync(join(root, 'public/icon-512.png')), 'Android 512px icon should exist');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './');
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'manifest should include mobile icons');
assert.ok(manifest.icons.some((icon: { src: string; type: string }) => icon.src === 'icon-192.png' && icon.type === 'image/png'));
assert.ok(manifest.icons.some((icon: { src: string; type: string }) => icon.src === 'icon-512.png' && icon.type === 'image/png'));

assert.match(main, /serviceWorker\.register/, 'production app should register the service worker');
assert.match(css, /touch-action:\s*manipulation/, 'controls should avoid mobile tap delay');
assert.match(css, /-webkit-overflow-scrolling:\s*touch/, 'scroll areas should keep iOS momentum scrolling');
assert.match(css, /safe-area-inset-bottom/, 'mobile layout should respect bottom safe area');
assert.match(viteConfig, /entryFileNames:\s*'assets\/\[name\]\.js'/, 'Pages build should use a stable entry asset URL');
assert.match(viteConfig, /assetFileNames:\s*'assets\/\[name\]\[extname\]'/, 'Pages build should use stable CSS asset URLs');

console.log('mobile shell tests passed');
