import { expect, test, type Page } from '@playwright/test';

const RESPONSIVE_VIEWPORTS = [
  { name: '데스크톱', width: 1440, height: 900 },
  { name: '태블릿', width: 1024, height: 768 },
  { name: '모바일 가로', width: 844, height: 390 },
] as const;

const HUD_TEST_IDS = ['hud-hp', 'hud-mana', 'hud-score', 'hud-level'] as const;

interface SkillTraceSample {
  readonly frame: number;
  readonly x: number;
  readonly y: number;
}

async function waitForTestBridge(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__TRICKAL_TEST__ !== undefined)).toBe(true);
}

async function installSkillProjectileCanvasTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('스킬탄 Canvas 추적기를 설치할 수 없습니다.');

    let frame = 0;
    canvas.dataset.skillTrace = '';
    const originalFillRect = ctx.fillRect.bind(ctx);
    ctx.fillRect = (x: number, y: number, width: number, height: number): void => {
      const fillStyle = String(ctx.fillStyle).toLowerCase();
      if (fillStyle === '#222222' && x === 0 && y === 0 && width === 800 && height === 600) {
        frame += 1;
      } else if (fillStyle === '#00ffff') {
        canvas.dataset.skillTrace = `${canvas.dataset.skillTrace ?? ''}${frame},${x},${y};`;
      }
      originalFillRect(x, y, width, height);
    };
  });
}

async function readSkillProjectileCanvasTrace(page: Page): Promise<SkillTraceSample[]> {
  const trace = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    return canvas?.dataset.skillTrace ?? '';
  });

  return trace
    .split(';')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [frame, x, y] = entry.split(',').map(Number);
      if (![frame, x, y].every(Number.isFinite)) {
        throw new Error(`유효하지 않은 스킬탄 Canvas 추적값: ${entry}`);
      }
      return { frame, x, y };
    });
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

  test('키 입력 없이 자동 발사로 적을 처치하면 SCORE와 MANA가 증가한다', async ({ page }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(6));

    await page.evaluate(() => window.__TRICKAL_TEST__?.stepFrames(100));

    await expect(page.getByTestId('hud-score')).toHaveText('SCORE: 10');
    await expect(page.getByTestId('hud-mana')).toHaveText('MANA: 5%');
    await expect(page.getByTestId('hud-hp')).toHaveText('♥ 3 / 3');
  });

  test('Space를 누르면 MANA를 소모해 스킬 발사하고 놓으면 일반 상태 회복을 재개한다', async ({
    page,
  }) => {
    const beforeSkill = await page.evaluate(() => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        window.__TRICKAL_TEST__?.seed(6);
        window.__TRICKAL_TEST__?.stepFrames(100);
        const snapshot = window.__TRICKAL_TEST__?.getSnapshot();
        if (snapshot && snapshot.mana >= 20) return snapshot;
      }
      throw new Error(
        '800틱 안에 실제 자동 발사와 회복으로 스킬 검증용 MANA 20을 확보하지 못했습니다.',
      );
    });

    await page.keyboard.down('Space');
    const duringSkill = await page.evaluate(() => {
      window.__TRICKAL_TEST__?.stepFrames(20);
      return window.__TRICKAL_TEST__?.getSnapshot();
    });
    await page.keyboard.up('Space');

    expect(duringSkill?.mana).toBeLessThan(beforeSkill.mana);
    expect(duringSkill?.mana).toBeGreaterThan(0);

    const afterRelease = await page.evaluate(() => {
      window.__TRICKAL_TEST__?.stepFrames(120);
      return window.__TRICKAL_TEST__?.getSnapshot();
    });
    expect(afterRelease?.mana).toBeGreaterThan(duringSkill?.mana ?? 0);
    await expect(page.getByTestId('hud-mana')).toHaveText(`MANA: ${afterRelease?.mana}%`);
  });

  test('연속 스킬탄이 Y축으로 퍼지고 Canvas에서 완만한 곡선 궤적을 그린다', async ({ page }) => {
    await page.evaluate(() => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        window.__TRICKAL_TEST__?.seed(6);
        window.__TRICKAL_TEST__?.stepFrames(100);
        const snapshot = window.__TRICKAL_TEST__?.getSnapshot();
        if (snapshot && snapshot.mana >= 20) return;
      }
      throw new Error('800틱 안에 Canvas 궤적 검증용 MANA 20을 확보하지 못했습니다.');
    });
    await installSkillProjectileCanvasTrace(page);

    await page.keyboard.down('Space');
    for (let tick = 0; tick < 12; tick += 1) {
      await page.evaluate(async () => {
        window.__TRICKAL_TEST__?.stepFrames(1);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    }
    await page.keyboard.up('Space');

    const samples = await readSkillProjectileCanvasTrace(page);
    const samplesByFrame = new Map<number, SkillTraceSample[]>();
    for (const sample of samples) {
      const frameSamples = samplesByFrame.get(sample.frame) ?? [];
      frameSamples.push(sample);
      samplesByFrame.set(sample.frame, frameSamples);
    }

    const spreadFrame = [...samplesByFrame.values()].find(
      (frameSamples) =>
        frameSamples.length >= 2 &&
        Math.max(...frameSamples.map((sample) => sample.y)) -
          Math.min(...frameSamples.map((sample) => sample.y)) >
          0.1,
    );
    expect(spreadFrame).toBeDefined();

    const leadingPath = [...samplesByFrame.entries()]
      .sort(([frameA], [frameB]) => frameA - frameB)
      .map(([, frameSamples]) =>
        frameSamples.reduce((leading, sample) => (sample.x > leading.x ? sample : leading)),
      )
      .filter(
        (sample, index, path) =>
          index === 0 || sample.x !== path[index - 1].x || sample.y !== path[index - 1].y,
      );
    expect(leadingPath.length).toBeGreaterThanOrEqual(4);

    const slopes = leadingPath.slice(1).map((sample, index) => {
      const previous = leadingPath[index];
      return (sample.y - previous.y) / (sample.x - previous.x);
    });
    expect(
      slopes.some((slope, index) => index > 0 && Math.abs(slope - slopes[index - 1]) > 0.001),
    ).toBe(true);
  });

  test('처치 전 1초간 자연 회복은 HUD 정수 단위를 올리지 않는다', async ({ page }) => {
    await page.evaluate(() => {
      window.__TRICKAL_TEST__?.seed(6);
      window.__TRICKAL_TEST__?.stepFrames(60);
    });

    await expect(page.getByTestId('hud-score')).toHaveText('SCORE: 0');
    await expect(page.getByTestId('hud-mana')).toHaveText('MANA: 0%');
    await expect(page.getByTestId('hud-hp')).toHaveText('♥ 3 / 3');
  });

  test('적들이 왼쪽 경계를 넘어 사라져도 HP가 감소하지 않는다', async ({ page }) => {
    await page.evaluate(() => {
      window.__TRICKAL_TEST__?.seed(5);
      window.__TRICKAL_TEST__?.stepFrames(600);
    });

    await expect(page.getByTestId('hud-hp')).toHaveText('♥ 3 / 3');
    await expect(page.getByTestId('game-over')).toHaveCount(0);

    const snapshot = await page.evaluate(() => window.__TRICKAL_TEST__?.getSnapshot());
    expect(snapshot?.status).toBe('playing');
  });

  test('직접 접촉 피해로 게임오버가 되고 R 키로 초기 상태에 복귀한다', async ({ page }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(6));
    await page.evaluate(() => window.__TRICKAL_TEST__?.stepFrames(6_000));

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
