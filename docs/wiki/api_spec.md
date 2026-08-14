# 내부 API와 계약

## 문서 범위

이 프로젝트에는 HTTP, WebSocket 또는 백엔드 API가 없다. 여기서 API는 애플리케이션 내부에서 계층 간 호출되는 TypeScript 함수와 E2E 관측 인터페이스를 뜻한다. 타입의 SSOT는 `src/contracts/**`이며 소비자는 `@/contracts` 배럴에서만 가져온다.

## 핵심 데이터 모델

| 타입                | 주요 필드                                                                                                       | 의미                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GameWorld`         | `bounds`, `player`, `enemies`, `regularProjectiles`, `skillProjectiles`, `session`, `spawner`, `nextEntityId`   | 한 플레이 세션의 전체 인메모리 상태              |
| `GameSession`       | `hp`, `maxHp`, `mana`, `score`, `level`, `status`                                                               | HUD와 진행 상태의 SSOT                           |
| `Player`            | 공통 Box 필드, `regularFireCooldownRemainSec`, `skillFireCooldownRemainSec`, `isSkillFiring`, `invulnRemainSec` | 플레이어 엔티티                                  |
| `Enemy`             | 공통 Box 필드, `hp`, `scoreValue`, `manaGain`, `contactDamage`                                                  | 좌측으로 이동하는 적                             |
| `RegularProjectile` | 공통 Box 필드, `damage`, `lifetimeRemainSec`                                                                    | 우측으로 직진하는 일반탄                         |
| `SkillProjectile`   | 공통 Box 필드, `damage`, `lifetimeRemainSec`, `vx`, `vy`, `targetId`, readonly 원·근거리 조향 튜닝              | 생존 적을 락온하고 근거리 회전력을 높이는 스킬탄 |
| `InputState`        | `up`, `down`, `left`, `right`, `skill`, `restart`                                                               | DOM 코드에서 변환된 의미 기반 입력               |
| `HudSnapshot`       | `hp`, `maxHp`, `mana`, `score`, `level`, `status`                                                               | React가 구독하는 읽기 전용 투영                  |

모든 엔티티는 재사용되지 않는 `id`, 판별자 `kind`, 지연 제거용 `alive`를 갖는다. `Entity`는 `Player | Enemy | RegularProjectile | SkillProjectile` 판별 유니온이다.

## 월드와 유틸리티 API

| import               | 시그니처                                 | 순수성·효과                                    |
| -------------------- | ---------------------------------------- | ---------------------------------------------- |
| `@/game/createWorld` | `createWorld(): GameWorld`               | 매번 독립된 초기 월드 객체 그래프 반환         |
| `@/game/rng`         | `createRng(seed: number): Rng`           | 같은 시드에 같은 `[0, 1)` 수열을 만드는 팩토리 |
| `@/game/input`       | `createInputState(): InputState`         | 모든 플래그가 `false`인 새 입력 객체 반환      |
| `@/game/stepWorld`   | `stepWorld(world, input, dt, rng): void` | 한 고정 틱 실행, `playing`이 아니면 no-op      |

`dt`의 단위는 초이며 정상 루프에서는 항상 `BALANCE.loop.FIXED_STEP_MS / 1000`이다.

## 시스템 API

| import                       | 시그니처 요약                              | 변경 대상                                       |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `@/game/systems/collision`   | `aabbOverlap(a, b): boolean`               | 없음                                            |
| `@/game/systems/collision`   | `detectCollisions(world): CollisionResult` | 없음, 탄종별 hit 배열 반환                      |
| `@/game/systems/weapon`      | `fireWeapon(world, input, dt, rng): void`  | 두 쿨다운·스킬 상태, MANA, 탄종별 배열, 다음 ID |
| `@/game/systems/movement`    | `applyMovement(world, input, dt): void`    | 엔티티 좌표·수명·스킬탄 속도·락온, 이탈 적 제거 |
| `@/game/systems/spawner`     | `spawnTick(world, dt, rng): void`          | 스폰 타이머, 적 배열, 다음 ID                   |
| `@/game/systems/combat`      | `applyCombat(world, collisions, dt): void` | HP, 적·탄종별 생존, SCORE·MANA, 무적 시간       |
| `@/game/systems/progression` | `applyProgression(world): void`            | MANA 포화, LEVEL·스폰 주기, 게임 상태           |

### 충돌 경계

`aabbOverlap`은 네 비교에 모두 엄격 부등호를 사용한다. 두 사각형의 변이나 꼭짓점만 닿으면 교차 면적이 없으므로 `false`다.

### 엔티티 제거

시스템은 배열을 순회하면서 `splice`하지 않는다. 제거 대상의 `alive`만 `false`로 바꾸고 `stepWorld` 마지막에 한 번 필터링한다.

### 피해 규칙

- 접촉 피해가 실제 HP를 줄였을 때만 무적 시간이 시작된다.
- 무적 시간 중 추가 접촉은 적을 제거하지만 HP를 다시 줄이지 않는다.
- 적이 좌측 경계를 완전히 벗어나면 해당 적만 제거하고 HP·무적 시간·SCORE·MANA는 변경하지 않는다.
- HP 감소는 직접 접촉 피해로만 발생한다.
- HP는 0 아래로 내려가지 않는다.

### 일반탄·스킬탄 발사 규칙

- 새 월드는 두 발사 쿨다운이 0이고 `isSkillFiring`은 `false`다. 첫 `playing` 틱에는 일반탄을 즉시 생성한다.
- 일반 상태에서는 MANA를 초당 0.5 회복하며 0.3초마다 일반탄을 자동 생성한다. 일반탄은 오른쪽으로 직진하고 적 처치 시 MANA 5를 지급한다.
- `input.skill`이 `true`이고 MANA가 20 이상이면 스킬 상태를 시작한다. 시작 뒤에는 MANA가 20 미만이어도 Space를 누르고 MANA가 남은 동안 유지한다.
- 스킬 상태에서는 일반탄 생성과 자연 회복을 중지하고, MANA를 초당 30 소모하며 0.15초마다 스킬탄을 생성한다. 실제 생성 시 주입형 RNG를 한 번 소비해 초기 `vy`를 `[-120, 120)` px/sec로 정하고 `targetId = null`, `farTurnFactor = 0.06`, `nearTurnFactor = 0.3`, `nearTurnDistancePx = 150`을 캡처한다. 첫 생존 목표를 ID로 락온하고 대상이 사라질 때만 최근접 적을 재획득한다. 목표 중심 거리가 150px 미만이면 근거리 계수, 그 외에는 원거리 계수로 현재 속도를 보간한 뒤 720px/sec로 정규화한다. 목표가 없으면 락온을 비우고 현재 관성을 유지하며, 처치 시 SCORE만 지급한다.
- MANA는 모든 변경 뒤 0~100 범위로 포화된다. 100에서 회복이나 일반탄 처치 보상이 추가되어도 100을 유지한다.
- 살아 있는 일반탄 또는 스킬탄이 각 탄종의 최대 60개에 도달하면 해당 생성을 생략하고 해당 쿨다운만 다시 시작한다.

## HUD Store API

`@/game/hudStore`는 다음 `HudStore` 인터페이스를 구현하는 모듈 싱글턴이다.

| 메서드                | 반환                    | 동작                                   |
| --------------------- | ----------------------- | -------------------------------------- |
| `subscribe(callback)` | unsubscribe 함수        | 변경이 수락될 때 호출할 구독자 등록    |
| `getSnapshot()`       | `Readonly<HudSnapshot>` | 다음 변경 전까지 동일 객체 참조 반환   |
| `publish(next)`       | `void`                  | 얕은 비교 후 달라진 경우에만 교체·통지 |
| `reset()`             | `void`                  | 초기 HUD로 복구하고 무조건 통지        |

스로틀은 Store가 아니라 게임 루프 호출부의 책임이다. `status` 변경은 즉시 반영된다.

## E2E TestBridge

일반 URL에서는 `window.__TRICKAL_TEST__`가 `undefined`다. `?e2e=1`로 접속하면 동적 import가 완료된 뒤 아래 세 메서드만 사용할 수 있다.

| 메서드        | 시그니처                     | 동작                                               |
| ------------- | ---------------------------- | -------------------------------------------------- |
| `getSnapshot` | `(): Readonly<HudSnapshot>`  | 스로틀과 무관한 최신 월드의 HUD 투영 반환          |
| `stepFrames`  | `(frameCount: number): void` | 고정 `dt`로 정확히 지정한 횟수만큼 시뮬레이션 진행 |
| `seed`        | `(seedValue: number): void`  | RNG만 새 시드 인스턴스로 교체                      |

예시:

```ts
await page.goto('/?e2e=1');
await page.evaluate(() => window.__TRICKAL_TEST__?.seed(6));
await page.evaluate(() => window.__TRICKAL_TEST__?.stepFrames(100));
```

## UI 관측 계약

| 요소      | `data-testid` | 표시 형식                         |
| --------- | ------------- | --------------------------------- |
| HP        | `hud-hp`      | `♥ {hp} / {maxHp}`                |
| MANA      | `hud-mana`    | `MANA: {mana}%`                   |
| SCORE     | `hud-score`   | `SCORE: {score}`                  |
| LEVEL     | `hud-level`   | `LV. {level}`                     |
| 게임 보드 | `game-board`  | 뷰포트 내부 최대 4:3 컨테이너     |
| 캔버스    | `game-canvas` | 접근 가능한 `aria-label` 보유     |
| 게임오버  | `game-over`   | `GAME OVER`, `Press R to Restart` |

게임 보드는 데스크톱·태블릿·모바일 가로 뷰포트에서 4:3 비율과 중앙 정렬을 유지한다. HUD와 게임오버 오버레이는 보드 내부 레이어이며, 캔버스의 CSS 표시 크기는 보드 크기를 따른다. 논리 좌표와 backing store 계약은 800×600을 유지한다.

## 키 바인딩

| 동작      | `KeyboardEvent.code` |
| --------- | -------------------- |
| 위        | `ArrowUp`, `KeyW`    |
| 아래      | `ArrowDown`, `KeyS`  |
| 왼쪽      | `ArrowLeft`, `KeyA`  |
| 오른쪽    | `ArrowRight`, `KeyD` |
| 스킬 발사 | `Space`              |
| 재시작    | `KeyR`               |

일반탄은 키 입력 없이 자동으로 수행되고 Space는 스킬 발사만 제어한다. 추적하는 이동·스킬·재시작 키는 기본 브라우저 동작을 막고, 창이 포커스를 잃으면 모든 입력 플래그를 초기화한다.

## 밸런스 계약

실제 값은 `src/game/balance.ts`의 `BALANCE`에 있고 `BalanceConfig`를 만족해야 한다. 그룹은 `canvas`, `player`, `regularProjectile`, `skillProjectile`, `enemy`, `spawn`, `progression`, `limits`, `loop`이며 키 이름이나 구조를 바꾸려면 계약 개정이 필요하다.
