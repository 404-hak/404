import { expect, test } from '@playwright/test';

// Сценарии дежурного: дашборд открывается, тревога → перехват → закрыта, меню правой кнопки
test.beforeEach(async ({ page, request }) => {
  await request.post('/api/demo/reset');
  await page.addInitScript(() => { sessionStorage.setItem('404-intro', 'seen'); });
});

test('дашборд: карта, буи и журнал', async ({ page }) => {
  await page.goto('/#/map');
  await expect(page.locator('.leaflet-marker-icon .buoy')).toHaveCount(10, { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: /Журнал событий/ })).toBeVisible();
});

test('тревога → перехват', async ({ page, request }) => {
  await page.goto('/#/map');
  await expect(page.locator('.leaflet-marker-icon .buoy').first()).toBeVisible({ timeout: 30_000 });
  await request.post('/api/demo/run?calm_s=1&warn_s=1');
  const card = page.locator('[data-alert-id]').first();
  await expect(page.getByRole('button', { name: 'Начать перехват' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Начать перехват' }).click();
  await expect(page.getByText(/Перехват — катер в пути/)).toBeVisible({ timeout: 15_000 });
  await expect(card).toBeVisible();
});

test('своё меню по правой кнопке', async ({ page }) => {
  await page.goto('/#/map');
  await expect(page.locator('.delta-dock')).toBeVisible({ timeout: 30_000 });
  await page.mouse.click(640, 40, { button: 'right' });
  const menu = page.locator('.ctx-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Тема')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});
