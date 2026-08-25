# Module Map — 타입 ↔ 물리적 모듈 배치

- **작성:** tech-leader (Phase 2)
- **근거:** design.md v3.5 §5.5 (슬림화된 5컬럼 스키마)
- **목적:** TypeScript가 표현하지 못하는 단 하나의 정보 — **"어느 타입이 어느 파일에 어떤 이름으로 구현되는가"** — 를 고정한다. `frontend-qa`는 `src/game/**` / `src/hooks/**` / `src/ui/**`를 열람할 수 없으므로, import 경로를 알 방법은 이 표뿐이다.
- **표기 규칙**
  - `import 경로`는 `tsconfig.json`의 `@/*` alias 기준(§2.2.2).
  - `계약 타입` 컬럼이 비어 있으면(`—`) 해당 심볼은 계약 함수 타입으로 결박되지 않는 (React 컴포넌트/훅 등 §5.4 패턴이 적용되지 않는) 대상이며, Props/반환 타입은 `src/contracts/ui.ts` 또는 `src/contracts/world.ts` 참조 컬럼에 별도 표기한다.
  - `순수성`: `pure`(같은 입력→같은 출력, 부수효과 없음) / `mutates-arg(...)`(인자를 변형) / `impure(...)`(모듈 싱글턴 상태·DOM·타이머 등 외부 세계 참조).
  - `테스트 환경`: Vitest의 `environment` 값(§6.8). `node` 또는 `jsdom`.

---

## 1. `src/game/**` — 순수 로직 계층 (`tests/unit/**`, `environment: node`)

| import 경로 | export 심볼 | 계약 타입 | 순수성 | 테스트 환경 |
| --- | --- | --- | --- | --- |
| `@/game/systems/collision` | `aabbOverlap` | `AabbOverlap` | `pure` | `node` |
| `@/game/systems/collision` | `detectCollisions` | `DetectCollisions` | `pure` | `node` |
| `@/game/systems/movement` | `applyMovement` | `ApplyMovement` | `mutates-arg(world)` | `node` |
| `@/game/systems/weapon` | `fireWeapon` | `FireWeapon` | `mutates-arg(world)`, 실제 스킬탄 생성 시 주입 `Rng` 1회 소비 | `node` |
| `@/game/systems/enemyWeapon` | `fireEnemyProjectiles` | `FireEnemyProjectiles` | `mutates-arg(world)`, 실제로 발사하는 적마다 주입 `Rng` 1회씩 소비 (issue #17) | `node` |
| `@/game/systems/spawner` | `spawnTick` | `SpawnTick` | `mutates-arg(world)` | `node` |
| `@/game/systems/combat` | `applyCombat` | `ApplyCombat` | `mutates-arg(world)` | `node` |
| `@/game/systems/progression` | `applyProgression` | `ApplyProgression` | `mutates-arg(world)` | `node` |
| `@/game/stepWorld` | `stepWorld` | `StepWorld` | `mutates-arg(world)` | `node` |
| `@/game/createWorld` | `createWorld` | `CreateWorld` | `pure`(인자 없음, 매 호출 동일 구조의 새 객체) | `node` |
| `@/game/rng` | `createRng` | `CreateRng` | `pure`(반환된 `Rng`는 호출할 때마다 내부 상태 전진 — `Rng` 자체는 `impure(제너레이터 내부 상태)`, 팩토리 `createRng`는 `pure`) | `node` |
| `@/game/input` | `createInputState` | `CreateInputState` | `pure` | `node` |
| `@/game/hudStore` | `hudStore` | `HudStore` | `impure(모듈 싱글턴 상태)` | `node` |
| `@/game/balance` | `BALANCE` | `BalanceConfig`(값, `as const satisfies`) | `pure`(상수) | `node` |

**QA 참고:** 위 표의 모든 항목은 DOM 없이 `environment: node`에서 직접 `import`해 호출할 수 있어야 한다(§6.0 규칙 4 — 이것이 이번 설계의 존재 이유). 픽스처(예: `Enemy`/`RegularProjectile`/`SkillProjectile`/`EnemyProjectile` 리터럴, 고정 시드 `Rng`)는 `tests/helpers/**`에 타입 붙은 빌더로 작성한다.

**`enemyWeapon.ts` 파일 분리 결정(issue #17):** 기존 `spawner.ts`(적 생성)에 합치지 않고 별도 파일로 분리했다 — `spawner.ts`는 "적을 언제/어디에 만들 것인가"만 책임지고, `enemyWeapon.ts`는 "이미 존재하는 적이 언제/어느 방향으로 투사체를 쏘는가"를 책임진다. 플레이어 쪽의 `weapon.ts`(발사) / `spawner.ts`(적 생성)가 이미 분리되어 있는 것과 대칭을 이루며, 각 파일이 단일 책임을 유지한다.

---

## 2. `src/render/**` — 캔버스 출력 계층

| import 경로 | export 심볼 | 계약 타입 | 순수성 | 테스트 환경 |
| --- | --- | --- | --- | --- |
| `@/render/palette` | `PALETTE` | (계약 타입 없음, `Readonly<Record<PaletteToken, string>>`; `PaletteToken = keyof typeof PALETTE`로 렌더 계층 내부에서 파생) | `pure`(상수) | — (렌더 픽셀 결과는 이번 단계 테스트 대상 아님, §6.8) |
| `@/render/drawEntity` | `drawEntity` | — (`ctx: CanvasRenderingContext2D, entity: Readonly<Entity>) => void`, `Entity`는 `@/contracts`) | `impure(ctx 그리기 호출)`, 단 `world`는 읽기만 함 | — |
| `@/render/drawScene` | `drawScene` | — (`ctx: CanvasRenderingContext2D, world: Readonly<GameWorld>) => void`) | `impure(ctx 그리기 호출)`, 단 `world`는 읽기만 함 | — |

**주의:** 렌더 함수는 계약 함수 타입 별칭으로 결박되지 않는다(캔버스 컨텍스트가 `src/contracts/**`의 "외부 의존 0" 규칙과 상충하므로, `ctx` 타입은 렌더 계층이 DOM 타입을 직접 사용해 자체 선언). `frontend-qa`는 픽셀 출력을 검증하지 않으므로(§6.8) 이 섹션은 정보 제공용이다.

---

## 3. `src/hooks/**` — React ↔ 엔진 접착 계층 (`tests/component/**`, `environment: jsdom`)

| import 경로 | export 심볼 | 계약 타입 | 순수성 | 테스트 환경 |
| --- | --- | --- | --- | --- |
| `@/hooks/useGameLoop` | `useGameLoop` | — (내부적으로 `StepWorld`/`CreateWorld`/`Rng`/`HudStore`를 조립하는 React 훅) | `impure(rAF, ref, visibilitychange)` | `jsdom` |
| `@/hooks/useKeyboardInput` | `useKeyboardInput` | — (반환 타입은 `Readonly<InputState>`를 노출하는 ref 또는 값) | `impure(DOM keydown/keyup/blur 리스너)` | `jsdom` |
| `@/hooks/useHudSnapshot` | `useHudSnapshot` | — (반환 타입 `Readonly<HudSnapshot>`, 내부적으로 `useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot, hudStore.getSnapshot)`) | `impure(hudStore 구독)` | `jsdom` |

---

## 4. `src/ui/**` — React 컴포넌트 계층 (`tests/component/**`, `environment: jsdom`)

| import 경로 | export 심볼 | 계약 타입 | 순수성 | 테스트 환경 |
| --- | --- | --- | --- | --- |
| `@/ui/Hud` | `Hud` | `HudProps` | `impure(React 컴포넌트)` | `jsdom` |
| `@/ui/GameCanvas` | `GameCanvas` | `GameCanvasProps` | `impure(React 컴포넌트, canvas ref)` | `jsdom` |
| `@/ui/ErrorFallback` | `ErrorFallback` | `ErrorFallbackProps` | `impure(React 컴포넌트)` | `jsdom` |
| `@/ui/GameBoard` | `GameBoard` | — (props 없음, 컴포지션 루트: `GameCanvas` + `Hud` + 게임오버 오버레이 + 루프 마운트) | `impure(React 컴포넌트, hooks 조립)` | `jsdom` |

---

## 5. `src/testBridge.ts` — E2E 관측 브릿지

| import 경로 | export 심볼 | 계약 타입 | 순수성 | 테스트 환경 |
| --- | --- | --- | --- | --- |
| `@/testBridge` | (default export 또는 `installTestBridge`— frontend-developer 확정, `window.__TRICKAL_TEST__`에 대입되는 객체가 `TestBridge`를 만족해야 함) | `TestBridge` | `impure(전역 window 대입, world/rng/hudStore 참조)` | 브라우저(Playwright)에서만 로드, 단위/컴포넌트 테스트 대상 아님 |

---

## 6. `src/types/global.d.ts` — 전역 선언 (frontend-developer 소유)

| import 경로 | export 심볼 | 계약 타입 | 순수성 | 테스트 환경 |
| --- | --- | --- | --- | --- |
| (전역, import 없음) | `Window.__TRICKAL_TEST__` (옵셔널) | `TestBridge`(`@/contracts`에서 `import type`) | — (타입 선언만, 런타임 코드 없음) | — |
