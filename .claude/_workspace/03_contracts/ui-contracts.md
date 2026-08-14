# UI Contracts — 반응형 레이아웃, HUD, 키 바인딩, 게임오버, 테스트 브릿지

- **작성:** tech-leader (Phase 2)
- **근거:** design.md v3.4 §6.2.1-(1), §6.7, §6.9, §9 D-1/D-2/D-6
- **소비자:** `frontend-qa`(`tests/component/**`), `e2e-tester`(`e2e/**`). 두 팀 모두 `src/game/**`·`src/ui/**` 구현 코드를 열람하지 않으므로 **이 문서와 `src/contracts/**`가 유일한 정보원**이다.

---

## 1. HUD `data-testid` 및 표시 문자열 포맷 (고정)

| 요소 | `data-testid` | 표시 문자열 포맷 | 예시 | 소스 필드 (`HudSnapshot`) |
| --- | --- | --- | --- | --- |
| HP | `hud-hp` | `♥ {hp} / {maxHp}` | `♥ 3 / 3` | `hp`, `maxHp` |
| MANA | `hud-mana` | `MANA: {mana}%` | `MANA: 0%` | `mana` |
| SCORE | `hud-score` | `SCORE: {score}` | `SCORE: 0` | `score` |
| LEVEL | `hud-level` | `LV. {level}` | `LV. 1` | `level` |
| 게임 보드 | `game-board` | (텍스트 없음, 캔버스·HUD·오버레이의 반응형 컨테이너) | — | — |
| 캔버스 | `game-canvas` | (텍스트 없음, `<canvas aria-label="...">`) | — | — |
| 게임오버 오버레이 | `game-over` | §3 참조 | — | `status === 'gameover'`일 때만 DOM에 존재 |

**정밀 규칙**
- `{hp}`, `{maxHp}`, `{score}`, `{level}`은 **정수를 그대로** 문자열 보간한다(소수점·천단위 콤마 없음). `{mana}`도 정수 표기(그레이박스 단계에서는 `manaGain`이 정수 percent 누적이므로 소수 발생 없음 — 만약 구현상 소수가 나오면 반올림하여 정수로 표시, 반내림/반올림 방식은 `Math.round` 사용).
- 하트 기호는 유니코드 `♥`(U+2665) 1개 고정, 개수가 아니라 **텍스트로 표시된 숫자**로 HP를 나타낸다(하트 아이콘 반복 렌더 아님).
- `game-over`가 DOM에 없을 때(`status !== 'gameover'`) 컴포넌트/E2E 테스트는 `hud-hp` 등 4개 testid가 **항상** 존재해야 한다고 가정할 수 있다(즉 HUD는 게임오버 여부와 무관하게 항상 렌더된다).

---

## 2. 키 바인딩 표 (`event.code` 기준, design.md §6.2.1-(1) 고정)

| 동작 | `event.code` | `InputState` 필드 | 비고 |
| --- | --- | --- | --- |
| 위로 이동 | `ArrowUp` 또는 `KeyW` | `up` | |
| 아래로 이동 | `ArrowDown` 또는 `KeyS` | `down` | |
| 왼쪽으로 이동 | `ArrowLeft` 또는 `KeyA` | `left` | 8방향 확정으로 신설 |
| 오른쪽으로 이동 | `ArrowRight` 또는 `KeyD` | `right` | 8방향 확정으로 신설 |
| 재시작 | `KeyR` | `restart` | `status === 'gameover'`일 때만 유효(D-6) |

**정밀 규칙**
- 키 판별은 `event.key`가 아니라 **`event.code`**를 사용한다(레이아웃 독립).
- `keydown`에서 해당 필드를 `true`로, `keyup`에서 `false`로 설정한다. `restart`(`KeyR`)도 동일한 keydown/keyup 모델을 따르되, **게임 로직 측에서 `status !== 'gameover'`일 때는 무시**한다(입력 자체는 항상 기록해도 무방하지만 효과가 없어야 한다 — 게이팅은 `hooks/useGameLoop.ts` 책임, `invariants.md` §2 "부가 확인 사항" 참조).
- 4개 방향키의 브라우저 기본 동작(페이지 스크롤)은 `preventDefault()`로 차단한다.
- `window`의 `blur` 이벤트에서 `InputState`의 5개 필드를 **모두 `false`로 리셋**한다(키 고착 방지).
- 발사는 키 바인딩 없이 게임 루프에서 자동으로 수행한다. E2E는 발사 키를 누르지 않은 채 시간 진행만으로 투사체 생성과 적 처치를 검증한다.
- E2E(`Playwright`)의 재시작 입력은 `page.keyboard.press('KeyR')`처럼 **Playwright의 키 이름**(대부분 `event.code`와 동일 문자열)을 사용해 위 표와 1:1 매칭한다.

---

## 3. 게임오버 오버레이 (D-6)

- **표시 조건:** `HudSnapshot.status === 'gameover'`일 때만 DOM에 존재한다(`status`가 `'playing'`으로 되돌아오면 즉시 제거).
- **`data-testid`:** `game-over`
- **문구(고정, E2E 텍스트 매칭 대상):**
  ```
  GAME OVER
  Press R to Restart
  ```
  - 1번째 줄(`GAME OVER`)과 2번째 줄(`Press R to Restart`)은 **별도의 텍스트 노드**(예: 각각 `<p>` 또는 `<h2>`/`<p>`)로 렌더한다. 두 줄을 하나의 문자열로 합치지 않는다 — E2E가 `getByText('GAME OVER')`와 `getByText(/Press R to Restart/i)`를 독립적으로 조회할 수 있어야 한다.
  - "재시작 키를 텍스트로 안내"해야 한다는 §9 D-6 요건에 따라 두 번째 줄에는 반드시 **대문자 `R`** 문자가 리터럴로 포함되어야 한다.
- **재시작 이후:** `R` 키 입력 → `createWorld()` + `hudStore.reset()` → 다음 HUD 발행에서 `hp = maxHp`, `mana = 0`, `score = 0`, `level = 1`, `status = 'playing'`으로 복귀 → `game-over` 오버레이가 DOM에서 사라진다. E2E는 이 전체 흐름(오버레이 노출 → `R` 입력 → HUD 초기값 복귀 → 오버레이 소멸)을 하나의 시나리오로 검증한다.

---

## 4. 테스트 브릿지 (`window.__TRICKAL_TEST__`, `TestBridge`)

- **타입:** `src/contracts/ui.ts`의 `TestBridge` (tech-leader 소유). 전역 선언(`declare global`)은 `src/types/global.d.ts`(frontend-developer 소유)가 담당하며 `TestBridge`를 `import type`한다.
- **활성화 조건:** URL 쿼리 `?e2e=1`이 있을 때만 `window.__TRICKAL_TEST__`가 정의된다. 그 외에는 `undefined`이므로, 사용하는 코드(E2E 스펙 포함)는 항상 옵셔널 체이닝(`window.__TRICKAL_TEST__?.stepFrames(1)`) 또는 존재 확인 후 사용한다.
- **로딩 방식:** `GameBoard.tsx`가 `?e2e=1`일 때만 `import('@/testBridge')`를 동적으로 호출한다(별도 청크). 일반 플레이 경로에서는 이 모듈이 네트워크 요청조차 발생시키지 않는다.
- **API 3종 (그 이상 추가 금지):**
  | 메서드 | 시그니처 | 동작 |
  | --- | --- | --- |
  | `getSnapshot` | `(): Readonly<HudSnapshot>` | 현재 HUD가 표시 중인 것과 동일한 스냅샷을 즉시 반환(스로틀 무관, 항상 최신 `world.session` 반영). |
  | `stepFrames` | `(frameCount: number): void` | `rAF`를 우회하고 `stepWorld`를 정확히 `frameCount`회 직접 호출한다(고정 `dt = BalanceConfig.loop.FIXED_STEP_MS / 1000`). 실시간 대기 없이 결정적으로 다수 틱을 진행시키기 위함. |
  | `seed` | `(seedValue: number): void` | 루프가 보유한 `Rng` 인스턴스를 `createRng(seedValue)` 결과로 교체한다. 월드의 다른 상태는 건드리지 않는다(스폰 타이머·엔티티 등은 그대로 유지). |
  | (금지) | — | 점수·HP·레벨을 임의로 설정하는 API, 게임 규칙을 우회하는 API는 제공하지 않는다(§6.9). |
- **E2E 사용 패턴 예시:**
  ```ts
  await page.goto('/?e2e=1');
  await page.evaluate(() => window.__TRICKAL_TEST__?.seed(42));
  await page.evaluate(() => window.__TRICKAL_TEST__?.stepFrames(120)); // 2초 분량(60fps 가정)
  const snapshot = await page.evaluate(() => window.__TRICKAL_TEST__?.getSnapshot());
  ```
- **프로덕션 취급:** `npm run preview`(프로덕션 빌드) 위에서 E2E가 돌아가므로 브릿지는 빌드에서 제거되지 않는다. 대신 런타임 게이팅(`?e2e=1`)과 동적 import로 일반 사용자 경로 영향을 0으로 만든다(§6.9).

---

## 5. 접근성 (§6.10 최소 요건)

- `<canvas>`는 `aria-label`을 가진다(권장 문구: `"슈팅 게임 화면"` 또는 동등한 설명, 정확한 문자열은 계약으로 고정하지 않음 — E2E는 `aria-label` 텍스트를 정확 매칭하지 않고 `getByLabelText`류의 접근성 쿼리로 존재만 확인).
- HUD 4개 항목은 실제 텍스트 DOM 노드로 렌더되어야 한다(캔버스에 그려 넣지 않는다) — 스크린 리더·테스트 라이브러리 모두 텍스트로 조회 가능해야 한다.
- 키보드로 이동·재시작이 가능하고 발사는 별도 조작 없이 자동으로 진행되어야 한다.

---

## 6. 풀페이지 반응형 레이아웃 (design.md v3.2 §6.7)

- `html`, `body`, `#root`는 현재 뷰포트 전체를 사용한다. `body`의 기본 margin은 0이며 정상 초기 화면에서 가로·세로 문서 스크롤이 없어야 한다.
- `game-board`는 논리 캔버스와 같은 **4:3 비율**을 유지하며 뷰포트 안에 완전히 포함되는 최대 크기로 수평·수직 중앙 정렬한다. 남는 공간은 잘라내거나 보드를 늘리지 않고 레터박스로 둔다.
- `game-canvas`의 표시 크기는 `game-board`의 내부 크기를 채운다. `GameCanvas.tsx`는 `canvas.style.width` 또는 `canvas.style.height`에 `800px`/`600px`를 직접 기록하지 않는다. `width`/`height` backing store와 게임의 논리 좌표 800x600은 기존 계약을 유지한다.
- HUD와 게임오버 오버레이는 `game-board` 내부의 절대 위치 레이어다. 두 요소 모두 보드 경계를 벗어나지 않으며 HUD 4개 항목은 줄바꿈이나 가림 없이 표시되어야 한다.
- 동적 뷰포트 단위 `dvh`를 우선하고, 이를 지원하지 않는 브라우저에는 `vh` 기반 폴백을 제공한다.
- E2E 대표 뷰포트와 수용 기준:
  | 분류 | 뷰포트 | 수용 기준 |
  | --- | --- | --- |
  | 데스크톱 | 1440x900 | 보드 4:3, 뷰포트 내부 최대 크기, 중앙 정렬, 무스크롤 |
  | 태블릿 | 1024x768 | 보드가 뷰포트를 4:3으로 채우고 HUD가 보드 내부에 표시됨 |
  | 모바일 가로 | 844x390 | 보드 4:3 contain, HUD 4개 항목 가시, 무스크롤 |
- 모바일 지원은 이번 단계에서 **가로 표시 레이아웃**에 한정한다. 발사는 자동이며 터치 이동·재시작 입력은 이 계약에 포함하지 않는다.
