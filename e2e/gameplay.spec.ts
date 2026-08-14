import { expect, test, type Page } from '@playwright/test';

async function waitForTestBridge(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__TRICKAL_TEST__ !== undefined)).toBe(true);
}

test('앱이 초기 HUD와 접근 가능한 게임 캔버스로 부팅된다', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('game-canvas')).toBeVisible();
  await expect(page.getByLabel('슈팅 게임 화면')).toBeVisible();
  await expect(page.getByTestId('hud-hp')).toHaveText('♥ 3 / 3');
  await expect(page.getByTestId('hud-mana')).toHaveText('MANA: 0%');
  await expect(page.getByTestId('hud-score')).toHaveText('SCORE: 0');
  await expect(page.getByTestId('hud-level')).toHaveText('LV. 1');
  await expect(page.getByTestId('game-over')).toHaveCount(0);

  const bridgeIsAbsent = await page.evaluate(() => window.__TRICKAL_TEST__ === undefined);
  expect(bridgeIsAbsent).toBe(true);
});

test.describe('결정적 게임플레이', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?e2e=1');
    await waitForTestBridge(page);
  });

  test('스페이스바 발사로 적을 처치하면 SCORE와 MANA가 증가한다', async ({ page }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(6));

    await page.keyboard.down('Space');
    await page.evaluate(() => window.__TRICKAL_TEST__?.stepFrames(100));
    await page.keyboard.up('Space');

    await expect(page.getByTestId('hud-score')).toHaveText('SCORE: 10');
    await expect(page.getByTestId('hud-mana')).toHaveText('MANA: 5%');
    await expect(page.getByTestId('hud-hp')).toHaveText('♥ 3 / 3');
  });

  test('적 이탈로 게임오버가 되고 R 키로 초기 상태에 복귀한다', async ({ page }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.stepFrames(2_000));

    const gameOver = page.getByTestId('game-over');
    await expect(gameOver).toBeVisible();
    await expect(gameOver.getByText('GAME OVER', { exact: true })).toBeVisible();
    await expect(gameOver.getByText('Press R to Restart', { exact: true })).toBeVisible();
    await expect(page.getByTestId('hud-hp')).toHaveText('♥ 0 / 3');

    await page.keyboard.down('KeyR');
    await expect(gameOver).toHaveCount(0);
    await page.keyboard.up('KeyR');

    await expect(page.getByTestId('hud-hp')).toHaveText('♥ 3 / 3');
    await expect(page.getByTestId('hud-mana')).toHaveText('MANA: 0%');
    await expect(page.getByTestId('hud-score')).toHaveText('SCORE: 0');
    await expect(page.getByTestId('hud-level')).toHaveText('LV. 1');
  });
});
