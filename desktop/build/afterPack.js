// macOS: подписываем приложение «ad-hoc» (без сертификата Apple). Без подписи Mac на процессорах M1–M4
// не запускает программу вовсе, а с ad-hoc подписью — запускает после «Открыть всё равно» в настройках
// безопасности (см. README, раздел «Приложение для компьютера»). На Windows и Linux ничего не делает.
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
