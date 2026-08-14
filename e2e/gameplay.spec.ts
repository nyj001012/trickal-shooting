import { expect, test, type Page } from '@playwright/test';

const RESPONSIVE_VIEWPORTS = [
  { name: '데스크톱', width: 1440, height: 900 },
  { name: '태블릿', width: 1024, height: 768 },
  { name: '모바일 가로', width: 844, height: 390 },
] as const;

const HUD_TEST_IDS = ['hud-hp', 'hud-mana', 'hud-score', 'hud-level'] as const;

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

test.describe('풀페이지 반응형 레이아웃', () => {
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height}에서 4:3 게임 보드와 HUD가 뷰포트 안에 맞는다`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');

      const board = page.getByTestId('game-board');
      const canvas = page.getByTestId('game-canvas');
      const hud = page.locator('.hud');

      await expect(board).toBeVisible();
      await expect(canvas).toBeVisible();
      await expect(hud).toBeVisible();

      const boardBox = await board.boundingBox();
      const canvasBox = await canvas.boundingBox();
      const hudBox = await hud.boundingBox();
      if (!boardBox || !canvasBox || !hudBox) {
        throw new Error('반응형 레이아웃 요소의 경계 상자를 계산할 수 없습니다.');
      }

      const expectedWidth = Math.min(viewport.width, (viewport.height * 4) / 3);
      const expectedHeight = Math.min(viewport.height, (viewport.width * 3) / 4);

      expect(Math.abs(boardBox.width / boardBox.height - 4 / 3)).toBeLessThan(0.01);
      expect(Math.abs(boardBox.width - expectedWidth)).toBeLessThanOrEqual(1);
      expect(Math.abs(boardBox.height - expectedHeight)).toBeLessThanOrEqual(1);
      expect(Math.abs(boardBox.x - (viewport.width - boardBox.width) / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(boardBox.y - (viewport.height - boardBox.height) / 2)).toBeLessThanOrEqual(1);

      expect(Math.abs(canvasBox.x - boardBox.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(canvasBox.y - boardBox.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(canvasBox.width - boardBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(canvasBox.height - boardBox.height)).toBeLessThanOrEqual(1);

      const hudBoxes = [];
      for (const testId of HUD_TEST_IDS) {
        const item = page.getByTestId(testId);
        await expect(item).toBeVisible();
        const itemBox = await item.boundingBox();
        if (!itemBox) {
          throw new Error(`${testId}의 경계 상자를 계산할 수 없습니다.`);
        }
        expect(itemBox.x).toBeGreaterThanOrEqual(hudBox.x - 1);
        expect(itemBox.y).toBeGreaterThanOrEqual(hudBox.y - 1);
        expect(itemBox.x + itemBox.width).toBeLessThanOrEqual(hudBox.x + hudBox.width + 1);
        expect(itemBox.y + itemBox.height).toBeLessThanOrEqual(hudBox.y + hudBox.height + 1);
        hudBoxes.push(itemBox);
      }

      for (let index = 1; index < hudBoxes.length; index += 1) {
        const previous = hudBoxes[index - 1];
        const current = hudBoxes[index];
        expect(previous.x + previous.width).toBeLessThanOrEqual(current.x + 1);
      }

      const documentMetrics = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      expect(documentMetrics.scrollWidth).toBeLessThanOrEqual(documentMetrics.innerWidth);
      expect(documentMetrics.scrollHeight).toBeLessThanOrEqual(documentMetrics.innerHeight);
    });
  }
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
