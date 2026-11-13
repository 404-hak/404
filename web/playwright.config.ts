import { defineConfig } from '@playwright/test';

// Сквозные сценарии в браузере: сайт и API должны быть запущены (BASE_URL, по умолчанию http://127.0.0.1:8000)
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8000',
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
});
