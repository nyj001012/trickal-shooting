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

// --- issue #21: 회복 젤리(healingItem) 관측용 오토파일럿 -------------------------------
//
// TestBridge는 3개 메서드로 고정되어 있어(design.md §6.9) world의 healingItems 배열을
// 직접 조회할 수 없다. 대신 실제 플레이어가 할 법한 입력(상하좌우 이동 + Space 스킬)만
// 스크립트로 대신 눌러, "치트 없이 순수 게임플레이로" 젤리 드롭·획득을 재현한다.
// 드롭(INV-ITEM-1)은 일반탄/스킬탄 처치에서만 10% 확률로 발생하므로, farm 모드는 근접한
// 적을 회피하면서(오인 접촉 최소화) MANA가 충분하면 스킬을 태워 처치 수를 늘린다.
// 젤리가 화면에 보이면 seek 모드로 전환해 그 중심을 향해 이동한다.
const HEALING_ITEM_COLOR = '#87ceeb';
const ENEMY_COLOR = '#90ee90';
const PLAYER_COLORS = new Set(['#ffb6c1', '#ff4d4d']);
const HEALING_ITEM_DANGER_RADIUS_PX = 90;

interface AutopilotSnapshot {
  readonly hp: number;
  readonly score: number;
  readonly mana: number;
  readonly status: string;
}

interface AutopilotKeyState {
  mode: 'farm' | 'seek';
  upDown?: 'ArrowUp' | 'ArrowDown';
  leftRight?: 'ArrowLeft' | 'ArrowRight';
  spaceDown: boolean;
}

async function setHeldKey(page: Page, current: string | undefined, desired: string | undefined): Promise<void> {
  if (current === desired) return;
  if (current) await page.keyboard.up(current);
  if (desired) await page.keyboard.down(desired);
}

/**
 * 한 오토파일럿 스텝을 수행한다: 직전에 읽은 트레이스로 이동 방향/스킬 여부를 결정하고,
 * 실제 키 입력을 갱신한 뒤 정확히 `stepTicks`틱만큼 시뮬레이션을 진행하고 1프레임
 * 렌더링해 그 결과(엔티티 위치 + HUD 스냅샷)를 반환한다. 호출자는 반환된 `items`로
 * 원하는 종료 조건(드롭 관측, 소지, 회복/보너스 발생)을 직접 판단한다.
 */
async function stepHealingItemAutopilot(
  page: Page,
  trace: readonly EntityTraceRecord[],
  keyState: AutopilotKeyState,
  lastMana: number,
  stepTicks: { farm: number; seek: number },
): Promise<{
  snapshot: AutopilotSnapshot | undefined;
  items: BoxLike[];
  enemies: BoxLike[];
  player: BoxLike | undefined;
}> {
  const enemies = trace.filter((record) => record.shape === 'circle' && record.color === ENEMY_COLOR);
  const player = trace.find((record) => record.shape === 'rect' && PLAYER_COLORS.has(record.color));
  const items = trace.filter((record) => record.color === HEALING_ITEM_COLOR);

  if (items.length > 0 && keyState.mode === 'farm') keyState.mode = 'seek';
  if (items.length === 0 && keyState.mode === 'seek') keyState.mode = 'farm';

  let desiredUpDown: 'ArrowUp' | 'ArrowDown' | undefined;
  let desiredLeftRight: 'ArrowLeft' | 'ArrowRight' | undefined;

  if (keyState.mode === 'seek' && player && items.length > 0) {
    const target = items[0];
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    const dx = targetCenterX - playerCenterX;
    const dy = targetCenterY - playerCenterY;
    if (dx > 3) desiredLeftRight = 'ArrowRight';
    else if (dx < -3) desiredLeftRight = 'ArrowLeft';
    if (dy > 3) desiredUpDown = 'ArrowDown';
    else if (dy < -3) desiredUpDown = 'ArrowUp';
  } else if (keyState.mode === 'farm' && player) {
    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;
    const threats = enemies.filter(
      (enemy) =>
        Math.hypot(
          enemy.x + enemy.width / 2 - playerCenterX,
          enemy.y + enemy.height / 2 - playerCenterY,
        ) < HEALING_ITEM_DANGER_RADIUS_PX,
    );
    if (threats.length > 0) {
      const averageThreatY =
        threats.reduce((sum, enemy) => sum + enemy.y + enemy.height / 2, 0) / threats.length;
      desiredUpDown = averageThreatY < playerCenterY ? 'ArrowDown' : 'ArrowUp';
    }
  }

  await setHeldKey(page, keyState.upDown, desiredUpDown);
  keyState.upDown = desiredUpDown;
  await setHeldKey(page, keyState.leftRight, desiredLeftRight);
  keyState.leftRight = desiredLeftRight;

  if (!keyState.spaceDown && lastMana >= 20 && keyState.mode === 'farm') {
    await page.keyboard.down('Space');
    keyState.spaceDown = true;
  } else if (keyState.spaceDown && (lastMana <= 0 || keyState.mode === 'seek')) {
    await page.keyboard.up('Space');
    keyState.spaceDown = false;
  }

  const ticks = keyState.mode === 'seek' ? stepTicks.seek : stepTicks.farm;
  const snapshot = await page.evaluate(async (tickCount) => {
    window.__TRICKAL_TEST__?.stepFrames(tickCount);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const bridgeSnapshot = window.__TRICKAL_TEST__?.getSnapshot();
    return bridgeSnapshot
      ? {
          hp: bridgeSnapshot.hp,
          score: bridgeSnapshot.score,
          mana: bridgeSnapshot.mana,
          status: bridgeSnapshot.status,
        }
      : undefined;
  }, ticks);

  return { snapshot, items, enemies, player };
}

/** 오토파일럿 종료 시 눌려 있는 키를 전부 해제한다(다음 테스트로 상태가 새지 않도록). */
async function releaseAutopilotKeys(page: Page, keyState: AutopilotKeyState): Promise<void> {
  if (keyState.upDown) await page.keyboard.up(keyState.upDown);
  if (keyState.leftRight) await page.keyboard.up(keyState.leftRight);
  if (keyState.spaceDown) await page.keyboard.up('Space');
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
    test.setTimeout(150_000);

    // 직접 접촉(contact)과 적 투사체 피격은 같은 무적시간을 공유하고 동일한 피해량
    // (각 1)을 주므로, HP가 줄어든 "원인"을 구분하려면 그 순간 플레이어 박스에
    // 어떤 종류(초록 enemy vs 주황 enemyProjectile)가 실제로 가장 가까웠는지를
    // 봐야 한다. 충돌 처리 틱에는 가해 엔티티가 그 즉시 배열에서 제거되어(같은 틱
    // 말미 sweep) 정확히 겹친 순간은 렌더링되지 않으므로, "충돌 직전 프레임에서
    // 어느 쪽이 압도적으로 더 가까웠는가"로 원인을 판별한다.
    //
    // issue #19 회귀 노트: 이전 후보 시드 [3,1,4] × 750회 예산은 "적이 등속
    // -x로만 직진"하던 구 동작을 전제로 튜닝되어 있었다. #19로 적 이동이
    // DASH(무작위 8/4방향, 순간 등속 120px/sec이지만 방향별 순net 좌측 성분은
    // 평균 0에 수렴)/OSCILLATE·CIRCLE(좌측 드리프트 각 40px/sec)를 균등 확률로
    // 오가게 되면서, 세 행동을 평균한 순 좌측 접근 속도가 대략 (0+40+40)/3 ≈
    // 27px/sec로 옛 등속(120px/sec)의 1/4 수준까지 떨어졌다 — 옛 예산(750회
    // ≈ 12.5초)으로는 화면 전체를 가로지르기는커녕 적 투사체 사거리(초기
    // fireIntervalBase/기본 speedBase·lifetimeSec 기준 약 450px) 안쪽까지도
    // 못 들어오는 경우가 흔해져, 세 시드 모두 예산 안에 HP 하락 자체가 전혀
    // 관측되지 않았다(`hpDropObserved`부터 false — 실측 확인됨).
    //
    // 아래 5개 후보 시드는 프로덕션과 동일한 시스템 파이프라인(`fireWeapon` →
    // `fireEnemyProjectiles` → `applyMovement` → `spawnTick` → `updateEnemyAi` →
    // `detectCollisions` → `applyCombat` → `applyProgression`, stepWorld.ts와
    // 동일 순서)을 Node에서 직접 결정적으로 재생해 "해당 시드에서 플레이어의
    // 첫 HP 하락이 정확히 몇 번째 틱에, enemyProjectile 겹침만으로(직접 접촉
    // 없이) 발생하는가"를 사전 계산해 얻었다(도구: 임시 스크립트, 결과는 커밋
    // 대상 아님). 각 시드의 첫 HP 하락 틱: 36→674, 35→803(계측상 804), 8→836
    // (계측상 837), 40→971, 49→1074 — 전부 원인이 enemyProjectile 단독이다.
    // 실측으로 "1 rAF 반복 ≈ 1 고정 틱"임도 별도로 검증했다(오차 0~1틱).
    // `MAX_ITERATIONS_PER_SEED`는 이 중 가장 늦은 시드(49, 1074틱) 대비 넉넉한
    // 여유(약 1.4배)를 두어 750 → 1500으로 올린다. 실제로는 목록의 첫 시드
    // (36)에서 약 674회 만에 통과할 것으로 예상되며, 5개 시드를 모두 소진하는
    // 경로는 회귀가 없는 한 발생하지 않는다.
    const candidateSeeds = [36, 35, 8, 40, 49];
    const MAX_ITERATIONS_PER_SEED = 1500;
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

test.describe('적 AI 이동 패턴: DASH/OSCILLATE/CIRCLE (issue #19)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?e2e=1');
    await waitForTestBridge(page);
  });

  // 세 시나리오 모두 `installEntityTrace`/`readEntityTrace`/`buildPositionTracks`(issue #17에서
  // 도입)를 그대로 재사용한다. enemy는 `drawEntity.ts`에서 색상 `#90ee90`의 원(circle)으로
  // 그려지므로(design.md §6.7 RENDER_TABLE), 그 색으로 필터링해 중심 좌표를 추출한다.
  // world 상태를 직접 노출하지 않는 3-메서드 TestBridge(design.md §6.9) 제약상, 행동 종류
  // (dash/oscillate/circle) 자체를 직접 조회할 수는 없다 — 대신 눈에 보이는 궤적의 기하학적
  // 성질(y축 오르내림, x 방향 전환)만으로 "단순 좌측 등속 이동이 아님"을 판별한다.

  test('결정적 시드로 스폰 직후 적이 단순 좌측 등속 이동이 아니라 y축 변화 또는 방향 전환을 보인다', async ({
    page,
  }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(1));
    await installEntityTrace(page);

    const framePoints: { x: number; y: number }[][] = [];
    for (let i = 0; i < 260; i += 1) {
      await page.evaluate(async () => {
        window.__TRICKAL_TEST__?.stepFrames(2);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const trace = await readEntityTrace(page);
      const points = trace
        .filter((record) => record.shape === 'circle' && record.color === '#90ee90')
        .map((record) => ({ x: record.x + record.width / 2, y: record.y + record.height / 2 }));
      framePoints.push(points);
    }

    // 이 저장소의 다른 궤적 추적 테스트들과 동일한 단위(레벨1 이동 속도 규모 대비 충분히
    // 넉넉한 여유)로 튜닝한 임계값. 실측: seed=1에서 이 임계값으로 최소 3개 트랙이
    // 100 포인트 이상 이어지며 스윙/방향전환을 모두 보인다.
    const MAX_STEP_DISTANCE_PX = 40;
    const tracks = buildPositionTracks(framePoints, MAX_STEP_DISTANCE_PX);
    expect(tracks.length).toBeGreaterThan(0);

    const MIN_TRACK_POINTS = 6;
    const MIN_Y_RANGE_PX = 15;

    const showsVerticalSwing = tracks.some((track) => {
      if (track.points.length < MIN_TRACK_POINTS) return false;
      const ys = track.points.map((point) => point.y);
      const range = Math.max(...ys) - Math.min(...ys);
      if (range < MIN_Y_RANGE_PX) return false;
      let increased = false;
      let decreased = false;
      for (let i = 1; i < ys.length; i += 1) {
        if (ys[i] - ys[i - 1] > 0.5) increased = true;
        if (ys[i] - ys[i - 1] < -0.5) decreased = true;
      }
      return increased && decreased;
    });

    const showsDirectionReversal = tracks.some((track) => {
      if (track.points.length < MIN_TRACK_POINTS) return false;
      const dxs = track.points.slice(1).map((point, i) => point.x - track.points[i].x);
      const signs = dxs.filter((dx) => Math.abs(dx) > 0.5).map((dx) => Math.sign(dx));
      return signs.some((sign) => sign > 0) && signs.some((sign) => sign < 0);
    });

    // OSCILLATE는 y축 사인파로 오르내리고(swing), CIRCLE은 궤도를 도는 동안 로컬 x 진행
    // 방향이 주기적으로 뒤집힌다(reversal) — 이 반전은 궤도 운동 자체의 기하학적 성질일
    // 뿐, 스폰 이후 행동이 다시 선택되는 일이 없는 현재 계약(issue #19 개정,
    // `Enemy.actionInitialized`로 스폰 시 1회만 선택·고정, invariants.md INV-EAI-1)과는
    // 무관하다. 개정 전 "항상 -x로만 이동"하는 단순 등속 이동이었다면 어느 쪽도 관측될
    // 수 없다.
    expect(showsVerticalSwing || showsDirectionReversal).toBe(true);
  });

  test('적은 화면 상하 경계를 넘지 않고(y 클램프), 클램프가 실제로 작동한다', async ({ page }) => {
    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(1));
    await installEntityTrace(page);

    let minTopPx = Number.POSITIVE_INFINITY;
    let maxBottomPx = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < 260; i += 1) {
      await page.evaluate(async () => {
        window.__TRICKAL_TEST__?.stepFrames(2);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const trace = await readEntityTrace(page);
      for (const record of trace) {
        if (record.shape !== 'circle' || record.color !== '#90ee90') continue;
        minTopPx = Math.min(minTopPx, record.y);
        maxBottomPx = Math.max(maxBottomPx, record.y + record.height);
      }
    }

    expect(Number.isFinite(minTopPx)).toBe(true);
    // INV-EAI-5: 어떤 틱에서도 적 AABB는 [0, 600] y범위를 벗어나지 않는다(상단 y>=0,
    // 하단 y+height<=600). 렌더링/부동소수 오차를 감안해 1px 여유를 둔다.
    expect(minTopPx).toBeGreaterThanOrEqual(-1);
    expect(maxBottomPx).toBeLessThanOrEqual(601);

    // 클램프가 "우연히 한 번도 경계 근처에 가지 않아서 통과"하는 위양성을 막기 위해,
    // 실제로 경계에 근접(또는 정확히 도달)했는지도 함께 확인한다. seed=1 실측상 하단
    // 경계(y+height===600)에 정확히 도달한다.
    expect(maxBottomPx).toBeGreaterThanOrEqual(595);
  });

  test('화면 왼쪽으로 완전히 벗어난 적은 소멸해 더 이상 그려지지 않는다', async ({ page }) => {
    test.setTimeout(60_000);

    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(1));
    await installEntityTrace(page);

    // OSCILLATE/CIRCLE의 좌측 드리프트(40px/sec)는 DASH-왼쪽(120px/sec)보다 느리므로,
    // 최소 1개체가 화면을 완전히 벗어나는 것을 관측하려면 issue #17의 투사체 이탈
    // 테스트보다 훨씬 긴 시뮬레이션 시간이 필요하다. 렌더링 없이 대량 tick만 진행하는
    // 구간(`stepFrames`)과 소량의 렌더링 관측 구간을 번갈아 반복해 비용을 낮춘다.
    const framePoints: { x: number; y: number }[][] = [];
    for (let i = 0; i < 130; i += 1) {
      await page.evaluate(async () => {
        window.__TRICKAL_TEST__?.stepFrames(25);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
      const trace = await readEntityTrace(page);
      const points = trace
        .filter((record) => record.shape === 'circle' && record.color === '#90ee90')
        .map((record) => ({ x: record.x + record.width / 2, y: record.y + record.height / 2 }));
      framePoints.push(points);
    }

    // 25틱(약 0.42초) 사이 최대 이동 거리(DASH 속도 120px/sec 기준 약 50px, 실측 오차
    // 포함)에 여유를 더한 값.
    const MAX_STEP_DISTANCE_PX = 150;
    const tracks = buildPositionTracks(framePoints, MAX_STEP_DISTANCE_PX);
    expect(tracks.length).toBeGreaterThan(0);

    const LEFT_EXIT_MARGIN_PX = 50;
    const terminatedTracks = tracks.filter((track) => !track.active && track.points.length >= 2);
    const exitedLeft = terminatedTracks.some((track) => {
      const last = track.points[track.points.length - 1];
      return last.x <= LEFT_EXIT_MARGIN_PX;
    });

    expect(terminatedTracks.length).toBeGreaterThan(0);
    expect(exitedLeft).toBe(true);
  });

  test('DASH 방향 정정 이후에도 적이 화면 오른쪽 가장자리에 y까지 고정된 채 영구 고착되지 않는다', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // 회귀 배경(issue #19 후속, 2026-08-28): 정정 전 DASH는 기본(저)레벨에서 4방향 후보
    // [0,2,4,6](우/하/좌/상)을 균등 확률로 골랐다. 좌측 성분이 없는 우/하/상이 뽑히면
    // `applyMovement`의 `enemy.x = Math.min(enemy.x, bounds.width - enemy.width)` 클램프가
    // 스폰 즉시 x를 772로 고정하고, dashVx가 0(순수 상/하) 또는 양수(우)라서 x가 다시는
    // 줄지 않는다. 순수 상/하 방향은 y마저 상하 경계(0 또는 572)에 부딪히면 dashVx/dashVy가
    // 다시 계산되지 않는 계약(actionInitialized 1회 고정, INV-EAI-1)상 (x,y) 모두가 그 프레임에
    // 영원히 멈춘다 — 사용자가 보고한 "맵 오른쪽 위/아래에 병목처럼 멈춰있는 적들"의 정체다.
    // 이 버그는 dashOctoDirectionLevel(=11) 미만, 즉 게임 시작 직후의 기본 레벨(1)에서부터
    // 이미 발생했다 — 별도로 레벨을 올릴 필요 없이 기본 플레이만으로 재현/검증 가능하다.
    // 정정 후에는 저레벨에서 rng를 소비하지 않고 항상 서(180deg, table index 4)로 고정되므로
    // dashVx는 항상 음수이고, OSCILLATE/CIRCLE도 항상 좌측으로 드리프트하므로(각 40px/sec)
    // 세 행동 모두 이 클램프 지점에 영구 고착될 수 없다.
    const candidateSeeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // 위 탐색적 실측(플레이어 무입력, 자동사격만)상 모든 후보 시드가 최소 1000틱(16.7초)
    // 동안은 status: 'playing'을 유지한다. 800틱(13.3초)까지만 관측해 안전 여유를 둔다.
    const TICKS_PER_SAMPLE = 20;
    const SAMPLES_PER_SEED = 40; // 40 * 20 = 800 ticks ≈ 13.3s
    const MAX_STEP_DISTANCE_PX = 150; // 이 파일의 다른 궤적 추적 테스트와 동일한 여유
    const RIGHT_EDGE_THRESHOLD_PX = 750; // bounds.width(800) - enemy.width(28) - 여유(22)
    const STUCK_EPS_PX = 2; // 부동소수/렌더 오차 여유
    const STUCK_MIN_CONSECUTIVE_POINTS = 5; // 4 * ~0.33s ≈ 1.3초 이상 완전히 정지

    interface StuckFinding {
      readonly seed: number;
      readonly points: readonly TrackPoint[];
    }

    function findStuckNearRightEdge(
      tracks: readonly EntityTrack[],
    ): StuckFinding['points'] | undefined {
      for (const track of tracks) {
        for (
          let start = 0;
          start + STUCK_MIN_CONSECUTIVE_POINTS <= track.points.length;
          start += 1
        ) {
          const window = track.points.slice(start, start + STUCK_MIN_CONSECUTIVE_POINTS);
          const xs = window.map((point) => point.x);
          const ys = window.map((point) => point.y);
          const xRange = Math.max(...xs) - Math.min(...xs);
          const yRange = Math.max(...ys) - Math.min(...ys);
          const allNearRightEdge = xs.every((x) => x >= RIGHT_EDGE_THRESHOLD_PX);
          if (xRange < STUCK_EPS_PX && yRange < STUCK_EPS_PX && allNearRightEdge) {
            return window;
          }
        }
      }
      return undefined;
    }

    let stuckFinding: StuckFinding | undefined;
    let sawNearSpawnActivity = false;
    let totalTrackedPoints = 0;

    for (const candidateSeed of candidateSeeds) {
      await page.goto('/?e2e=1');
      await waitForTestBridge(page);
      await page.evaluate((value) => window.__TRICKAL_TEST__?.seed(value), candidateSeed);
      await installEntityTrace(page);

      const framePoints: { x: number; y: number }[][] = [];
      for (let i = 0; i < SAMPLES_PER_SEED; i += 1) {
        const snapshot = await page.evaluate(async (ticks) => {
          window.__TRICKAL_TEST__?.stepFrames(ticks);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return window.__TRICKAL_TEST__?.getSnapshot();
        }, TICKS_PER_SAMPLE);
        const trace = await readEntityTrace(page);
        const points = trace
          .filter((record) => record.shape === 'circle' && record.color === '#90ee90')
          .map((record) => ({ x: record.x + record.width / 2, y: record.y + record.height / 2 }));
        framePoints.push(points);
        if (!snapshot || snapshot.status !== 'playing') break;
      }

      const tracks = buildPositionTracks(framePoints, MAX_STEP_DISTANCE_PX);
      totalTrackedPoints += tracks.reduce((sum, track) => sum + track.points.length, 0);
      if (tracks.some((track) => track.points.some((point) => point.x >= 700))) {
        sawNearSpawnActivity = true;
      }

      const stuckWindow = findStuckNearRightEdge(tracks);
      if (stuckWindow) {
        stuckFinding = { seed: candidateSeed, points: stuckWindow };
        break;
      }
    }

    if (stuckFinding) {
      throw new Error(
        `seed=${stuckFinding.seed}에서 적이 화면 오른쪽 가장자리 근처(x>=${RIGHT_EDGE_THRESHOLD_PX})에 ` +
          `${STUCK_MIN_CONSECUTIVE_POINTS}개 연속 샘플 이상 (x,y) 변화 없이 고착되었습니다: ` +
          JSON.stringify(stuckFinding.points),
      );
    }

    // 위양성 방지: 최소한 관측이 스폰 지점(x=800이 클램프된 772 부근) 근처의 실제 활동을
    // 포착했는지 확인한다 — 그렇지 않다면 "고착이 없었다"는 결과가 애초에 그 구간을 전혀
    // 관측하지 못해서 생긴 무의미한 통과일 수 있다.
    expect(sawNearSpawnActivity).toBe(true);
    expect(totalTrackedPoints).toBeGreaterThan(0);
  });
});

test.describe('회복 젤리 드롭·이동·획득 (issue #21)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?e2e=1');
    await waitForTestBridge(page);
  });

  // 아래 세 시나리오 모두 TestBridge의 seed()로 결정적 초기 상태를 고정한 뒤, 매 스텝마다
  // 캔버스 트레이스만 보고 실제 방향키/Space를 대신 눌러주는 "오토파일럿"으로 오직 정상적인
  // 플레이 입력(회피 이동 + 자동 일반탄 + 스킬)만으로 드롭·획득을 재현한다(TestBridge에 젤리를
  // 직접 주입하는 치트 경로는 없다 — design.md §6.9). seed=2/3은 이 저장소 환경(webServer가
  // 구동한 프로덕션 빌드, 결정적 rng, 실제 키보드 이벤트)에서 반복 실행해도 동일한 결과를
  // 내는 것을 사전에 확인했다(로컬 6/6 재현) — 반면 "적을 향해 일부러 다가가 접촉시키는"
  // 방식은 실제 키 이벤트 디스패치의 미세한 실시간 타이밍에 결과가 갈리는 것을 확인해
  // (동일 스크립트·동일 seed로도 성공/게임오버가 뒤섞임) 채택하지 않았다. 이 세 시나리오의
  // "체력 감소"는 실제 플레이에서 벌어지는 두 합법적 피해 경로(직접 접촉 또는 적 투사체
  // 피격) 중 하나이며, 어느 쪽이든 INV-ITEM-3(젤리 획득 시 회복/보너스)의 전제 조건인
  // "hp < maxHp" 상태를 동일하게 만족한다.

  test('적 처치로 드롭된 회복 젤리가 하늘색 사각형으로 렌더링되고 생성된 위치에 고정된다', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // INV-ITEM-2(전면 개정): 젤리는 더 이상 이동하지 않고 스폰 좌표에 영구 고정된다.
    // 따라서 이 시나리오는 의도적으로 젤리를 쫓지 않는다(seek 전환 없이 근접 적 회피만
    // 수행) — 자동으로 주워버리면 "이동하지 않는다"를 여러 프레임에 걸쳐 표본화하기 전에
    // 젤리가 사라진다. 방치된 채로도 INV-ITEM-2가 성립하는지만 확인한다.
    const candidateSeeds = [3, 2, 1];
    let sampledPoints: { x: number; y: number }[] = [];

    for (const candidateSeed of candidateSeeds) {
      await page.goto('/?e2e=1');
      await waitForTestBridge(page);
      await page.evaluate((value) => window.__TRICKAL_TEST__?.seed(value), candidateSeed);
      await installEntityTrace(page);

      let currentUpDown: 'ArrowUp' | 'ArrowDown' | undefined;
      const points: { x: number; y: number }[] = [];

      for (let i = 0; i < 200; i += 1) {
        const trace = await readEntityTrace(page);
        const enemies = trace.filter((record) => record.shape === 'circle' && record.color === ENEMY_COLOR);
        const player = trace.find((record) => record.shape === 'rect' && PLAYER_COLORS.has(record.color));
        const items = trace.filter((record) => record.color === HEALING_ITEM_COLOR);
        // 매 틱 그려지는 healingItem이 정확히 1개일 때만 표본으로 쓴다 — 두 번째 드롭이
        // 우연히 겹치면 서로 다른 두 젤리의 좌표가 섞여 "고정 위치" 판정이 오염된다.
        if (items.length === 1) {
          const item = items[0];
          points.push({ x: item.x, y: item.y });
        }

        let desiredUpDown: 'ArrowUp' | 'ArrowDown' | undefined;
        if (player) {
          const playerCenterX = player.x + player.width / 2;
          const playerCenterY = player.y + player.height / 2;
          const threats = enemies.filter(
            (enemy) =>
              Math.hypot(
                enemy.x + enemy.width / 2 - playerCenterX,
                enemy.y + enemy.height / 2 - playerCenterY,
              ) < HEALING_ITEM_DANGER_RADIUS_PX,
          );
          if (threats.length > 0) {
            const averageThreatY =
              threats.reduce((sum, enemy) => sum + enemy.y + enemy.height / 2, 0) / threats.length;
            desiredUpDown = averageThreatY < playerCenterY ? 'ArrowDown' : 'ArrowUp';
          }
        }
        await setHeldKey(page, currentUpDown, desiredUpDown);
        currentUpDown = desiredUpDown;

        const snapshot = await page.evaluate(async () => {
          window.__TRICKAL_TEST__?.stepFrames(5);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const bridgeSnapshot = window.__TRICKAL_TEST__?.getSnapshot();
          return bridgeSnapshot ? { status: bridgeSnapshot.status } : undefined;
        });
        if (!snapshot || snapshot.status !== 'playing') break;
        if (points.length >= 15) break;
      }
      if (currentUpDown) await page.keyboard.up(currentUpDown);

      if (points.length >= 15) {
        sampledPoints = points;
        break;
      }
    }

    expect(sampledPoints.length).toBeGreaterThanOrEqual(15);

    // INV-ITEM-2: 젤리는 살아있는 동안 x/y가 전혀 변하지 않는다(부동소수 오차조차 없다 —
    // movement.ts는 healingItem의 좌표 필드를 아예 갱신하지 않는다).
    const first = sampledPoints[0];
    for (const point of sampledPoints) {
      expect(point.x).toBe(first.x);
      expect(point.y).toBe(first.y);
    }
  });

  test('체력이 낮아진 상태에서 회복 젤리를 먹으면 체력이 정확히 1 증가한다', async ({ page }) => {
    test.setTimeout(60_000);

    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(2));
    await installEntityTrace(page);

    const keyState: AutopilotKeyState = { mode: 'farm', spaceDown: false };
    let lastSnapshot: AutopilotSnapshot | undefined;
    let hpBeforePickup = -1;
    let scoreBeforePickup = -1;
    let hpAfterPickup = -1;

    for (let i = 0; i < 400; i += 1) {
      const trace = await readEntityTrace(page);
      const { snapshot } = await stepHealingItemAutopilot(page, trace, keyState, lastSnapshot?.mana ?? 0, {
        farm: 5,
        seek: 1,
      });
      if (!snapshot) break;
      // hp가 오른 유일한 계기는 INV-ITEM-3의 회복 젤리 획득뿐이다(다른 회복 수단 없음).
      if (lastSnapshot && snapshot.hp > lastSnapshot.hp) {
        hpBeforePickup = lastSnapshot.hp;
        scoreBeforePickup = lastSnapshot.score;
        hpAfterPickup = snapshot.hp;
        lastSnapshot = snapshot;
        break;
      }
      lastSnapshot = snapshot;
      if (snapshot.status !== 'playing') break;
    }

    // design.md §6.1: rAF 루프는 e2e 모드에서도 실시간으로 계속 돌고 HUD 발행은 최대 100ms
    // 스로틀되므로, 픽업 직후 몇 번의 추가 await(키 해제 등) 이후 DOM을 예전 스냅샷 값과
    // 비교하면 그 사이의 자연스러운 추가 이벤트 때문에 어긋날 수 있다. DOM 검증은 그 순간
    // 다시 읽은 bridge 값과 같은 evaluate 안에서 함께 캡처해 형식·정합성만 확인한다.
    const liveCheck = await page.evaluate(() => {
      const hpText = document.querySelector('[data-testid="hud-hp"]')?.textContent ?? '';
      const snapshot = window.__TRICKAL_TEST__?.getSnapshot();
      return { hpText, hp: snapshot?.hp };
    });
    await releaseAutopilotKeys(page, keyState);

    expect(lastSnapshot?.status).toBe('playing');
    // 픽업 직전 hp가 실제로 maxHp(3, BalanceConfig.player.maxHp) 미만이었는지 — 이 조건이
    // 거짓이면 아래 +1 검증이 "가득 찬 상태에서의 만피 보너스" 시나리오와 섞여버린다.
    expect(hpBeforePickup).toBeGreaterThan(0);
    expect(hpBeforePickup).toBeLessThan(3);
    // 픽업이 벌어진 바로 그 틱의 bridge 스냅샷끼리 비교한 것이라 실시간 드리프트와
    // 무관하게 정확하다(INV-ITEM-3의 핵심 계약: 정확히 +1).
    expect(hpAfterPickup).toBe(hpBeforePickup + 1);
    // INV-ITEM-3: 회복 경로에서는 SCORE가 변하지 않는다(만피 보너스와 상호 배타적).
    expect(lastSnapshot?.score).toBe(scoreBeforePickup);
    expect(liveCheck.hpText).toBe(`♥ ${liveCheck.hp} / 3`);
  });

  test('체력이 가득 찬 상태에서 회복 젤리를 먹으면 체력 변화 없이 점수가 정확히 500 증가한다', async ({
    page,
  }) => {
    test.setTimeout(60_000);

    await page.evaluate(() => window.__TRICKAL_TEST__?.seed(3));
    await installEntityTrace(page);

    const keyState: AutopilotKeyState = { mode: 'farm', spaceDown: false };
    let lastSnapshot: AutopilotSnapshot | undefined;
    let hpAtPickup = -1;
    let scoreBeforePickup = -1;
    let scoreAfterPickup = -1;

    for (let i = 0; i < 400; i += 1) {
      const trace = await readEntityTrace(page);
      const { snapshot } = await stepHealingItemAutopilot(page, trace, keyState, lastSnapshot?.mana ?? 0, {
        farm: 5,
        seek: 1,
      });
      if (!snapshot) break;
      // 만피 보너스(INV-ITEM-3)는 hp가 그대로인 채 SCORE만 오르는 픽업으로 식별한다.
      // score가 100 넘게 뛰는 것은 일반 처치(+10)로는 나올 수 없는 폭이라 만피 보너스
      // (+500)만의 신호로 안전하게 구분된다.
      if (
        lastSnapshot &&
        snapshot.hp === lastSnapshot.hp &&
        snapshot.score > lastSnapshot.score + 100
      ) {
        hpAtPickup = snapshot.hp;
        scoreBeforePickup = lastSnapshot.score;
        scoreAfterPickup = snapshot.score;
        lastSnapshot = snapshot;
        break;
      }
      lastSnapshot = snapshot;
      if (snapshot.status !== 'playing') break;
    }

    await releaseAutopilotKeys(page, keyState);

    expect(lastSnapshot?.status).toBe('playing');
    expect(hpAtPickup).toBe(3); // maxHp(BalanceConfig.player.maxHp) — 만피 상태였음을 확인
    // 만피 보너스(INV-ITEM-3)의 핵심 계약: 정확히 +500. 이 값은 픽업이 벌어진 바로 그 틱의
    // bridge 스냅샷끼리(같은 evaluate 호출 내) 비교한 것이라 실시간 드리프트와 무관하게
    // 정확하다.
    expect(scoreAfterPickup - scoreBeforePickup).toBe(500);

    // design.md §6.1: rAF 루프는 e2e 모드에서도 실시간으로 계속 돌고 있어 이 시점 이후로도
    // 자동사격 처치가 계속 SCORE를 올릴 수 있다(실측: 캡처 550 → 이후 자연 진행으로 570).
    // 따라서 DOM 쪽은 "그 정확한 값과 일치"가 아니라 "만피 보너스가 반영된 값 이상으로,
    // 올바른 형식으로 표시되는가"만 확인한다 — hudStore 발행 스로틀(최대 100ms)도 함께
    // 흡수하기 위해 폴링한다.
    await expect(page.getByTestId('hud-hp')).toHaveText('♥ 3 / 3');
    await expect
      .poll(async () => {
        const text = await page.getByTestId('hud-score').textContent();
        const match = /^SCORE: (\d+)$/.exec(text ?? '');
        return match ? Number(match[1]) : Number.NaN;
      })
      .toBeGreaterThanOrEqual(scoreAfterPickup);
  });

  test('플레이어가 먹지 않고 약 4초간 방치한 회복 젤리는 수명 타이머로 소멸한다', async ({ page }) => {
    test.setTimeout(60_000);

    // INV-ITEM-2(전면 개정): 젤리는 더 이상 화면 밖으로 흘러나가 소멸하지 않고, 스폰
    // 위치에 고정된 채 `lifetimeRemainSec`(BalanceConfig.healingItem.lifetimeSec = 4.0초 =
    // 60fps 기준 약 240틱)이 다 되면 소멸한다. TestBridge는 world.healingItems를 직접
    // 노출하지 않으므로(design.md §6.9), stepFrames로 실제 요청한 누적 틱 수를 카운터로
    // 삼아 "젤리가 처음 보인 시점부터 완전히 사라질 때까지" 걸린 틱 수를 근사 측정한다.
    // 단, 실제 배경 rAF 루프도 e2e 모드에서 계속 실시간으로 도는 것을 위 시나리오들의
    // 주석에서 이미 확인했으므로(그 루프가 우리가 요청한 것 외의 추가 틱도 실제 경과
    // 시간만큼 진행시킨다), 우리가 센 "요청 틱 수"는 실제 경과 틱보다 작거나 같을 수
    // 있다 — 그래서 240 정확히가 아니라 넉넉한 여유 구간으로 검증한다.
    const candidateSeeds = [3, 2, 1];
    let sawItem = false;
    let confirmedDead = false;
    let ticksAliveSinceSighted = -1;

    for (const candidateSeed of candidateSeeds) {
      await page.goto('/?e2e=1');
      await waitForTestBridge(page);
      await page.evaluate((value) => window.__TRICKAL_TEST__?.seed(value), candidateSeed);
      await installEntityTrace(page);

      let currentUpDown: 'ArrowUp' | 'ArrowDown' | undefined;
      sawItem = false;
      confirmedDead = false;
      let sightedAtRequestedTicks = -1;
      let lastSeenRequestedTicks = -1;
      let requestedTicks = 0;
      let consecutiveAbsences = 0;

      // 여유 있게 큰 반복 상한(600회 * 5틱 = 최대 3000 요청 틱 ≈ 50초 상당)을 두되,
      // 실제로는 젤리가 보이고 나서 confirmedDead가 되면 훨씬 일찍 break한다.
      for (let i = 0; i < 600; i += 1) {
        const trace = await readEntityTrace(page);
        const enemies = trace.filter((record) => record.shape === 'circle' && record.color === ENEMY_COLOR);
        const player = trace.find((record) => record.shape === 'rect' && PLAYER_COLORS.has(record.color));
        const items = trace.filter((record) => record.color === HEALING_ITEM_COLOR);

        if (items.length > 0) {
          sawItem = true;
          if (sightedAtRequestedTicks < 0) sightedAtRequestedTicks = requestedTicks;
          lastSeenRequestedTicks = requestedTicks;
          consecutiveAbsences = 0;
        } else if (sightedAtRequestedTicks >= 0) {
          // 한 번이라도 본 뒤 사라진 프레임 — 점멸(0.1초=6틱 주기) 오프 구간일 수 있으므로
          // 연속 부재가 충분히(블링크 반주기보다 훨씬 길게) 지속돼야 "확정 소멸"로 본다.
          consecutiveAbsences += 1;
          if (consecutiveAbsences >= 6) {
            confirmedDead = true;
            ticksAliveSinceSighted = lastSeenRequestedTicks - sightedAtRequestedTicks;
            break;
          }
        }

        let desiredUpDown: 'ArrowUp' | 'ArrowDown' | undefined;
        if (player) {
          const playerCenterX = player.x + player.width / 2;
          const playerCenterY = player.y + player.height / 2;
          const threats = enemies.filter(
            (enemy) =>
              Math.hypot(
                enemy.x + enemy.width / 2 - playerCenterX,
                enemy.y + enemy.height / 2 - playerCenterY,
              ) < HEALING_ITEM_DANGER_RADIUS_PX,
          );
          if (threats.length > 0) {
            const averageThreatY =
              threats.reduce((sum, enemy) => sum + enemy.y + enemy.height / 2, 0) / threats.length;
            desiredUpDown = averageThreatY < playerCenterY ? 'ArrowDown' : 'ArrowUp';
          }
        }
        await setHeldKey(page, currentUpDown, desiredUpDown);
        currentUpDown = desiredUpDown;

        // 젤리를 아직 못 봤거나 이미 살아있는 동안에는 성긴 스텝(5틱)으로 빠르게 진행하고,
        // 사라짐 확정 판정 구간에서는 더 촘촘히(3틱) 스텝해 블링크 앨리어싱을 줄인다.
        const stepTicks = sightedAtRequestedTicks >= 0 ? 3 : 5;
        const snapshot = await page.evaluate(async (tickCount) => {
          window.__TRICKAL_TEST__?.stepFrames(tickCount);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const bridgeSnapshot = window.__TRICKAL_TEST__?.getSnapshot();
          return bridgeSnapshot ? { status: bridgeSnapshot.status } : undefined;
        }, stepTicks);
        requestedTicks += stepTicks;
        if (!snapshot || snapshot.status !== 'playing') break;
      }
      if (currentUpDown) await page.keyboard.up(currentUpDown);

      if (sawItem && confirmedDead) break;
    }

    expect(sawItem).toBe(true);
    expect(confirmedDead).toBe(true);
    // BalanceConfig.healingItem.lifetimeSec = 4.0초 = 60fps 기준 약 240틱. 배경 rAF 루프가
    // 우리가 요청한 것 이상으로 실시간 진행시킬 수 있어(위 주석 참고) 실측 "요청 틱 수"는
    // 240보다 작게 나올 수 있고, 반대로 초기 관측 지연(5틱 단위 성긴 스텝)만큼 더 크게
    // 나올 수도 있다 — 그래서 "약 4초"를 폭넓게 감싸는 구간(2.3초~6초 상당)으로 검증한다.
    expect(ticksAliveSinceSighted).toBeGreaterThanOrEqual(140);
    expect(ticksAliveSinceSighted).toBeLessThanOrEqual(360);
  });
});
