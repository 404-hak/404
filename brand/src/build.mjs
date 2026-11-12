// 404 · сборка брендбука: пакет логотипов + токены + PDF
// Запуск: node brand/src/build.mjs   (нужен playwright: npm i -g playwright)
import { createRequire } from 'module';
import { execSync, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const { chromium } = pw;

const here = path.dirname(fileURLToPath(import.meta.url));
const brand = path.resolve(here, '..');
const { css, ORDER } = await import('./ui.mjs');
const A = await import('./pages-a.mjs');
const B = await import('./pages-b.mjs');
const { buildPackage, writeTokens } = await import('./package.mjs');

const browser = await chromium.launch();
const pkgDir = path.join(brand, 'logo-package/404-logo-package');
const pkg = await buildPackage(browser, pkgDir);
writeTokens(brand);
console.log('package files:', pkg.total, JSON.stringify(pkg.byDir));

const pages = {
  cover: A.cover(), toc: A.toc(), intro: A.intro(),
  d01: A.d01(), p11: A.p11(), p12: A.p12(), p13: A.p13(),
  d02: A.d02(), p21: A.p21(), p22: A.p22(), p23: A.p23(), p24: A.p24(),
  d03: A.d03(), p31: A.p31(), p32: A.p32(), p33: A.p33(),
  d04: B.d04(), p41: B.p41(), p42: B.p42(), p43: B.p43(),
  d05: B.d05(), p51: B.p51(), p52: B.p52(),
  d06: B.d06(), p61: B.p61(),
  d07: B.d07(), p71: B.p71(), p72: B.p72(), p73: B.p73(), p74: B.p74(),
  d08: B.d08(), p81: B.p81(pkg), p82: B.p82(pkg), p83: B.p83(),
  end: B.end(),
};
for (const id of ORDER) if (!pages[id]) throw new Error('нет страницы ' + id);

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>404 · Бренд-гайд</title><style>${css}</style></head><body>${ORDER.map(id => pages[id]).join('\n')}</body></html>`;
const buildDir = path.join(brand, 'build');
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'brandbook.html'), html);

const page = await browser.newPage({ viewport: { width: 1170, height: 827 } });
await page.goto('file://' + path.join(buildDir, 'brandbook.html'));
await page.evaluate(() => document.fonts.ready);
const scale = (297 / 25.4 * 96) / 1170;
await page.pdf({ path: path.join(brand, '404-brandbook.pdf'), width: '297mm', height: '210mm', printBackground: true, scale, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();

// zip пакета
const zip = path.join(brand, 'logo-package/404-logo-package.zip');
fs.rmSync(zip, { force: true });
execFileSync('python3', ['-m', 'zipfile', '-c', zip, '404-logo-package'], { cwd: path.join(brand, 'logo-package') });
console.log('ok');
