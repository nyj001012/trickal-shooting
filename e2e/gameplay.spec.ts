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
      const fillStyle = typeof ctx.fillStyle === 'string' ? ctx.fillStyle.toLowerCase() : '';
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

// --- issue #17: 적 8방향 탄막 관측용 헬퍼 -----------------------------------------
//
// `TestBridge`는 world 상태를 직접 노출하지 않으므로(설계상 3개 메서드로 고정,
// design.md §6.9), enemyProjectile의 생성/소멸/속도를 검증하려면 캔버스에 실제로
// 그려지는 모양을 가로채는 수밖에 없다. 위 `installSkillProjectileCanvasTrace`와
// 같은 아이디어이되, enemyProjectile/enemy/player는 `drawEntity.ts`가 원(arc)
// 또는 사각형(rect)으로 그리므로 두 draw 호출을 모두 가로채 색상별로 정규화한
// 사각 바운딩박스(x,y,width,height)를 기록한다.
interface EntityTraceRecord {
  readonly frame: number;
  readonly shape: 'rect' | 'circle';
  readonly color: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function installEntityTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('엔티티 추적기를 설치할 수 없습니다.');

    let frame = 0;
    const records: {
      frame: number;
      shape: 'rect' | 'circle';
      color: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }[] = [];
    // 같은 배열 인스턴스를 계속 `splice`로 비워가며 재사용한다 — 매번 새 배열을
    // `window`에 재할당하면 아래 클로저들은 여전히 옛 배열에 push하게 되어(참조가
    // 갈라짐) 이후 읽기가 항상 빈 배열만 반환하는 문제가 생긴다.
    (window as Window & { __e17Trace?: typeof records }).__e17Trace = records;

    const originalFillRect = ctx.fillRect.bind(ctx);
    ctx.fillRect = (x: number, y: number, width: number, height: number): void => {
      const fillStyle = typeof ctx.fillStyle === 'string' ? ctx.fillStyle.toLowerCase() : '';
      if (fillStyle === '#222222' && x === 0 && y === 0 && width === 800 && height === 600) {
        frame += 1;
      } else {
        records.push({ frame, shape: 'rect', color: fillStyle, x, y, width, height });
      }
      originalFillRect(x, y, width, height);
    };

    const originalArc = ctx.arc.bind(ctx);
    ctx.arc = (
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      counterclockwise?: boolean,
    ): void => {
      const fillStyle = typeof ctx.fillStyle === 'string' ? ctx.fillStyle.toLowerCase() : '';
      records.push({
        frame,
        shape: 'circle',
        color: fillStyle,
        x: x - radius,
        y: y - radius,
        width: radius * 2,
        height: radius * 2,
      });
      originalArc(x, y, radius, startAngle, endAngle, counterclockwise);
    };
  });
}

/** 지금까지 누적된 트레이스를 읽고 동시에 비운다(다음 프레임부터 다시 채워진다). */
async function readEntityTrace(page: Page): Promise<EntityTraceRecord[]> {
  return page.evaluate(() => {
    const traceWindow = window as Window & { __e17Trace?: EntityTraceRecord[] };
    const trace = traceWindow.__e17Trace ?? [];
    return trace.splice(0, trace.length);
  });
}

interface TrackPoint {
  readonly frameIndex: number;
  readonly x: number;
  readonly y: number;
}
interface EntityTrack {
  points: TrackPoint[];
  active: boolean;
}

/**
 * 프레임별 점들을 최근접-이웃 방식으로 이어붙여 개별 투사체의 이동 궤적을
 * 재구성한다. `world` 자체에 접근할 수 없으므로 좌표 연속성만으로 "같은
 * 투사체"를 식별하는 근사치이지만, 한 스텝에 이동 가능한 최대 거리보다 넉넉한
 * `maxStepDistancePx` 임계값을 쓰면 충분히 안정적으로 동작한다(아래 각 테스트의
 * 경험적 튜닝값 참고).
 */
function buildPositionTracks(
  framePoints: ReadonlyArray<ReadonlyArray<{ readonly x: number; readonly y: number }>>,
  maxStepDistancePx: number,
): EntityTrack[] {
  const tracks: EntityTrack[] = [];
  framePoints.forEach((points, frameIndex) => {
    const claimed = new Set<number>();
    for (const track of tracks) {
      if (!track.active) continue;
      const last = track.points[track.points.length - 1];
      let bestIndex = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      points.forEach((point, index) => {
        if (claimed.has(index)) return;
        const distance = Math.hypot(point.x - last.x, point.y - last.y);
        if (distance < maxStepDistancePx && distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      if (bestIndex >= 0) {
        const point = points[bestIndex];
        track.points.push({ frameIndex, x: point.x, y: point.y });
        claimed.add(bestIndex);
      } else {
        track.active = false;
      }
    }
    points.forEach((point, index) => {
      if (claimed.has(index)) return;
      tracks.push({ points: [{ frameIndex, x: point.x, y: point.y }], active: true });
    });
  });
  return tracks;
}

interface BoxLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 두 AABB 사이의 최단 간격(px). 이미 겹쳐 있으면 0. */
function boxGapPx(a: BoxLike, b: BoxLike): number {
  const dx = Math.max(0, Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)));
  const dy = Math.max(0, Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)));
  return Math.hypot(dx, dy);
}

function minGapToColor(playerBox: BoxLike, trace: readonly EntityTraceRecord[], color: string): number {
  const boxes = trace.filter((record) => record.shape === 'circle' && record.color === color);
  if (boxes.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(...boxes.map((box) => boxGapPx(playerBox, box)));
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

  test('연속 스킬탄이 Y축으로 퍼지고 Canvas에서 공전 없이 곡선으로 전진한다', async ({ page }) => {
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

    const xDeltas = leadingPath.slice(1).map((sample, index) => sample.x - leadingPath[index].x);
    expect(xDeltas.every((delta) => delta > 0)).toBe(true);

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

test.describe('적 8방향 탄막 (issue #17)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?e2e=1');
    await waitForTestBridge(page);
  });

  test('결정적 시드로 충분히 틱을 진행시키면 적 투사체(enemyProjectile)가 최소 1개 생성된다', async ({
    page,
  }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(1));
    await installEntityTrace(page);

    let sawEnemyProjectile = false;
    for (let attempt = 0; attempt < 40 && !sawEnemyProjectile; attempt += 1) {
      await page.evaluate(async () => {
        window.__TRICKAL_TEST__?.stepFrames(20);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const trace = await readEntityTrace(page);
      sawEnemyProjectile = trace.some((record) => record.shape === 'circle' && record.color === '#ff8c00');
    }

    expect(sawEnemyProjectile).toBe(true);
  });

  test('화면 상하좌우 경계를 완전히 벗어난 적 투사체는 world에서 제거되어 더 이상 그려지지 않는다', async ({
    page,
  }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(1));
    await installEntityTrace(page);

    // enemyProjectile은 8방향 임의 이동이라 좌우로만 이탈하는 regularProjectile과
    // 달리 4변 어디로든 나갈 수 있다(INV-EPROJ-3). 5틱 단위로 계속 렌더링하며
    // 원(circle)의 중심 좌표를 모아, 같은 투사체의 궤적이 화면 경계 근처에서
    // 끊기는지 확인한다.
    const framePoints: { x: number; y: number }[][] = [];
    for (let i = 0; i < 220; i += 1) {
      await page.evaluate(async () => {
        window.__TRICKAL_TEST__?.stepFrames(5);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const trace = await readEntityTrace(page);
      const points = trace
        .filter((record) => record.shape === 'circle' && record.color === '#ff8c00')
        .map((record) => ({ x: record.x + record.width / 2, y: record.y + record.height / 2 }));
      framePoints.push(points);
    }

    // 5틱(약 83ms) 사이 최대 이동 거리(speedMax 300px/sec 기준 약 25px)에 여유를
    // 더한 값. 경계 판정도 같은 폭의 여유를 두어, 샘플링 간격 사이에서 실제로
    // 경계를 넘은 프레임을 놓치더라도 "경계 근처에서 사라졌다"는 사실은 잡아낸다.
    const MAX_STEP_DISTANCE_PX = 60;
    const BOUNDARY_MARGIN_PX = 60;
    const tracks = buildPositionTracks(framePoints, MAX_STEP_DISTANCE_PX);
    const terminatedTracks = tracks.filter((track) => !track.active && track.points.length >= 2);

    expect(tracks.length).toBeGreaterThan(0);

    const exitedNearBoundary = terminatedTracks.some((track) => {
      const last = track.points[track.points.length - 1];
      return (
        last.x < BOUNDARY_MARGIN_PX ||
        last.x > 800 - BOUNDARY_MARGIN_PX ||
        last.y < BOUNDARY_MARGIN_PX ||
        last.y > 600 - BOUNDARY_MARGIN_PX
      );
    });
    expect(exitedNearBoundary).toBe(true);
  });

  test('레벨업 이후에도 레벨업 이전부터 날아가던 적 투사체의 속도는 변하지 않는다', async ({ page }) => {
    test.setTimeout(120_000);

    // 회귀 확인(issue #17 요구사항 1): Enemy.projSpeed는 스폰 시점 스냅샷이라
    // 레벨업으로 변하지 않는다(INV-EPROJ-1). 플레이어를 상하로 스윕시켜
    // regularProjectile 자동사격 사거리를 넓히면(회피이자 학살 전략, 치트 아님)
    // 실제 킬 스코어가 빠르게 쌓여 레벨업까지 걸리는 시간을 단축할 수 있다.
    const candidateSeeds = [1, 2, 4, 5];
    let speedRatio: number | undefined;

    for (const candidateSeed of candidateSeeds) {
      await page.goto('/?e2e=1');
      await waitForTestBridge(page);
      await page.evaluate((value) => window.__TRICKAL_TEST__?.seed(value), candidateSeed);
      await installEntityTrace(page);

      // Phase 1: 렌더링이 필요 없는 구간은 stepFrames만으로 저비용으로 빠르게
      // 진행시켜, 레벨업 임계값(level*100점) 근처까지 다가간다.
      let goingUp = true;
      let snapshot = await page.evaluate(() => window.__TRICKAL_TEST__?.getSnapshot());
      for (let sweep = 0; sweep < 60; sweep += 1) {
        const key = goingUp ? 'ArrowUp' : 'ArrowDown';
        await page.keyboard.down(key);
        snapshot = await page.evaluate(() => {
          window.__TRICKAL_TEST__?.stepFrames(150);
          return window.__TRICKAL_TEST__?.getSnapshot();
        });
        await page.keyboard.up(key);
        goingUp = !goingUp;
        if (!snapshot || snapshot.status !== 'playing') break;
        if (snapshot.score >= snapshot.level * 100 - 20) break;
      }
      if (!snapshot || snapshot.status !== 'playing') continue;

      // Phase 2: 레벨업 전환 구간을 촘촘히(8틱 단위) 렌더링하며 추적한다.
      const framePoints: { level: number; points: { x: number; y: number }[] }[] = [];
      for (let i = 0; i < 150; i += 1) {
        const key = goingUp ? 'ArrowUp' : 'ArrowDown';
        if (i % 15 === 0) await page.keyboard.down(key);
        if (i % 15 === 14) {
          await page.keyboard.up(key);
          goingUp = !goingUp;
        }
        const stepSnapshot = await page.evaluate(async () => {
          window.__TRICKAL_TEST__?.stepFrames(8);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return window.__TRICKAL_TEST__?.getSnapshot();
        });
        const trace = await readEntityTrace(page);
        const points = trace
          .filter((record) => record.shape === 'circle' && record.color === '#ff8c00')
          .map((record) => ({ x: record.x + record.width / 2, y: record.y + record.height / 2 }));
        if (!stepSnapshot) break;
        framePoints.push({ level: stepSnapshot.level, points });
        if (stepSnapshot.status !== 'playing') break;
      }

      const tracks = buildPositionTracks(
        framePoints.map((frame) => frame.points),
        60,
      );

      for (const track of tracks) {
        if (track.points.length < 3) continue;
        const levelsInTrack = new Set(track.points.map((point) => framePoints[point.frameIndex].level));
        if (levelsInTrack.size < 2) continue;

        // 같은 레벨 구간 안에서만 스텝 간 이동 거리를 모아 평균 낸다 — 레벨 전환이
        // 걸친 스텝 자체는 계산에서 제외해 "레벨 전/후 각각의 순수한 속도"만 비교한다.
        const distancesByLevel = new Map<number, number[]>();
        for (let k = 1; k < track.points.length; k += 1) {
          const previous = track.points[k - 1];
          const current = track.points[k];
          const previousLevel = framePoints[previous.frameIndex].level;
          const currentLevel = framePoints[current.frameIndex].level;
          if (previousLevel !== currentLevel) continue;
          const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
          const bucket = distancesByLevel.get(previousLevel) ?? [];
          bucket.push(distance);
          distancesByLevel.set(previousLevel, bucket);
        }
        const levelKeys = [...distancesByLevel.keys()].sort((a, b) => a - b);
        if (levelKeys.length < 2) continue;
        const firstLevelDistances = distancesByLevel.get(levelKeys[0]) ?? [];
        const lastLevelDistances = distancesByLevel.get(levelKeys[levelKeys.length - 1]) ?? [];
        if (firstLevelDistances.length === 0 || lastLevelDistances.length === 0) continue;

        const average = (values: number[]): number =>
          values.reduce((sum, value) => sum + value, 0) / values.length;
        speedRatio = average(lastLevelDistances) / average(firstLevelDistances);
        break;
      }

      if (speedRatio !== undefined) break;
    }

    if (speedRatio === undefined) {
      throw new Error(
        '레벨업 전후 구간에 걸쳐 같은 적 투사체의 궤적을 추적하지 못했습니다(모든 후보 시드 소진).',
      );
    }
    // 속도가 그대로라면 레벨 전/후 평균 스텝 거리 비율은 1에 가까워야 한다.
    // 실제로 재계산되어 커졌다면(회귀) 최소 6.7%(레벨2) 이상 벌어지므로,
    // 샘플링 잡음을 감안해도 충분히 좁은 허용 범위로 구분 가능하다.
    expect(speedRatio).toBeGreaterThan(0.75);
    expect(speedRatio).toBeLessThan(1.3);
  });

  test('적 투사체가 플레이어와 겹치면 플레이어 HP가 감소한다', async ({ page }) => {
    test.setTimeout(90_000);

    // 직접 접촉(contact)과 적 투사체 피격은 같은 무적시간을 공유하고 동일한 피해량
    // (각 1)을 주므로, HP가 줄어든 "원인"을 구분하려면 그 순간 플레이어 박스에
    // 어떤 종류(초록 enemy vs 주황 enemyProjectile)가 실제로 가장 가까웠는지를
    // 봐야 한다. 충돌 처리 틱에는 가해 엔티티가 그 즉시 배열에서 제거되어(같은 틱
    // 말미 sweep) 정확히 겹친 순간은 렌더링되지 않으므로, "충돌 직전 프레임에서
    // 어느 쪽이 압도적으로 더 가까웠는가"로 원인을 판별한다.
    const candidateSeeds = [3, 1, 4];
    const MAX_ITERATIONS_PER_SEED = 750;
    let hpDropObserved = false;
    let attributedToProjectile = false;

    for (const candidateSeed of candidateSeeds) {
      await page.goto('/?e2e=1');
      await waitForTestBridge(page);
      await page.evaluate((value) => window.__TRICKAL_TEST__?.seed(value), candidateSeed);
      await installEntityTrace(page);

      let previousHp = 3;
      let previousTrace: EntityTraceRecord[] = [];
      for (let i = 0; i < MAX_ITERATIONS_PER_SEED; i += 1) {
        // 여기서는 의도적으로 stepFrames를 호출하지 않는다 — 실제 화면에 그려지는
        // 시점(rAF)과 정확히 같은 틱의 world 상태만 관찰해야, 피격 직전 프레임의
        // 위치가 "그 스텝에서 실제로 그려졌던" 좌표와 어긋나지 않는다.
        const snapshot = await page.evaluate(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return window.__TRICKAL_TEST__?.getSnapshot();
        });
        const trace = await readEntityTrace(page);

        if (snapshot && snapshot.hp < previousHp) {
          hpDropObserved = true;
          const playerBox = previousTrace.find(
            (record) => record.shape === 'rect' && (record.color === '#ffb6c1' || record.color === '#ff4d4d'),
          );
          if (playerBox) {
            const greenGapPx = minGapToColor(playerBox, previousTrace, '#90ee90');
            const orangeGapPx = minGapToColor(playerBox, previousTrace, '#ff8c00');
            if (orangeGapPx < 10 && orangeGapPx < greenGapPx) {
              attributedToProjectile = true;
            }
          }
          previousHp = snapshot.hp;
        }
        previousTrace = trace;

        if (attributedToProjectile) break;
        if (!snapshot || snapshot.status !== 'playing') break;
      }

      if (attributedToProjectile) break;
    }

    expect(hpDropObserved).toBe(true);
    expect(attributedToProjectile).toBe(true);
  });
});
