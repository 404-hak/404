// Копирует логотипы и фавикон из brand/logo-package в public/brand — единый источник бренда
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '../../brand/logo-package/404-logo-package');
const out = path.resolve(here, '../public/brand');
const files = [
  'svg/404-lockup-horizontal-cream.svg', 'svg/404-logo-cream.svg', 'svg/404-wordmark-cream.svg',
  'svg/404-lockup-horizontal-dark.svg', 'svg/404-logo-dark.svg', 'svg/404-wordmark-dark.svg',
  'favicon/favicon.svg', 'favicon/favicon.ico', 'favicon/apple-touch-icon.png',
  'favicon/icon-192.png', 'favicon/icon-512.png',
];
fs.mkdirSync(out, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(pkg, f), path.join(out, path.basename(f)));
console.log(`brand: ${files.length} файлов → public/brand`);
