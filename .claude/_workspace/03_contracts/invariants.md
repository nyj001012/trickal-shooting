# Invariants & System Execution Order

- **작성:** tech-leader (Phase 2)
- **근거:** `.claude/_workspace/01_architecture/design.md` v3.1 §6.2 / §6.2.1 / §6.4 / §6.6.1 / §9 (D-1~D-7)
- **위치:** 타입으로 표현 불가능한 것(불변식·실행 순서·경계 조건·수용 기준)만 여기 적는다. 타입 자체는 `src/contracts/**`가 SSOT다.
- **소비자:** `frontend-developer`(구현 시 이 순서를 그대로 조립), `frontend-qa`(이 표만 보고 red 테스트를 작성), `e2e-tester`(브라우저 레벨 시나리오 근거).

---

## 1. System Execution Order (`stepWorld` 조립 순서)

`src/game/stepWorld.ts`의 `stepWorld: StepWorld`는 `world.session.status !== 'playing'`이면 **아무 것도 하지 않고 즉시 반환**한다. `'playing'`일 때만 아래 순서를 **정확히** 이 순서로 1회씩 실행한다. 순서를 바꾸려면 계약 개정을 거친다(§6.4).

```
1. fireWeapon(world, input, dt)        // game/systems/weapon.ts
2. applyMovement(world, input, dt)     // game/systems/movement.ts
3. spawnTick(world, dt, rng)           // game/systems/spawner.ts
4. const collisions = detectCollisions(world)   // game/systems/collision.ts (읽기 전용)
5. applyCombat(world, collisions, dt)  // game/systems/combat.ts
6. applyProgression(world)             // game/systems/progression.ts
7. prune dead entities:                // stepWorld.ts 내부(비공개 헬퍼, 별도 계약 타입 없음)
   world.enemies = world.enemies.filter(e => e.alive)
   world.projectiles = world.projectiles.filter(p => p.alive)
```

**근거 및 주의사항**
- 1(발사)이 2(이동)보다 먼저인 이유: 발사는 "이번 틱 이동 전" 플레이어 위치에서 투사체를 생성해도 무방하지만(허용 오차 범위, 그레이박스 단계), 이동 시스템이 투사체의 +x 이동까지 담당하므로 **발사가 먼저 실행되어야 방금 생성된 투사체도 같은 틱에 1회 전진**한다.
- 4(충돌 판정)는 **2와 3 다음**에 실행한다 — 이동·스폰이 끝난 "이번 틱의 최종 위치" 기준으로 겹침을 판정해야 겹침 판정이 프레임 지연 없이 정확하다.
- 6(진행도)이 5(전투) 다음인 이유: 전투에서 갱신된 `session.score`/`mana`/`hp`를 기준으로 레벨업·마나 리셋·게임오버 전이를 판정해야 같은 틱 안에서 즉시 반영된다.
- **엔티티 제거는 순회 중 `splice` 금지, 틱 말미 일괄 `filter`만 허용**(§6.4). 1~6 사이에서는 `alive` 플래그만 뒤집는다.
- **입력 반영**은 별도 시스템 단계가 아니다. `input: Readonly<InputState>`는 이미 `hooks/useKeyboardInput.ts`가 만들어 `stepWorld` 호출 시점에 인자로 주입한 상태이므로, "input 반영"은 1~3단계의 각 시스템이 필요한 만큼 `input`을 직접 읽는 것으로 완료된다.
- `dt`는 항상 고정 스텝(`BalanceConfig.loop.FIXED_STEP_MS / 1000`)이며, 가변 프레임 델타를 그대로 넘기지 않는다(§6.2 누산기 패턴은 `hooks/useGameLoop.ts` 책임).

---

## 2. 필수 불변식

### INV-MOVE-1 — 대각선 이동 속도 정규화 (D-1)
어떤 입력 조합에서도, 플레이어의 1틱 이동 거리(유클리드 거리)는 `BalanceConfig.player.speed * dt`를 **초과하지 않는다**.
```
dx = (right ? 1 : 0) - (left ? 1 : 0)
dy = (down  ? 1 : 0) - (up   ? 1 : 0)
len = Math.hypot(dx, dy)
if (len > 0) {
  player.x += (dx / len) * BalanceConfig.player.speed * dt
  player.y += (dy / len) * BalanceConfig.player.speed * dt
}
```
- 반대 방향 동시 입력(`left && right`, 또는 `up && down`)은 해당 축이 0으로 상쇄되며 **정상 동작**이다(버그 아님).
- 테스트 관점: 직선 입력 1개(`right` only)와 대각선 입력 2개(`right && down`)로 동일 `dt`를 적용했을 때, 이동 **거리**(`Math.hypot(Δx, Δy)`)가 서로 같아야 한다. 각 축 성분(Δx, Δy)이 같다는 뜻이 아니다.

### INV-MOVE-2 — 플레이어 경계 클램프 (D-1)
어떤 틱이 끝난 시점에도, 플레이어의 AABB(`x, y, width, height`)는 `world.bounds` 내부에 완전히 포함된다.
```
player.x = clamp(player.x, 0, world.bounds.width  - player.width)
player.y = clamp(player.y, 0, world.bounds.height - player.height)
```
- 클램프는 **이동 적용과 같은 틱, `applyMovement` 내부**에서 수행한다. 다음 틱으로 미루지 않는다.
- 적용 순서: 이동 적용 → 클램프. 클램프를 먼저 하고 이동을 나중에 적용하지 않는다.

### INV-FIRE-1 — 발사 쿨다운 중 투사체 생성 금지 (D-2)
`player.fireCooldownRemainSec > 0`인 모든 틱에서, 그 틱에 새로 생성되는 투사체 수는 **0**이다. `input.fire`가 그 구간 내내 `true`로 유지되어도 결과는 같다(입력 버퍼링/큐잉 없음).
- 쿨다운은 매 틱 무조건 `-= dt`로 먼저 감소한 뒤(0 미만으로 내려가지 않게 `Math.max(0, ...)`), 그 결과가 `<= 0`이고 `input.fire`가 `true`일 때만 발사하고 쿨다운을 `BalanceConfig.player.fireCooldownSec`로 리셋한다.

### INV-SPAWN-1 — 스폰 직후 안전 지대 (D-4/D-5, 8방향 확정의 파생 규칙)
적이 스폰되는 **바로 그 프레임**에서, 해당 적의 AABB는 `world.bounds`의 우측 경계 완전히 바깥에 있으며(`enemy.x >= world.bounds.width`) 플레이어의 AABB와 겹치지 않는다.
- 스폰 좌표는 항상 `x = world.bounds.width`(적의 `width`만큼 화면 밖에서 시작하는 것이 아니라 우측 경계선에서 시작 — 곧바로 좌측으로 진행하며 자연히 화면 안으로 들어온다), `y`는 `rng()`로 `[BalanceConfig.spawn.marginY, world.bounds.height - enemy.height - BalanceConfig.spawn.marginY]` 범위에서 결정한다.
- 이 불변식 덕분에 스폰과 충돌 판정(`detectCollisions`) 사이에 순서 의존성이 생기지 않는다: 스폰 직후 같은 틱에 충돌 판정이 실행되어도 방금 생성된 적은 절대 히트로 잡히지 않는다.

### INV-DMG-1 — 무적 시간 중 접촉 피해 상한 (8방향 확정의 파생 규칙)
임의의 `BalanceConfig.player.invulnSec` 길이 구간 안에서, **접촉 피해(contact damage)로 인한** 플레이어 HP 감소는 최대 1회(=`contactDamage` 1건)이다.
- **적용 범위 명시(모호성 제거):** 이 불변식은 `applyCombat`의 `PlayerContact` 처리(접촉 피해)에만 적용된다. `applyMovement`의 좌측 이탈 피해(`escapeDamage`, D-5)는 플레이어 위치와 무관하게 발생하는 별개 메커니즘이며 **무적 시간의 영향을 받지 않는다**. 즉 같은 틱/같은 무적 구간 안에서 "접촉 피해 1회"와 "이탈 피해 1회"가 각각 별도로 발생해 HP가 2 감소하는 것은 이 불변식 위반이 **아니다**.
- 무적 시간 중 도착한 접촉(`PlayerContact`)은 **HP는 감소시키지 않지만 해당 적은 제거**한다(플레이어와 겹친 적이 무적 시간 동안 화면에 계속 남아 다시 겹치는 것을 방지). 무적 시간 갱신(재시작)은 실제로 HP가 감소한 접촉이 발생했을 때만 일어난다.
- 무적 시간은 매 틱 `-= dt`로 감소하며(`Math.max(0, ...)`), 이 감소는 `applyCombat` 맨 처음 단계에서 수행한다(§1의 순서 참고).

### 부가 확인 사항 (불변식은 아니지만 리뷰·테스트 시 확인)
- **투사체 방향:** 투사체는 생성 시점 이후 방향을 바꾸지 않는다. 항상 `+x`로만 이동한다(조준 없음, D-2).
- **적 방향:** 적은 생성 이후 방향을 바꾸지 않는다. 항상 `-x`로만 이동한다(D-5).
- **재시작 게이팅(D-6):** `input.restart`는 `world.session.status === 'gameover'`일 때만 유효하다. 이 게이팅은 `stepWorld`가 아니라 **`hooks/useGameLoop.ts`(접착 계층)**가 담당한다 — `status`가 `'gameover'`가 되면 `stepWorld` 자체가 no-op이 되므로(§1), 재시작 로직(=`createWorld()` 재호출 + `hudStore.reset()`)은 게임 로직이 아니라 훅이 실행한다. `game/**`는 `createWorld()`를 호출할 뿐, "언제 재호출할지"는 판단하지 않는다.
- **월드 재생성 시 상태 누수 금지(D-6):** 재시작은 `createWorld()`가 반환하는 **완전히 새로운 객체**로 `useRef.current`를 교체한다. 기존 `GameWorld`의 필드를 하나씩 리셋하지 않는다.
- **HUD 발행 스로틀 예외:** `status` 필드가 이전 스냅샷과 달라지는 `publish` 호출은 `HUD_PUBLISH_INTERVAL_MS` 스로틀을 무시하고 즉시 반영되어야 한다(구현은 `hooks/useGameLoop.ts` 쪽에서 "마지막 발행 이후 경과 시간 확인"과 별개로 "status 변경 여부"를 체크하는 방식을 권장. `hudStore.publish` 자체는 스로틀 로직을 갖지 않는다 — 호출측 책임).
- **성능 예산(§6.10):** 1프레임의 `stepWorld` + `drawScene` 합계는 5ms 이내여야 한다. `BalanceConfig.limits.maxEnemies`/`maxProjectiles`를 초과하는 스폰/발사는 (에러를 던지지 않고) **조용히 스킵**한다.

---

## 3. `BalanceConfig` 권장 수치 (그레이박스 초기값)

> 타입은 `src/contracts/balance.ts`(SSOT). 아래 수치는 `frontend-developer`가 `src/game/balance.ts`에 `as const satisfies BalanceConfig`로 채워 넣을 **권장 초기값**이다. `loop.*` 4개 키는 §6.1/§6.2가 수치까지 확정했으므로 권장이 아니라 **고정값**이다. 나머지는 그레이박스 튜닝 편의를 위한 권장값이며, 플레이 테스트 후 `frontend-developer`가 조정할 수 있다(단, 키 이름·단위·그룹 구조는 변경 불가).

| 그룹.키 | 값 | 비고 |
| --- | --- | --- |
| `canvas.width` | `800` | §1.1 고정 |
| `canvas.height` | `600` | §1.1 고정 |
| `player.spawnX` | `40` | 좌측 근처 |
| `player.spawnY` | `300` | 세로 중앙 (600/2) |
| `player.width` | `32` | |
| `player.height` | `32` | |
| `player.speed` | `240` | px/sec |
| `player.maxHp` | `3` | |
| `player.fireCooldownSec` | `0.35` | sec (초당 약 2.86발) |
| `player.invulnSec` | `1.0` | sec |
| `projectile.width` | `8` | |
| `projectile.height` | `4` | |
| `projectile.speed` | `480` | px/sec |
| `projectile.damage` | `1` | |
| `projectile.lifetimeSec` | `2.0` | sec (800px / 480px·s⁻¹ ≈ 1.67s보다 여유 있게) |
| `enemy.width` | `28` | |
| `enemy.height` | `28` | |
| `enemy.speed` | `120` | px/sec |
| `enemy.hp` | `1` | 투사체 1방 처치 |
| `enemy.scoreValue` | `10` | |
| `enemy.manaGain` | `5` | percent |
| `enemy.contactDamage` | `1` | |
| `enemy.escapeDamage` | `1` | |
| `spawn.initialIntervalSec` | `1.2` | sec |
| `spawn.intervalDecayPerLevel` | `0.1` | sec |
| `spawn.minIntervalSec` | `0.35` | sec (하한) |
| `spawn.marginY` | `20` | px |
| `progression.manaMax` | `100` | percent, D-3 확정 |
| `progression.levelUpScoreStep` | `100` | 점 (레벨 n→n+1은 누적 점수 `n * 100` 도달 시) |
| `progression.maxLevel` | `Number.POSITIVE_INFINITY` | "무제한" — `minIntervalSec` 하한이 실질 상한 역할 |
| `limits.maxEnemies` | `40` | §6.10 |
| `limits.maxProjectiles` | `60` | §6.10 |
| `loop.FIXED_STEP_MS` | `1000 / 60` (≈`16.6667`) | §6.2 **고정** |
| `loop.MAX_FRAME_MS` | `250` | §6.2 **고정** |
| `loop.MAX_SUBSTEPS` | `5` | §6.2 **고정** |
| `loop.HUD_PUBLISH_INTERVAL_MS` | `100` | §6.1 **고정**(10Hz) |

---

## 4. 계약 검증 기록

- **명령(§4.2 Phase 2):**
  `npx --yes -p typescript@5.7 tsc --noEmit --strict --target ES2022 --lib ES2022 --moduleResolution bundler --module ESNext src/contracts/*.ts`
  (참고: 순수 `npx --yes typescript@5.7 tsc ...` 형태는 이 npm 버전에서 "could not determine executable to run" 오류를 낸다. 패키지명과 bin명이 달라 `-p` 플래그가 필요하다 — `npx --yes -p typescript@5.7 tsc ...`가 올바른 호출이다.)
- **결과:** 종료 코드 `0`, 출력 없음 (에러 0건).
- **추가 자체 검증(§2.2.2 전체 옵션):** `verbatimModuleSyntax`, `isolatedModules`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, `skipLibCheck`, `noUncheckedIndexedAccess: false`를 모두 켠 임시 tsconfig로도 `tsc --noEmit` 통과 확인(종료 코드 `0`).
