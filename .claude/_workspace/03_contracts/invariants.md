# Invariants & System Execution Order

- **작성:** tech-leader (Phase 2)
- **근거:** `.claude/_workspace/01_architecture/design.md` v3.8 §6.2 / §6.2.1 / §6.4 / §6.6.1 / §9 (D-1~D-7)
- **위치:** 타입으로 표현 불가능한 것(불변식·실행 순서·경계 조건·수용 기준)만 여기 적는다. 타입 자체는 `src/contracts/**`가 SSOT다.
- **소비자:** `frontend-developer`(구현 시 이 순서를 그대로 조립), `frontend-qa`(이 표만 보고 red 테스트를 작성), `e2e-tester`(브라우저 레벨 시나리오 근거).

---

## 1. System Execution Order (`stepWorld` 조립 순서)

`src/game/stepWorld.ts`의 `stepWorld: StepWorld`는 `world.session.status !== 'playing'`이면 **아무 것도 하지 않고 즉시 반환**한다. `'playing'`일 때만 아래 순서를 **정확히** 이 순서로 1회씩 실행한다. 순서를 바꾸려면 계약 개정을 거친다(§6.4).

```
1. fireWeapon(world, input, dt, rng)          // game/systems/weapon.ts
2. fireEnemyProjectiles(world, dt, rng)       // game/systems/enemyWeapon.ts  ★issue #17 신설
3. applyMovement(world, input, dt)            // game/systems/movement.ts
4. spawnTick(world, dt, rng)                  // game/systems/spawner.ts
5. updateEnemyAi(world, dt, rng)              // game/systems/enemyAi.ts    ★issue #19 신설
6. const collisions = detectCollisions(world) // game/systems/collision.ts (읽기 전용)
7. applyCombat(world, collisions, dt, rng)    // game/systems/combat.ts        ★issue #21: rng 인자 신설
8. applyProgression(world)                    // game/systems/progression.ts
9. prune dead entities:                       // stepWorld.ts 내부(비공개 헬퍼, 별도 계약 타입 없음)
   world.enemies = world.enemies.filter(e => e.alive)
   world.regularProjectiles = world.regularProjectiles.filter(p => p.alive)
   world.skillProjectiles = world.skillProjectiles.filter(p => p.alive)
   world.enemyProjectiles = world.enemyProjectiles.filter(p => p.alive)
   world.healingItems = world.healingItems.filter(p => p.alive)              // ★issue #21 신설
```

**근거 및 주의사항**
- 1(플레이어 발사)이 3(이동)보다 먼저인 이유: 발사는 "이번 틱 이동 전" 플레이어 위치에서 투사체를 생성해도 무방하지만(허용 오차 범위, 그레이박스 단계), 이동 시스템이 투사체의 전진까지 담당하므로 **발사가 먼저 실행되어야 방금 생성된 투사체도 같은 틱에 1회 전진**한다.
- 2(적 발사)를 1 바로 다음, 3(이동) 이전에 두는 이유는 동일하다 — 방금 생성된 `EnemyProjectile`도 같은 틱에 이동 시스템의 4방향 이탈 검사를 1회 거치게 하기 위함이다(issue #17). 2가 1보다 뒤인 이유는 특별한 의존성 때문이 아니라 "플레이어 행동 → 적 행동" 순서를 관례로 유지하기 위함이며, `rng` 소비 순서에만 영향을 준다(아래 참고).
- **5(적 행동 선택, `updateEnemyAi`)를 4(스폰) 다음·6(충돌 판정) 이전에 두는 이유(issue #19):** `applyMovement`(3)는 매 틱 "그 시점까지 확정된" 행동 상태(`action`과 그 파생 필드)만 읽고 `rng`를 전혀 받지 않는 순수 위치 적분 함수로 유지해야 하므로(§6.0 규칙 1, `ApplyMovement` 시그니처 불변), 난수를 소비하는 "최초 행동 선택" 책임을 별도 시스템으로 분리했다. 이 시스템을 3(이동)보다 뒤에 두면 **막 스폰된 적**(4에서 생성, `actionInitialized = false`)이 같은 틱에 즉시 첫 행동을 배정받아 "스폰 직후 단 1회" 요구사항(INV-EAI-1)을 만족하면서도, 이동은 항상 "이전 틱에 확정된" 행동 상태만 사용해 같은 틱 안에서 읽기-직후-쓰기 경쟁이 생기지 않는다(자세한 데이터 흐름은 `ApplyMovement`/`UpdateEnemyAi`의 JSDoc, INV-EAI-1 참고). `actionInitialized === true`인 기존 적에 대해서는 5가 아무 것도 하지 않는다(재선택 없음). 6(충돌 판정)보다 앞에 두는 이유는 특별한 의존성 때문이 아니라 "이동/스폰 다음, 판정 이전"이라는 관례를 유지하기 위함이다.
- 6(충돌 판정)은 **3과 4 다음**에 실행한다 — 이동·스폰이 끝난 "이번 틱의 최종 위치" 기준으로 겹침을 판정해야 겹침 판정이 프레임 지연 없이 정확하다. `updateEnemyAi`(5)는 위치를 바꾸지 않으므로(행동 상태만 갱신) 6의 판정 대상 좌표에 영향을 주지 않는다.
- 8(진행도)이 7(전투) 다음인 이유: 전투에서 갱신된 `session.score`/`mana`/`hp`를 기준으로 레벨업·MANA 포화·게임오버 전이를 같은 틱 안에 반영한다.
- **엔티티 제거는 순회 중 `splice` 금지, 틱 말미 일괄 `filter`만 허용**(§6.4). 1~8 사이에서는 `alive` 플래그만 뒤집는다.
- **입력 반영**은 별도 시스템 단계가 아니다. `input: Readonly<InputState>`는 이미 `hooks/useKeyboardInput.ts`가 만들어 `stepWorld` 호출 시점에 인자로 주입한 상태다. 이동 시스템은 방향 입력을, 무기 시스템은 `skill` 입력을 읽는다. 일반탄은 스킬 비활성 상태에서 자동 발사한다. `fireEnemyProjectiles`와 `updateEnemyAi`는 `InputState`를 전혀 참조하지 않는다(적 발사·적 행동 선택은 플레이어 입력과 무관).
- 하나의 주입형 `rng` 스트림을 1, 2, 4, 5, 7이 순서대로 공유한다(★7은 issue #21로 신설된 소비 지점). 1은 실제 스킬탄이 배열에 추가되는 틱에만 정확히 1회 소비하고, 2는 그 틱에 실제로 발사하는 각 살아있는 적마다(`world.enemies` 배열 순서로) 방향 선택에 정확히 1회씩 소비하며, 4는 실제 적 스폰에 필요한 난수를 소비하고, 5는 그 틱에 `actionInitialized === false`인(즉 아직 첫 행동을 배정받지 않은) 각 적마다(`world.enemies` 배열 순서로) 정확히 1회(OSCILLATE) 또는 2회(DASH/CIRCLE) 소비하며 이후 그 적에 대해서는 다시는 소비하지 않는다(INV-EAI-1). 7은 `regularProjectileHits` 처리 중 죽는 각 적마다 정확히 1회, 이어서(반드시 그 다음) `skillProjectileHits` 처리 중 죽는 각 적마다 정확히 1회씩 회복 젤리 드롭 확률 판정에 소비한다(순서는 항상 regular 먼저, skill 다음 — INV-ITEM-1). `PlayerContact`로 죽는 적과 `PlayerItemPickup` 처리는 `rng`를 전혀 소비하지 않는다. 같은 초기 월드·입력·시드·틱 수는 동일한 발사 확산·적 발사 방향·스폰·적 행동 배정·젤리 드롭 시퀀스를 재현한다.
- `dt`는 항상 고정 스텝(`BalanceConfig.loop.FIXED_STEP_MS / 1000`)이며, 가변 프레임 델타를 그대로 넘기지 않는다(§6.2 누산기 패턴은 `hooks/useGameLoop.ts` 책임).

---

## 2. AABB Overlap 경계 판정 (`aabbOverlap`, `AabbOverlap` 타입 — 모서리 접촉 = 비겹침)

> 계약 공백 보완(오케스트레이터 요청, `frontend-qa`가 클린룸 작업 중 발견). `src/contracts/systems.ts`의 `AabbOverlap` 타입 시그니처 자체는 변경하지 않았고, JSDoc으로 동일한 판정 규칙을 명시했다. 이 섹션이 산문 SSOT다.

### 정확한 판정식 — **엄격 부등식 채택**
```
overlap(a, b) =
     a.x            <  b.x + b.width
  && a.x + a.width   >  b.x
  && a.y            <  b.y + b.height
  && a.y + a.height  >  b.y
```
네 비교 전부 **`<` / `>`만 사용하며, `<=` / `>=`는 절대 쓰지 않는다.** 즉 두 박스가 한 축에서라도 "딱 맞닿기만"(면적 0의 접촉) 하는 경우 — 예를 들어 `a.x + a.width === b.x`(가로로 모서리가 맞닿음) 또는 `a.y + a.height === b.y`(세로로 모서리가 맞닿음), 나아가 네 모서리 중 한 점만 공유하는 경우(코너 접촉) — 전부 `false`(비겹침)를 반환한다. 겹침으로 인정되려면 x축·y축 **양쪽 모두에서 실제 폭을 가진 교집합**이 있어야 한다.

### 모서리 접촉이 비겹침이어야 하는 이유 — `INV-SPAWN-1`과의 연결
`INV-SPAWN-1`(§3 참조)은 "스폰 직후 프레임에서 적의 AABB는 `world.bounds` 우측 경계 바깥에 있으며 **플레이어와 겹치지 않는다**"를 요구한다. 스폰 좌표는 `enemy.x = world.bounds.width`로 고정되어 있으므로(§3 INV-SPAWN-1 본문), 만약 겹침 판정이 `>=`/`<=`(비엄격 부등식)를 하나라도 쓴다면 다음과 같은 경계 사례가 생길 수 있다:
- 플레이어가 우측 끝까지 붙어 있어 `player.x + player.width === enemy.x`(`=== world.bounds.width`)인 프레임 — 이때 x축 조건이 `a.x + a.width >= b.x`처럼 비엄격이면 이 사례가 "겹침"으로 오판된다.
- 8방향 이동 확정(D-1) 이후 플레이어가 화면 우측 경계(`world.bounds.width - player.width`)까지 자유롭게 붙을 수 있으므로, 이 경계 사례는 이론적 가능성이 아니라 **정상 플레이 중 실제로 발생 가능한 프레임**이다.

따라서 `INV-SPAWN-1`이 예외 없이 성립하려면 `aabbOverlap`이 **엄격 부등식**이어야 한다 — `frontend-qa`가 클린룸 상태에서 추론한 해석이 정확하며, 이 문서가 그 해석을 공식 계약으로 고정한다.

### 적용 범위 — 투사체 명중·접촉 피해에도 동일하게 적용
이 판정 규칙은 `detectCollisions`(및 그것이 내부적으로 호출하는 `aabbOverlap`)의 **모든 호출 지점에 예외 없이 동일하게** 적용된다. 구체적으로:
- **투사체-적 명중(`RegularProjectileHit`/`SkillProjectileHit`):** 어느 탄종이든 선단과 적 AABB가 한 프레임에 정확히 모서리만 맞닿은 경우에는 명중으로 취급하지 않는다. `detectCollisions`는 탄종별 결과 배열을 독립적으로 만들며 `applyCombat`은 경계 판정을 다시 하지 않는다.
- **플레이어-적 접촉(`PlayerContact`):** 마찬가지로 모서리만 스치듯 맞닿은 프레임에는 접촉 피해가 발생하지 않는다. 즉 **"스치듯 맞닿은 프레임에는 피해가 발생하지 않는다"**는 것은 이번 단계의 의도된 게임플레이 귀결이며, 버그가 아니다.
- **적 투사체-플레이어 충돌(`EnemyProjectileHit`, issue #17):** 동일한 엄격 부등식이 `world.enemyProjectiles`와 `world.player` 사이에도 그대로 적용된다. 모서리만 맞닿은 프레임에는 히트로 잡히지 않는다.
- 결론적으로 `combat.ts`는 이 규칙을 스스로 재구현하거나 재확인하지 않는다 — `detectCollisions`가 이미 엄격 부등식으로 걸러낸 쌍만 넘겨주므로, `applyCombat`은 넘어온 모든 쌍을 무조건 "겹침"으로 신뢰하고 처리한다.

### 테스트 관점 (`frontend-qa` 참고)
- `aabbOverlap({x:0,y:0,width:10,height:10}, {x:10,y:0,width:10,height:10})` → **`false`**(가로 모서리 정확히 접촉).
- `aabbOverlap({x:0,y:0,width:10,height:10}, {x:9,y:0,width:10,height:10})` → **`true`**(1px 폭의 실제 교집합).
- `aabbOverlap({x:0,y:0,width:10,height:10}, {x:10,y:10,width:10,height:10})` → **`false`**(코너 한 점만 공유).

---

## 3. 필수 불변식

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

### INV-FIRE-1 — 일반탄·스킬탄 상호 배제와 개별 쿨다운 (D-2)

한 틱에는 일반탄과 스킬탄 중 **한 탄종만** 생성할 수 있다. `player.isSkillFiring === true`로 처리되는 틱에는 일반탄 생성과 일반 상태 MANA 회복이 모두 0이다.

- `regularFireCooldownRemainSec`와 `skillFireCooldownRemainSec`는 매 틱 각각 `Math.max(0, value - dt)`로 감소한다. 모드 밖의 쿨다운도 계속 감소하므로 모드 전환 시 준비된 탄종은 즉시 발사할 수 있다.
- 스킬 비활성 상태에서 `input.skill && session.mana >= player.skillStartMana`이면 같은 틱에 스킬 모드에 진입한다. 스킬 활성 상태는 `input.skill && session.mana > 0`인 동안 유지되어, 시작 뒤 MANA가 20 미만이 되어도 중단되지 않는다.
- 스킬 틱은 `skillManaDrainPerSec * dt`만큼 MANA를 소모하고 준비된 경우 스킬탄을 최대 1개 생성한다. 소모 결과가 0이면 그 틱은 끝까지 스킬 전용으로 처리한 뒤 `isSkillFiring = false`로 만들어 다음 틱에 일반 모드로 돌아간다.
- 실제 스킬탄 생성 시 `targetId = null`, `vx = skillProjectile.speed`, `vy = (rng() - 0.5) * 2 * skillProjectile.initialSpreadSpeedY`로 초기 상태를 정하고 `farTurnFactor`, `nearTurnFactor`, `nearTurnDistancePx`를 밸런스에서 캡처한다. 따라서 초기 `vy`는 `[-initialSpreadSpeedY, initialSpreadSpeedY)` 범위다.
- 일반 틱은 `manaRegenPerSec * dt`만큼 MANA를 회복하고 준비된 경우 일반탄을 최대 1개 자동 생성한다. 새 월드는 일반 쿨다운이 0이므로 첫 플레이 틱에 입력 없이 즉시 발사한다.
- 각 탄종이 `limits.maxRegularProjectiles` 또는 `limits.maxSkillProjectiles`에 도달하면 해당 생성을 조용히 생략하고 해당 쿨다운은 리셋한다. 발사를 버퍼링하거나 큐잉하지 않으며, 생략된 스킬탄은 `rng`를 소비하지 않는다.

### INV-HOMING-1 — 스킬탄 락온·근접 조향·속력 보존·무타겟 관성 (D-2)

각 살아 있는 스킬탄은 다음 순서로 목표를 정확히 하나 해석한다.

1. `targetId`와 ID가 같고 `alive === true`인 적이 있으면, 더 가까운 적이 생겨도 기존 목표를 유지한다.
2. 기존 목표가 없거나 죽어 유효하지 않으면 중심 거리 제곱이 가장 작은 살아 있는 적을 새로 선택하고 그 `id`를 `targetId`에 저장한다. 동률이면 `enemies` 배열의 앞선 적을 선택한다.
3. 살아 있는 적이 하나도 없으면 `targetId = null`로 정리한다.

목표가 있으면 목표 중심 방향의 단위 벡터에 `skillProjectile.speed`를 곱해 `desiredVx`, `desiredVy`를 만든다. 두 중심이 정확히 같아 방향을 정할 수 없으면 `desiredVx = skillProjectile.speed`, `desiredVy = 0`을 사용한다. 중심 간 실제 거리로 회전 계수를 선택한 뒤 아래 순서를 정확히 한 번 적용한다.

```
turnFactor = targetDistance < projectile.nearTurnDistancePx
  ? projectile.nearTurnFactor
  : projectile.farTurnFactor
steeredVx = projectile.vx + (desiredVx - projectile.vx) * turnFactor
steeredVy = projectile.vy + (desiredVy - projectile.vy) * turnFactor
steeredSpeed = Math.hypot(steeredVx, steeredVy)

if (Number.isFinite(steeredSpeed) && steeredSpeed > Number.EPSILON) {
  projectile.vx = steeredVx / steeredSpeed * skillProjectile.speed
  projectile.vy = steeredVy / steeredSpeed * skillProjectile.speed
} else {
  projectile.vx = desiredVx
  projectile.vy = desiredVy
}
```

- 권장값은 `farTurnFactor = 0.06`, `nearTurnFactor = 0.3`, `nearTurnDistancePx = 150`이며 모두 생성 후 변하지 않는다. `targetDistance === 150`은 원거리 계수를 사용한다.
- 원거리에서는 현재 관성을 보존하며 완만하게 조향하고, 근거리에서는 더 강하게 꺾어 목표를 지나친 뒤 공전하는 현상을 억제한다.
- 목표가 있는 틱의 최종 속력은 오차 범위 안에서 항상 `skillProjectile.speed`다. 속도와 좌표는 유한수여야 한다.
- 살아 있는 목표가 없으면 `targetId`를 null로 유지하고 `vx`/`vy`를 +x로 초기화하거나 정규화하지 않은 채 현재 관성으로 이동한다. 이후 목표가 생기면 그 틱부터 해당 ID를 락온하고 위 조향을 적용한다.
- 조향과 위치 적용 뒤 기존 lifetime 감소·플레이필드 완전 이탈 제거 규칙을 그대로 적용한다.

### INV-MANA-1 — MANA 포화와 탄종별 처치 보상 (D-3)

모든 시스템 실행 뒤 `0 <= world.session.mana <= BalanceConfig.progression.manaMax`가 성립한다. 최대값은 `100`이며 MANA가 이미 100일 때 회복이나 일반탄 처치 보상이 추가되어도 값은 그대로 100이다. 100 도달을 이유로 0으로 리셋하지 않는다.

- 일반 상태의 자연 회복과 일반탄 처치 보상만 MANA를 증가시킨다.
- 스킬탄 처치는 SCORE를 지급하지만 MANA는 지급하지 않는다.
- 스킬 상태의 지속 소모만 MANA를 감소시키며 0 아래로 내려가지 않는다.
- `fireWeapon`과 `applyCombat`은 각 변경 지점에서 즉시 포화시키고, `applyProgression`도 외부 픽스처나 향후 시스템 변경에 대비해 같은 범위를 방어적으로 재적용한다.

### INV-SPAWN-1 — 스폰 직후 안전 지대 (D-4/D-5, 8방향 확정의 파생 규칙)
적이 스폰되는 **바로 그 프레임**에서, 해당 적의 AABB는 `world.bounds`의 우측 경계 완전히 바깥에 있으며(`enemy.x >= world.bounds.width`) 플레이어의 AABB와 겹치지 않는다.
- 스폰 좌표는 항상 `x = world.bounds.width`(적의 `width`만큼 화면 밖에서 시작하는 것이 아니라 우측 경계선에서 시작 — 곧바로 좌측으로 진행하며 자연히 화면 안으로 들어온다), `y`는 `rng()`로 `[BalanceConfig.spawn.marginY, world.bounds.height - enemy.height - BalanceConfig.spawn.marginY]` 범위에서 결정한다.
- 이 불변식 덕분에 스폰과 충돌 판정(`detectCollisions`) 사이에 순서 의존성이 생기지 않는다: 스폰 직후 같은 틱에 충돌 판정이 실행되어도 방금 생성된 적은 절대 히트로 잡히지 않는다.
- **이 불변식이 성립하려면 `aabbOverlap`이 §2의 엄격 부등식이어야 한다.** 플레이어가 우측 경계에 완전히 붙어 있는 프레임(`player.x + player.width === world.bounds.width === enemy.x`)에서도 겹침이 아니어야 하기 때문이다. 자세한 근거는 §2를 참조.

### INV-ESCAPE-1 — 적 좌측 이탈은 세션에 부수효과가 없음 (D-5)

살아 있는 적을 이동한 뒤 `enemy.x + enemy.width < 0`이면 같은 틱에 `enemy.alive = false`로 표시한다. 이때 `world.session`의 `hp`, `maxHp`, `mana`, `score`, `level`, `status`와 `world.player.invulnRemainSec`는 변경하지 않는다.

- 적 이탈은 처치가 아니므로 SCORE와 MANA를 지급하지 않는다.
- 이탈한 적은 틱 말미 일괄 필터에서 제거한다.
- 같은 틱에 다른 적이 플레이어와 직접 접촉하면 `applyCombat`의 접촉 피해만 독립적으로 적용한다.

### INV-DMG-1 — 무적 시간 중 접촉 피해 상한 (8방향 확정의 파생 규칙)
임의의 `BalanceConfig.player.invulnSec` 길이 구간 안에서, **접촉 피해(contact damage)로 인한** 플레이어 HP 감소는 최대 1회(=`contactDamage` 1건)이다. 적의 좌측 이탈은 `INV-ESCAPE-1`에 따라 HP를 감소시키지 않는다.
- 무적 시간 중 도착한 접촉(`PlayerContact`)은 **HP는 감소시키지 않지만 해당 적은 제거**한다(플레이어와 겹친 적이 무적 시간 동안 화면에 계속 남아 다시 겹치는 것을 방지). 무적 시간 갱신(재시작)은 실제로 HP가 감소한 접촉이 발생했을 때만 일어난다.
- 무적 시간은 매 틱 `-= dt`로 감소하며(`Math.max(0, ...)`), 이 감소는 `applyCombat` 맨 처음 단계에서 수행한다(§1의 순서 참고).

### INV-EPROJ-1 — 적 투사체 속도는 스폰 시점 스냅샷, 레벨업에 불변 (issue #17 요구사항 1/5)

`spawnTick`이 적을 생성하는 바로 그 순간의 `world.session.level`을 사용해 다음 공식으로 `projSpeed`를 계산하고, 그 값을 해당 `Enemy.readonly projSpeed`에 저장한다.
```
projSpeed = clamp(
  BalanceConfig.enemyProjectile.speedBase
    + BalanceConfig.enemyProjectile.speedPerLevel * (spawnLevel - 1),
  BalanceConfig.enemyProjectile.speedBase,
  BalanceConfig.enemyProjectile.speedMax,
)
```
- 이후 `world.session.level`이 몇 번 올라가도, **이미 스폰된 Enemy의 `projSpeed`와 그 Enemy가 이미 발사한 모든 `EnemyProjectile`의 `vx`/`vy`는 변하지 않는다.** 새로 스폰되는 Enemy만 그 시점의 최신 레벨로 다시 계산된 `projSpeed`를 갖는다.
- `EnemyProjectile.vx`/`vy`는 생성 시 정확히 한 번 `projSpeed * 방향단위벡터`로 정해지고, `applyMovement`는 이 값을 읽기만 할 뿐 재계산하거나 조향하지 않는다(대비: `SkillProjectile.vx/vy`는 매 틱 재조향됨, INV-HOMING-1).
- 테스트 관점: 레벨 1에서 적 A를 스폰(그 순간 `A.projSpeed` 캡처) → 레벨을 인위적으로 올림(`world.session.level` 갱신) → 다시 `fireEnemyProjectiles` 실행 시 `A.projSpeed`와, `A`가 발사하는 새 `EnemyProjectile.vx/vy`의 크기가 레벨업 이전과 동일해야 한다. 반면 레벨업 후 새로 스폰된 적 B의 `projSpeed`는 A보다 커야 한다(단, `speedMax` 캡 이내).

### INV-EPROJ-2 — 발사 주기는 매 리셋마다 현재 레벨 기준으로 재계산 (issue #17 요구사항 2)

`Enemy.projFireCooldownRemainSec`가 0 이하로 떨어져 리셋될 때마다(스폰 직후 초기화 포함), 리셋값은 **스냅샷이 아니라 그 순간의 `world.session.level`로 매번 다시 계산**한다.
```
fireIntervalSec = max(
  BalanceConfig.enemyProjectile.fireIntervalBase
    - BalanceConfig.enemyProjectile.fireIntervalDecayPerLevel * (world.session.level - 1),
  BalanceConfig.enemyProjectile.fireIntervalMinSec,
)
```
- `INV-EPROJ-1`과의 유일한 차이점: **`projSpeed`는 스폰 시점에 얼어붙는 스냅샷**이지만, **발사 간격은 스냅샷이 아니라 리셋될 때마다 항상 최신 레벨을 반영**한다. 같은 Enemy라도 스폰 이후 레벨이 올라가면 다음 발사부터 더 짧은 간격으로 쏠 수 있다(단, 이미 날아가고 있는 `EnemyProjectile`의 속도에는 영향 없음).
- 테스트 관점: 적 A를 스폰한 뒤 레벨을 올리고 `fireEnemyProjectiles`를 반복 호출하면, 리셋되는 `projFireCooldownRemainSec` 값이 레벨업 이전보다 짧아져야 한다(단, `fireIntervalMinSec` 하한 이내).

### INV-EPROJ-3 — 적 투사체는 4방향 중 어느 쪽으로든 완전히 벗어나면 소멸 (issue #17 요구사항 3)

매 틱 이동(`applyMovement` 5단계) 후, `EnemyProjectile`의 AABB가 `world.bounds`의 상/하/좌/우 중 **어느 한 변이라도 완전히 벗어나면** 그 틱에 `alive = false`로 표시한다.
```
offscreen =
     enemyProjectile.x + width  < 0
  || enemyProjectile.x          > world.bounds.width
  || enemyProjectile.y + height < 0
  || enemyProjectile.y          > world.bounds.height
```
- 기존 `RegularProjectile`(+x 고정 이동, 우측 이탈만 검사)과 달리, `EnemyProjectile`은 8방향 임의 이동이 가능하므로 **4변 전부**를 검사해야 한다.
- `lifetimeRemainSec`가 0 이하가 되어도 동일하게 `alive = false`로 표시한다(안전망 — 이론상 대각선 방향이 화면 크기에 비해 매우 느리거나 특수한 경계 조건에서 화면 이탈이 지연되는 경우까지 상한을 보장, §6.10 성능 예산과 연동해 `limits.maxEnemyProjectiles`를 넘지 않게 한다).
- 테스트 관점: 8방향(0/45/90/135/180/225/270/315도) 각각에 대해 화면 경계 바로 안쪽에서 생성한 투사체가 해당 방향으로 계속 이동해 결국 4변 중 하나를 통해 `alive = false`가 되는지 개별 검증한다.

### INV-EPROJ-4 — 플레이어 피격은 접촉 피해와 동일한 무적 시간을 공유 (issue #17 요구사항 4, INV-DMG-1과의 관계)

`EnemyProjectileHit`는 `PlayerContact`와 **동일한 `world.player.invulnRemainSec` 상태를 공유**한다(별도의 무적 타이머를 두지 않는다).
- `applyCombat`의 실행 순서(§1, `applyCombat` 내부 소단계)상 `PlayerContact` 처리(소단계 4)가 `EnemyProjectileHit` 처리(소단계 5)보다 먼저 실행되므로, 같은 틱에 접촉과 적 투사체 피격이 동시에 발생해도 **HP 감소는 최대 1회**로 제한된다(둘 중 먼저 처리된 쪽만 무적을 소모/갱신하고, 나중 쪽은 이미 양수가 된 `invulnRemainSec`를 보고 HP를 깎지 않는다).
- `EnemyProjectileHit`로 도착한 투사체는 **무적 시간과 무관하게 항상 `alive = false`로 소멸**한다(무적 중에도 화면에 남아 재충돌 판정을 반복하지 않도록, `PlayerContact`가 무적 중에도 해당 적을 제거하는 것과 동일한 패턴).
- 무적 중이 아닐 때만(`invulnRemainSec <= 0`) `world.session.hp`를 그 투사체의 `damage`만큼 감소시키고(`floored at 0`) `world.player.invulnRemainSec`를 `BalanceConfig.player.invulnSec`로 리셋한다.
- 이 규칙에 따라 `INV-DMG-1`("임의의 `invulnSec` 구간 안에서 접촉 피해로 인한 HP 감소는 최대 1")은 **접촉(enemy contact)과 적 투사체 피격을 합산한 HP 감소 소스 전체**로 확장 해석된다 — 이 문서가 그 확장을 공식 계약으로 고정한다.

### INV-EAI-1 — 행동 선택 타이밍: 스폰 직후 단 1회, 이후 영구 유지 (issue #19, 재선택 로직 폐기로 개정)

각 적은 정확히 하나의 `action`(`'dash' | 'oscillate' | 'circle'`)을 갖는다. 이 `action`은 **그 적이 스폰된 직후 정확히 1회만** `updateEnemyAi`가 무작위로 고르며, 그 적이 살아있는 동안(소멸 전까지) **다시는 재선택되지 않는다.** 주기적 재선택 로직(카운트다운 기반)은 존재하지 않는다.

- **선택 여부 판정:** `Enemy.actionInitialized: boolean` 필드로 "이미 첫 행동을 배정받았는지"를 추적한다. `spawnTick`은 새 적을 `actionInitialized = false`로 초기화하고 나머지 행동 필드는 임의의 플레이스홀더로 채운다(값 자체는 중요하지 않다 — `applyMovement`가 이번 틱에는 이미 실행을 마쳤으므로 이 플레이스홀더를 읽지 않는다, §1 참고). 같은 틱에 `spawnTick` 바로 다음 실행되는 `updateEnemyAi`가 `actionInitialized === false`인 적을 발견하면 **그 즉시** 첫 실제 행동을 배정하고, 배정을 마친 시점에 `actionInitialized`를 `true`로 뒤집는다.
- **이후 영구 유지:** `actionInitialized === true`인 적에 대해서는 `updateEnemyAi`가 어떤 필드도 재선택·재추첨하지 않는다. 한 번 정해진 `action`과 그 파생 필드(`dashVx`/`dashVy`, `oscillateBaseY`, `circleDir` 등)는 그 적이 `alive === false`가 되어 소멸할 때까지 그대로 유지된다. `actionDurationMinSec`/`actionDurationMaxSec`/`actionRemainSec`와 같은 카운트다운 개념은 폐기되었으며 계약·타입 어디에도 존재하지 않는다.
- 최초 배정 순서(정확히 이 순서로 `rng` 소비, 그 적의 생애 동안 단 1회만 발생): ① `actionIndex = Math.min(2, Math.floor(rng() * 3))` → 표 `0:'dash', 1:'oscillate', 2:'circle'`, ② 선택된 행동에 따라 추가 필드 초기화 — DASH는 레벨에 따라 방향 `rng` 소비가 **0회(저레벨, 정좌 고정)** 또는 **1회(고레벨, 좌하/좌/좌상 3방향 중 선택)** 이며(INV-EAI-2 참고), CIRCLE은 항상 `rng` 1회 소비(INV-EAI-4 참고), OSCILLATE는 추가 소비 없음.
- 테스트 관점: 고정 시드로 `updateEnemyAi`를 같은 적에 대해 반복 호출했을 때, 최초 1회 호출에서만 `rng` 소비(행동 선택 1회 + 추가 0/1회, 총 1~2회 — DASH 저레벨은 총 1회, DASH 고레벨과 CIRCLE은 총 2회, OSCILLATE는 총 1회)와 `actionInitialized: false → true` 전이가 일어나고, 이후 모든 호출에서는 `rng`를 전혀 소비하지 않으며 `action`과 파생 필드가 이전 값과 완전히 동일해야 한다. 동일 시드·동일 스폰 시퀀스는 항상 동일한 각 적의 `action` 배정을 재현해야 한다.

### INV-EAI-2 — DASH: 항상 좌측 성분을 갖는 방향 직선 이동, 고레벨에서만 3방향 중 rng 선택 (issue #19, 영구 고착 회귀 수정으로 전면 개정 2026-08-28)

**회귀 배경 및 근거:** 개정 전 규칙은 DASH 방향 후보에 위(90deg)/아래(270deg)/오른쪽(0deg)을 포함했다. 적은 화면 우측 바깥에서 스폰되고(`spawnTick`), x축은 우측만 클램프되며 좌측은 클램프 없이 화면을 완전히 벗어나야 소멸한다(`INV-ESCAPE-1`). 행동이 스폰 시 1회 선택 후 영구 고정되므로(`INV-EAI-1`), 좌측 성분(ux < 0)이 없는 방향으로 DASH가 선택된 적은 화면 우측 가장자리 또는 상하단 클램프 지점에 **영구히 고착**되어 다시는 `INV-ESCAPE-1`로 소멸하지 못하고 누적되는 회귀가 발견되었다(2026-08-28, "맵 오른쪽 위/아래에 병목처럼 멈춰있는 적들"). 이를 근본적으로 차단하기 위해 **모든 DASH 후보는 항상 ux < 0(좌측 성분)을 만족해야 한다**는 제약을 계약에 고정한다.

DASH가 선택되면 `updateEnemyAi`가 (그 적의 생애 중 단 1회) 아래 레벨 게이팅 규칙에 따라 방향을 정하고, 그 방향 단위벡터에 `BalanceConfig.enemy.speed`를 곱해 `dashVx`/`dashVy`를 정확히 한 번 정한다. 이 값은 그 적이 살아있는 동안(영구) 절대 바뀌지 않는다(재조향 없음, 재선택 없음).

```
world.session.level < BalanceConfig.enemyAi.dashOctoDirectionLevel
  ? index = 4                                      // 저레벨: 정좌(180deg) 고정, rng 소비 없음
  : index3 = Math.min(2, Math.floor(rng() * 3)),    // 고레벨: 3방향 후보, rng 1회 소비
    index = [3, 4, 5][index3]                       // index3=0→3(좌하), 1→4(좌), 2→5(좌상)
```

- **저레벨(`world.session.level < BalanceConfig.enemyAi.dashOctoDirectionLevel`):** 방향은 **결정적으로 인덱스 4(정좌, 180도)로 고정**된다. 후보가 하나뿐이므로 **방향 선택에 `rng`를 전혀 소비하지 않는다.**
- **고레벨(`world.session.level >= BalanceConfig.enemyAi.dashOctoDirectionLevel`):** `rng` 1회를 소비해 `index3 = Math.min(2, Math.floor(rng() * 3))`을 뽑고, 후보 배열 `[3, 4, 5]`(좌하/좌/좌상 순서)에 매핑한다.

아래는 공유 8방향 고정 테이블(`FireEnemyProjectiles`/INV-EPROJ-1과 동일한 순서 테이블)이며, DASH 후보는 이 중 좌측 성분(ux < 0)을 가진 인덱스 `3`(좌하)·`4`(좌)·`5`(좌상) **셋뿐**이다. 인덱스 `0`(우)·`1`(우하)·`2`(하)·`6`(상)·`7`(우상)은 DASH 후보에서 완전히 제외된다.
```
0: ( 1,  0)   // 0deg   (+x, 우)
1: ( 1,  1)/sqrt(2)  // 45deg  (우하)
2: ( 0,  1)   // 90deg  (+y, 하)
3: (-1,  1)/sqrt(2)  // 135deg (좌하, SW)
4: (-1,  0)   // 180deg (-x, 좌)
5: (-1, -1)/sqrt(2)  // 225deg (좌상, NW)
6: ( 0, -1)   // 270deg (-y, 상)
7: ( 1, -1)/sqrt(2)  // 315deg (우상)
```
`applyMovement`는 매 틱 `x += dashVx * dt; y += dashVy * dt`만 수행한다(§4의 `BalanceConfig.enemy.speed` 권장값 참고). 레벨 임계값은 `BalanceConfig.enemyAi.dashOctoDirectionLevel`(권장 `11`)이며, 이 값 미만이면 정좌 고정, 이상이면 좌하/좌/좌상 3방향 중 rng로 선택한다.

### INV-EAI-3 — OSCILLATE: y축 사인파 + x축 완만한 좌측 이동 (issue #19)

OSCILLATE가 선택되면(추가 `rng` 소비 없음, 그 적의 생애 중 단 1회) `updateEnemyAi`가 `oscillateBaseY = enemy.y`(선택 시점의 현재 y), `oscillatePhaseSec = 0`으로 초기화한다. 이후 `applyMovement`가 매 틱:
```
enemy.x -= BalanceConfig.enemyAi.oscillateDriftSpeed * dt
enemy.oscillatePhaseSec += dt
enemy.y = enemy.oscillateBaseY + BalanceConfig.enemyAi.oscillateAmplitudePx
  * Math.sin((2 * Math.PI / BalanceConfig.enemyAi.oscillatePeriodSec) * enemy.oscillatePhaseSec)
```
`oscillateBaseY`는 그 적이 살아있는 동안(영구) 다시 바뀌지 않는다(사인파의 기준선 고정).

### INV-EAI-4 — CIRCLE: 원형 궤적 + 중심의 완만한 좌측 이동, 회전 방향 무작위 (issue #19)

CIRCLE이 선택되면 `updateEnemyAi`가 (그 적의 생애 중 단 1회) `rng` 1회를 더 소비해 `circleDir = rng() < 0.5 ? 1 : -1`을 정하고, `circleAngleRad = 0`으로 초기화한 뒤, 현재 위치가 새 궤도 위(각도 0 지점)에 정확히 놓이도록 궤도 중심을 계산한다(순간 이동처럼 보이는 점프 방지):
```
centerX0 = enemy.x + enemy.width / 2
centerY0 = enemy.y + enemy.height / 2
enemy.circleCenterX = centerX0 - BalanceConfig.enemyAi.circleRadiusPx   // cos(0) = 1
enemy.circleCenterY = centerY0                                          // sin(0) = 0
```
이후 `applyMovement`가 매 틱:
```
enemy.circleCenterX -= BalanceConfig.enemyAi.circleDriftSpeed * dt
enemy.circleAngleRad += BalanceConfig.enemyAi.circleAngularSpeedRadPerSec * enemy.circleDir * dt
enemy.x = enemy.circleCenterX + BalanceConfig.enemyAi.circleRadiusPx * Math.cos(enemy.circleAngleRad) - enemy.width / 2
enemy.y = enemy.circleCenterY + BalanceConfig.enemyAi.circleRadiusPx * Math.sin(enemy.circleAngleRad) - enemy.height / 2
```
`circleCenterY`는 그 적이 살아있는 동안(영구) 절대 바뀌지 않는다 — **중심의 좌측 이동은 x축에만 적용**된다(요구사항 1 "중심의 완만한 좌측 이동").

### INV-EAI-5 — 세 행동 공통 경계 규칙: y 양축 클램프, x 우측 클램프만, 좌측 이탈은 INV-ESCAPE-1 그대로 (issue #19)

DASH/OSCILLATE/CIRCLE 중 어떤 행동이 이번 틱 위치를 계산했든, `applyMovement`는 위치 계산 직후 다음을 **모든 살아 있는 적에게 예외 없이** 적용한다(적용 순서: 행동별 위치 계산 → y 클램프 → x 우측 클램프 → 좌측 이탈 검사):
```
enemy.y = clamp(enemy.y, 0, world.bounds.height - enemy.height)
enemy.x = Math.min(enemy.x, world.bounds.width - enemy.width)
if (enemy.x + enemy.width < 0) enemy.alive = false   // INV-ESCAPE-1, 변경 없음
```
- y는 상/하 **양쪽 모두** 클램프한다(화면 밖으로 수직 이탈 자체가 없다).
- x는 **우측 경계만** 클램프한다(우측으로 화면을 벗어나려는 시도는 경계에서 멈춘다). **좌측은 클램프하지 않는다** — 좌측 경계를 완전히 벗어나는 것은 소멸 조건(INV-ESCAPE-1)이지 클램프 대상이 아니다.
- `INV-ESCAPE-1`이 정의하는 "좌측 완전 이탈 시 세션에 부수효과 없이 제거"는 세 행동 전부에 동일하게, 조건 없이 적용된다 — DASH가 우연히 왼쪽으로 향하든, OSCILLATE/CIRCLE의 좌측 드리프트로 서서히 벗어나든 판정식은 동일하다.
- 테스트 관점: 세 행동 각각에 대해 (a) 화면 상단/하단 경계 밖으로 나가려는 입력값에서도 다음 틱 `y`가 `[0, bounds.height - height]`를 벗어나지 않는지, (b) 우측 경계를 넘어서려는 상태에서 `x`가 `bounds.width - width`를 초과하지 않는지, (c) 좌측으로 `width`만큼 완전히 벗어난 다음 틱에 `alive === false`가 되는지를 개별 검증한다.

### INV-ITEM-1 — 회복 젤리 드롭 확률: 처치당 정확히 1회, 투사체 처치만 (issue #21)

`applyCombat`이 `regularProjectileHits` 또는 `skillProjectileHits`를 처리하다가 살아 있던 적을 `alive = false`로 표시하는 바로 그 순간마다(두 처치 경로 각각 독립적으로), 그 즉시 `rng`를 정확히 1회 소비해 아래를 판정한다.

```
if (rng() < BalanceConfig.healingItem.dropChance) {
  const centerX = deadEnemy.x + deadEnemy.width / 2
  const centerY = deadEnemy.y + deadEnemy.height / 2
  world.healingItems.push({
    kind: 'healingItem',
    id: world.nextEntityId++,
    alive: true,
    width: BalanceConfig.healingItem.width,
    height: BalanceConfig.healingItem.height,
    x: centerX - BalanceConfig.healingItem.width / 2,
    y: centerY - BalanceConfig.healingItem.height / 2,
    vx: BalanceConfig.healingItem.driftVx,
    vy: BalanceConfig.healingItem.fallVy,
  })
}
```

- **처치 경로 한정:** 이 판정은 오직 투사체 처치(일반탄·스킬탄)에서만 일어난다. `PlayerContact`로 죽는 적(접촉 즉사)은 이 판정을 거치지 않는다 — 접촉 처치는 애초에 `applyCombat`의 별도 소단계(§1 소단계 4)이며 젤리 드롭 로직과 무관하다.
- **순서와 rng 소비 횟수:** `regularProjectileHits` 루프가 먼저 실행되고, 그 루프에서 죽는 각 적마다 정확히 1회 `rng`를 소비한다. 이어서 `skillProjectileHits` 루프가 실행되고, 마찬가지로 그 루프에서 죽는 각 적마다 정확히 1회 소비한다. 두 루프는 서로 독립적이며, 드롭 확률이 살아남은(=드롭하지 않은) 처치도 `rng` 소비는 정확히 1회로 동일하다(굴림 자체는 항상 일어나고, 그 결과만 성공/실패로 갈린다).
- **`fullHpBonusScore`/`healAmount`와 무관:** 드롭 판정 자체는 플레이어의 현재 HP나 MANA와 무관하게 항상 수행된다. HP 포화 여부는 오직 획득(pickup, INV-ITEM-3) 시점에만 영향을 준다.
- 테스트 관점: 고정 시드에서 정확히 1개의 적이 일반탄에 맞아 죽는 시나리오를 반복 실행하면, `rng` 소비 횟수가 정확히 1이고, `dropChance` 임계값을 오가는 시드 조작으로 `world.healingItems.length`가 0 또는 1이 되는 두 경우를 모두 재현할 수 있어야 한다.

### INV-ITEM-2 — 회복 젤리 이동·소멸: 좌측 드리프트 + 하강, 클램프 없음, 좌/하단 이탈 시 소멸 (issue #21)

`applyMovement`는 매 틱 모든 살아 있는 `HealingItem`에 대해 다음을 수행한다(적용 순서: 위치 적분 → 이탈 검사).

```
item.x += item.vx * dt   // vx는 항상 음수(좌측 드리프트), 스폰 시 고정, 재조향 없음
item.y += item.vy * dt   // vy는 항상 양수(하강), 스폰 시 고정, 재조향 없음
if (item.x + item.width < 0 || item.y > world.bounds.height) {
  item.alive = false
}
```

- **클램프가 전혀 없다.** 다른 모든 엔티티(플레이어 INV-MOVE-2, 적 INV-EAI-5, 각 투사체)와 달리 `HealingItem`은 상/하/좌/우 어느 경계에도 클램프되지 않는다 — 화면 밖으로 자유롭게 나갈 수 있다.
- **소멸 조건은 좌측과 하단 두 곳뿐이다.** 좌측 완전 이탈(`x + width < 0`, 적의 좌측 이탈 규칙과 동일한 형태) 또는 하단 이탈(`y > world.bounds.height`, 상단 경계는 검사하지 않음 — 항상 아래로만 떨어지므로 상단 이탈은 발생하지 않는다)에서 소멸한다. 우측 이탈 검사는 없다 — `vx`가 항상 음수이므로 우측으로는 애초에 나가지 않는다.
- **lifetime 타이머가 없다.** 다른 투사체류(`lifetimeRemainSec`)와 달리 `HealingItem`에는 자동 만료 안전망 필드 자체가 없다 — 오직 좌/하단 이탈만이 소멸 조건이다.
- 세션 부수효과 없음: 좌/하단 이탈로 소멸하는 젤리는 획득이 아니므로 HP/MANA/SCORE를 전혀 변경하지 않는다(INV-ITEM-3의 획득 경로와 무관).
- 테스트 관점: 고정 `vx`/`vy`로 여러 틱을 진행했을 때 클램프 없이 `x`/`y`가 화면 경계를 자유롭게 넘어서는지, 좌측 이탈과 하단 이탈 각각 독립적으로 `alive = false`를 유발하는지, 상단·우측으로는 애초에 이동하지 않으므로 해당 경계 이탈 케이스가 존재하지 않는지 확인한다.

### INV-ITEM-3 — 회복 젤리 획득: HP 회복 또는 만피 보너스 점수, rng 미소비 (issue #21)

`applyCombat`의 마지막 소단계(§1 소단계 6)는 `detectCollisions`가 만든 `playerItemPickups`(플레이어와 겹친, 살아 있는 `HealingItem` 각각)를 순회하며 다음을 적용한다.

```
for (const { item } of collisions.playerItemPickups) {
  if (world.session.hp < world.session.maxHp) {
    world.session.hp = Math.min(world.session.maxHp, world.session.hp + BalanceConfig.healingItem.healAmount)
  } else {
    world.session.score += BalanceConfig.healingItem.fullHpBonusScore
  }
  item.alive = false
}
```

- **두 결과는 상호 배타적이다.** 한 번의 획득은 HP 회복 또는 SCORE 보너스 중 정확히 하나만 발생시킨다 — 만피 상태에서 회복량 일부만 HP로, 나머지를 점수로 분할 지급하지 않는다.
- **판정 기준은 획득 시점의 `hp < maxHp` 여부다.** 같은 틱에 다른 처치로 `hp`가 먼저 오르는 등 순서 의존성이 있을 수 있으나, `applyCombat`은 항상 §1 소단계 순서(1→6)를 지키므로 이 판정은 그 틱의 다른 모든 HP 변경(소단계 4/5의 접촉·적 투사체 피해) 이후에 이뤄진다.
- **MANA는 전혀 변경하지 않는다.** 젤리 획득은 MANA 보상 경로(INV-MANA-1의 일반탄 처치 보상)와 완전히 별개다.
- **`rng`를 소비하지 않는다.** 드롭 판정(INV-ITEM-1)과 달리 획득 처리는 결정적이다 — 같은 픽업 목록에 대해 항상 같은 결과를 낸다.
- 획득된 젤리는 무조건 `alive = false`로 소멸한다(HP 회복이든 SCORE 보너스든 동일).
- 테스트 관점: (a) `hp < maxHp`일 때 픽업 후 `hp`가 정확히 `healAmount`만큼(단, `maxHp` 상한 이내로) 증가하고 `score`는 불변인지, (b) `hp === maxHp`일 때 픽업 후 `hp`는 불변이고 `score`가 정확히 `fullHpBonusScore`만큼 증가하는지, (c) 두 경우 모두 해당 `item.alive === false`이고 `rng` 호출 횟수가 0인지 확인한다.

### 부가 확인 사항 (불변식은 아니지만 리뷰·테스트 시 확인)
- **투사체 방향:** 일반탄은 항상 `+x`로 직진한다. 스킬탄은 최초 획득한 살아 있는 적을 ID로 락온하고, 대상이 사라졌을 때만 최근접 적을 재획득한다. 중심 거리 150px 미만에서는 회전 계수를 0.3으로 높이고, 대상이 없을 때는 현재 관성을 유지한다. 최초·재획득 거리 제곱이 같으면 `enemies` 배열의 앞선 적을 선택한다.
- **적 투사체 8방향 선택(issue #17, 결정적 rng 매핑):** `index = Math.floor(rng() * 8)`(이론상 `rng() === 1` 방지를 위해 7로 클램프)로 아래 고정 순서 테이블에서 방향 단위벡터를 고른다. 이 순서는 `src/contracts/systems.ts`의 `FireEnemyProjectiles` JSDoc과 정확히 동일하며, 순서를 바꾸면 계약 개정이 필요하다.
  ```
  0: (1, 0)              // 0deg
  1: (1, 1)/sqrt(2)      // 45deg
  2: (0, 1)              // 90deg
  3: (-1, 1)/sqrt(2)     // 135deg
  4: (-1, 0)             // 180deg
  5: (-1, -1)/sqrt(2)    // 225deg
  6: (0, -1)             // 270deg
  7: (1, -1)/sqrt(2)     // 315deg
  ```
  방향 단위벡터에 발사한 적의 `projSpeed`를 곱해 `vx`/`vy`를 정한다(INV-EPROJ-1).
- **적 방향(issue #19로 개정):** 적은 더 이상 항상 `-x`로만 이동하지 않는다. 스폰 직후 단 1회 DASH/OSCILLATE/CIRCLE 중 하나를 무작위로 선택하고, 그 적이 살아있는 동안(소멸 전까지) 절대 재선택하지 않는다 — design.md D-5의 "좌측 방향 직진" 서술은 이 개정으로 대체되었다(INV-EAI-1~5). 단, 좌측 완전 이탈 시 세션 부수효과 없이 제거되는 규칙(INV-ESCAPE-1)은 세 행동 모두에 그대로 유지된다.
- **재시작 게이팅(D-6):** `input.restart`는 `world.session.status === 'gameover'`일 때만 유효하다. 이 게이팅은 `stepWorld`가 아니라 **`hooks/useGameLoop.ts`(접착 계층)**가 담당한다 — `status`가 `'gameover'`가 되면 `stepWorld` 자체가 no-op이 되므로(§1), 재시작 로직(=`createWorld()` 재호출 + `hudStore.reset()`)은 게임 로직이 아니라 훅이 실행한다. `game/**`는 `createWorld()`를 호출할 뿐, "언제 재호출할지"는 판단하지 않는다.
- **월드 재생성 시 상태 누수 금지(D-6):** 재시작은 `createWorld()`가 반환하는 **완전히 새로운 객체**로 `useRef.current`를 교체한다. 기존 `GameWorld`의 필드를 하나씩 리셋하지 않는다.
- **HUD 발행 스로틀 예외:** `status` 필드가 이전 스냅샷과 달라지는 `publish` 호출은 `HUD_PUBLISH_INTERVAL_MS` 스로틀을 무시하고 즉시 반영되어야 한다(구현은 `hooks/useGameLoop.ts` 쪽에서 "마지막 발행 이후 경과 시간 확인"과 별개로 "status 변경 여부"를 체크하는 방식을 권장. `hudStore.publish` 자체는 스로틀 로직을 갖지 않는다 — 호출측 책임).
- **성능 예산(§6.10):** 1프레임의 `stepWorld` + `drawScene` 합계는 5ms 이내여야 한다. `BalanceConfig.limits.maxEnemies`/`maxRegularProjectiles`/`maxSkillProjectiles`를 초과하는 스폰/발사는 (에러를 던지지 않고) **조용히 스킵**한다.
- **렌더 참고(issue #21, Phase 3 구현 담당자용 안내 — 상세 구현은 계약 범위 밖):** `render/palette.ts`에 `'healingItem'` 토큰(하늘색 `#87CEEB`) 추가 필요.

---

## 4. `BalanceConfig` 권장 수치 (그레이박스 초기값)

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
| `player.regularFireCooldownSec` | `0.3` | sec (초당 약 3.33발) |
| `player.skillFireCooldownSec` | `0.15` | sec (초당 약 6.67발) |
| `player.skillStartMana` | `20` | percent, 스킬 시작 임계값 |
| `player.manaRegenPerSec` | `0.5` | percent/sec, 일반 상태 자연 회복 |
| `player.skillManaDrainPerSec` | `30` | percent/sec, 스킬 상태 지속 소모 |
| `player.invulnSec` | `1.0` | sec |
| `regularProjectile.width` | `8` | |
| `regularProjectile.height` | `4` | |
| `regularProjectile.speed` | `480` | px/sec |
| `regularProjectile.damage` | `1` | |
| `regularProjectile.lifetimeSec` | `2.0` | sec (800px / 480px·s⁻¹ ≈ 1.67s보다 여유 있게) |
| `skillProjectile.width` | `20` | |
| `skillProjectile.height` | `20` | |
| `skillProjectile.speed` | `720` | px/sec |
| `skillProjectile.initialSpreadSpeedY` | `120` | px/sec, 발사 시 `vy` 최대 절댓값(60fps에서 ±2px/tick) |
| `skillProjectile.farTurnFactor` | `0.06` | 0~1 무차원/고정 틱, 중심 거리 150px 이상 |
| `skillProjectile.nearTurnFactor` | `0.3` | 0~1 무차원/고정 틱, 중심 거리 150px 미만 |
| `skillProjectile.nearTurnDistancePx` | `150` | px, 근접 회전 부스트의 엄격한 상한 |
| `skillProjectile.damage` | `1` | |
| `skillProjectile.lifetimeSec` | `2.0` | sec |
| `enemy.width` | `28` | |
| `enemy.height` | `28` | |
| `enemy.speed` | `120` | px/sec, **issue #19로 역할 변경**: DASH 행동의 고정 속도 크기(더 이상 "항상 -x"가 아님, INV-EAI-2) |
| `enemy.hp` | `1` | 투사체 1방 처치 |
| `enemy.scoreValue` | `10` | |
| `enemy.manaGain` | `5` | percent |
| `enemy.contactDamage` | `1` | |
| `enemyAi.dashOctoDirectionLevel` | `11` | 레벨, 이 값 이상부터 DASH가 좌하/좌/좌상 3방향 중 하나를 rng로 선택, 미만이면 항상 정좌 고정(INV-EAI-2) |
| `enemyAi.oscillateAmplitudePx` | `40` | px |
| `enemyAi.oscillatePeriodSec` | `1.2` | sec |
| `enemyAi.oscillateDriftSpeed` | `40` | px/sec |
| `enemyAi.circleRadiusPx` | `50` | px |
| `enemyAi.circleAngularSpeedRadPerSec` | `3.0` | rad/sec (약 2.1초에 한 바퀴) |
| `enemyAi.circleDriftSpeed` | `40` | px/sec |
| `enemyProjectile.width` | `10` | px (issue #17) |
| `enemyProjectile.height` | `10` | px |
| `enemyProjectile.speedBase` | `150` | px/sec, 레벨 1 스폰 기준 (INV-EPROJ-1) |
| `enemyProjectile.speedPerLevel` | `10` | px/sec, 레벨당 증가폭(스폰 시점 스냅샷에만 적용) |
| `enemyProjectile.speedMax` | `300` | px/sec, 상한 |
| `enemyProjectile.damage` | `1` | |
| `enemyProjectile.lifetimeSec` | `3.0` | sec, 대각선 이동을 감안해 일반탄보다 여유 있게 |
| `enemyProjectile.fireIntervalBase` | `2.0` | sec, 레벨 1 기준 (INV-EPROJ-2, 매 리셋마다 현재 레벨로 재계산) |
| `enemyProjectile.fireIntervalDecayPerLevel` | `0.08` | sec, 레벨당 단축량 |
| `enemyProjectile.fireIntervalMinSec` | `0.6` | sec, 하한 |
| `healingItem.dropChance` | `0.1` | 0-1 무차원, 투사체 처치당 드롭 확률 10% (issue #21, INV-ITEM-1) |
| `healingItem.width` | `20` | px |
| `healingItem.height` | `20` | px |
| `healingItem.driftVx` | `-90` | px/sec, 좌측 드리프트 (참고 코드 프레임당 -1.5px * 60fps 환산) |
| `healingItem.fallVy` | `120` | px/sec, 하강 (참고 코드 프레임당 2px * 60fps 환산) |
| `healingItem.healAmount` | `1` | HP |
| `healingItem.fullHpBonusScore` | `500` | 점, 만피 상태에서 획득 시 HP 대신 지급 |
| `spawn.initialIntervalSec` | `1.2` | sec |
| `spawn.intervalDecayPerLevel` | `0.1` | sec |
| `spawn.minIntervalSec` | `0.35` | sec (하한) |
| `spawn.marginY` | `20` | px |
| `progression.manaMax` | `100` | percent, D-3 확정 |
| `progression.levelUpScoreStep` | `100` | 점 (레벨 n→n+1은 누적 점수 `n * 100` 도달 시) |
| `progression.maxLevel` | `Number.POSITIVE_INFINITY` | "무제한" — `minIntervalSec` 하한이 실질 상한 역할 |
| `limits.maxEnemies` | `40` | §6.10 |
| `limits.maxRegularProjectiles` | `60` | §6.10 |
| `limits.maxSkillProjectiles` | `60` | §6.10 |
| `limits.maxEnemyProjectiles` | `80` | §6.10 (issue #17) |
| `loop.FIXED_STEP_MS` | `1000 / 60` (≈`16.6667`) | §6.2 **고정** |
| `loop.MAX_FRAME_MS` | `250` | §6.2 **고정** |
| `loop.MAX_SUBSTEPS` | `5` | §6.2 **고정** |
| `loop.HUD_PUBLISH_INTERVAL_MS` | `100` | §6.1 **고정**(10Hz) |

---

## 5. 계약 검증 기록

- **명령(§4.2 Phase 2):** `npx tsc --noEmit --strict --target ES2022 --lib ES2022,DOM --moduleResolution bundler --module ESNext --skipLibCheck src/contracts/index.ts`
- **결과:** 종료 코드 `0`, 출력 없음(에러 0건). 일반탄·스킬탄 엔티티/월드/시스템 계약과 `skill` 입력, MANA 포화 규칙 반영 후 독립 컴파일 통과.
- **추가 정합성 검증:** 단일 투사체 배열·단일 충돌 결과·단일 발사 쿨다운·MANA 초기화·5필드 입력을 전제로 한 구식 참조 검색 결과 0건.

### 5.1 issue #17 — 적 8방향 투사체 계약 개정 (2026-08-25)

- **변경 파일:** `src/contracts/entities.ts`(`EnemyProjectile` 신설, `Enemy.projSpeed`/`Enemy.projFireCooldownRemainSec` 추가), `src/contracts/world.ts`(`GameWorld.enemyProjectiles` 추가), `src/contracts/systems.ts`(`EnemyProjectileHit`/`CollisionResult.enemyProjectileHits`/`FireEnemyProjectiles` 추가, `ApplyMovement`/`ApplyCombat`/`SpawnTick`/`StepWorld`/`CreateWorld` JSDoc 갱신), `src/contracts/balance.ts`(`EnemyProjectileBalance` 신설, `LimitsBalance.maxEnemyProjectiles` 추가).
- **명령:** `./node_modules/.bin/tsc --noEmit --strict --target ES2022 --lib ES2022,DOM --moduleResolution bundler --module ESNext --skipLibCheck src/contracts/index.ts`
- **결과:** 종료 코드 `0`, 출력 없음(에러 0건). `EnemyProjectile` 판별 유니온 추가, `Enemy`/`GameWorld`/`CollisionResult`/`BalanceConfig` 확장, 신규 `FireEnemyProjectiles` 함수 타입 반영 후 독립 컴파일 통과.

### 5.2 issue #19 — 적 행동 패턴(DASH/OSCILLATE/CIRCLE) 계약 개정 (2026-08-25)

- **변경 파일:** `src/contracts/entities.ts`(`Enemy`에 `action`/`actionRemainSec`/`dashVx`/`dashVy`/`oscillateBaseY`/`oscillatePhaseSec`/`circleCenterX`/`circleCenterY`/`circleAngleRad`/`circleDir` 10개 필드 추가), `src/contracts/balance.ts`(`EnemyAiBalance` 신설·`BalanceConfig.enemyAi` 추가, `EnemyBalance.speed` JSDoc을 "DASH 속도 크기"로 개정), `src/contracts/systems.ts`(`ApplyMovement`의 적 이동 서술을 행동 기반으로 전면 개정 및 `@mutates` 확장, 신규 `UpdateEnemyAi` 함수 타입 추가, `SpawnTick`/`StepWorld` JSDoc 갱신).
- **함수 분리 결정:** 적 행동 재선택(무작위성 필요)과 위치 적분(매 틱, 무작위성 불필요)을 `enemyAi.ts`(`updateEnemyAi`, rng 소비)와 기존 `movement.ts`(`applyMovement`, rng 미소비, 시그니처 불변)로 분리했다. `stepWorld` 순서에서 `updateEnemyAi`를 `spawnTick` 바로 다음·`detectCollisions` 이전(새 5단계)에 두어, `applyMovement`(3단계, `spawnTick`보다 먼저 실행)가 항상 "1틱 전에 확정된" 행동 상태만 읽고, 갓 스폰된 적도 같은 틱 안에서 즉시 첫 행동을 배정받도록 했다(상세 근거는 §1 및 INV-EAI-1 참고). 이는 `weapon.ts`(rng로 발사 결정)와 `movement.ts`(rng 없이 매 틱 위치 적분)의 기존 분리 패턴과 동일한 원칙이다.
- **명령:** `./node_modules/.bin/tsc --noEmit --strict --target ES2022 --lib ES2022,DOM --moduleResolution bundler --module ESNext --skipLibCheck src/contracts/index.ts`
- **결과:** 종료 코드 `0`, 출력 없음(에러 0건). `Enemy` 10개 신규 필드, `EnemyAiBalance`/`BalanceConfig.enemyAi`, 신규 `UpdateEnemyAi` 함수 타입 반영 후 독립 컴파일 통과.

### 5.3 issue #19 — 적 행동 재선택 로직 폐기, 스폰 시 1회 선택으로 개정 (2026-08-28)

- **배경:** 사용자 실플레이에서 OSCILLATE로 사인파 이동 중이던 적이 주기적 재선택(`actionRemainSec` 카운트다운)에 의해 DASH/CIRCLE로 갑자기 바뀌는 문제가 확인되었다. 확정된 새 요구사항: 각 적은 스폰 시 단 1회만 행동을 선택하고, 살아있는 동안 절대 재선택하지 않는다.
- **변경 파일:** `src/contracts/entities.ts`(`Enemy.actionRemainSec: number` 필드를 `Enemy.actionInitialized: boolean`으로 교체, `action`/`dashVx`/`oscillateBaseY`/`circleCenterY`/`circleDir` 등 관련 필드 JSDoc을 "영구 유지"로 정정), `src/contracts/systems.ts`(`UpdateEnemyAi` JSDoc을 카운트다운 감소 로직에서 `actionInitialized` 플래그 체크·설정 로직으로 전면 개정, `rng` 소비 횟수를 재선택 기준 2/3회에서 최초 선택 기준 1/2회로 정정, `SpawnTick` JSDoc의 플레이스홀더 조건을 `actionRemainSec === 0`에서 `actionInitialized === false`로 교체), `src/contracts/balance.ts`(`EnemyAiBalance`에서 `actionDurationMinSec`/`actionDurationMaxSec` 필드 제거).
- **명령:** `./node_modules/.bin/tsc --noEmit --strict --target ES2022 --lib ES2022,DOM --moduleResolution bundler --module ESNext --skipLibCheck src/contracts/index.ts`
- **결과:** 종료 코드 `0`, 출력 없음(에러 0건). `actionInitialized` 필드 교체와 `actionDurationMinSec`/`actionDurationMaxSec` 제거 반영 후 독립 컴파일 통과.

### 5.4 issue #19 — 적 DASH 방향 후보에서 비좌측 방향(위/아래/오른쪽) 제외 — 영구 고착 회귀 수정 (2026-08-28)

- **배경:** `INV-EAI-1`(스폰 시 1회 선택, 이후 영구 유지) 개정 이후, DASH 방향 후보에 위/아래/오른쪽(x 성분이 0 이상인 방향)이 포함되어 있어 해당 방향으로 선택된 적이 화면 우측 가장자리 또는 상하단 경계에 영구히 고착되어 `INV-ESCAPE-1`(좌측 완전 이탈 시 소멸)로 소멸하지 못하고 누적되는 회귀가 사용자 실플레이에서 확인되었다("맵 오른쪽 위/아래에 병목처럼 멈춰있는 적들"). 모든 DASH 후보는 항상 ux < 0(좌측 성분)을 만족해야 한다는 제약을 계약에 고정한다.
- **변경 파일:** `src/contracts/systems.ts`(`UpdateEnemyAi`의 DASH 분기 의사코드/JSDoc을 레벨별 rng 소비 0/1회, 후보 인덱스 `[3, 4, 5]`로 갱신), `src/contracts/entities.ts`(`dashVx`/`dashVy` JSDoc에 "항상 좌측 성분(ux<0)을 가짐이 보장된다" 취지 추가), `.claude/_workspace/03_contracts/invariants.md`(`INV-EAI-2` 전면 재작성 — 저레벨은 정좌 고정·rng 소비 0회, 고레벨은 좌하/좌/좌상 3방향 중 rng 1회 선택; `INV-EAI-1`의 rng 소비 서술 정정; §4 밸런스 표 `enemyAi.dashOctoDirectionLevel` 설명 갱신).
- **명령:** `./node_modules/.bin/tsc --noEmit --strict --target ES2022 --lib ES2022,DOM --moduleResolution bundler --module ESNext --skipLibCheck src/contracts/index.ts`
- **결과:** 종료 코드 `0`, 출력 없음(에러 0건). DASH 방향 후보를 좌측 성분 보장 3방향(+저레벨 정좌 고정)으로 축소한 계약 개정 반영 후 독립 컴파일 통과.

### 5.5 issue #21 — 회복 젤리 드롭/획득 계약 신설 (2026-08-28)

- **배경:** 적 처치 시 10% 확률로 회복 젤리를 드롭시키고, 플레이어가 먹으면 HP 회복(만피면 보너스 점수)을 주는 신규 메커니즘. 오케스트레이터가 기존 엔티티/월드/충돌/전투/렌더/틱 파이프라인 구조를 분석해 확정한 설계를 그대로 계약화했다.
- **변경 파일:**
  - `src/contracts/entities.ts` — `HealingItem` 판별 유니온 멤버 신설(`kind: 'healingItem'`, `vx`/`vy`), `Entity` 유니온에 추가.
  - `src/contracts/world.ts` — `GameWorld.healingItems: HealingItem[]` 필드 추가(기존 `enemies`/`regularProjectiles` 등과 동일한 위치·스타일).
  - `src/contracts/systems.ts` — `PlayerItemPickup` 타입 신설(`PlayerContact`와 동일 패턴), `CollisionResult.playerItemPickups` 추가, `DetectCollisions` JSDoc에 플레이어-젤리 스캔 서술 추가(시그니처 불변), `ApplyMovement` JSDoc에 6번째 책임(젤리 이동: 고정 `vx`/`vy`, 클램프 없음, 좌/하단 이탈 시 소멸)과 `@mutates` 확장, **`ApplyCombat` 시그니처를 `(world, collisions, dt) => void`에서 `(world, collisions, dt, rng: Rng) => void`로 변경**(젤리 드롭 확률 판정에 결정적 rng 필요 — `fireWeapon`/`updateEnemyAi`와 동일한 근거)하고 JSDoc에 드롭(소단계 2/3 확장)·획득(신규 소단계 6) 로직을 명문화, `StepWorld`/`CreateWorld` JSDoc 갱신(7단계가 이제 rng를 받음, 초기 월드에 빈 `healingItems` 포함).
  - `src/contracts/balance.ts` — `HealingItemBalance` 신설(`dropChance`/`width`/`height`/`driftVx`/`fallVy`/`healAmount`/`fullHpBonusScore`), `BalanceConfig.healingItem` 추가.
  - `.claude/_workspace/03_contracts/invariants.md` — §1 실행 순서에 `applyCombat(world, collisions, dt, rng)` 반영 및 dead-entity sweep에 `healingItems` 필터 추가, rng 공유 스트림 서술에 7 추가, 신규 `INV-ITEM-1`(드롭 확률/생성, 처치 경로별 rng 소비)·`INV-ITEM-2`(이동: 클램프 없음, 좌/하단 이탈 소멸)·`INV-ITEM-3`(획득: HP 회복 또는 만피 보너스 점수, rng 미소비) 추가, §4 밸런스 표에 `healingItem.*` 7개 행 추가, "부가 확인 사항"에 렌더 참고 1줄 추가.
- **API 변경 주의(공개 인터페이스):** `ApplyCombat`은 이번 개정으로 인자가 3개에서 4개로 늘었다. 이 함수를 직접 호출하는 모든 지점(`stepWorld.ts`, 관련 테스트)은 네 번째 `rng` 인자를 전달하도록 갱신해야 한다.
- **명령:** `./node_modules/.bin/tsc --noEmit --strict --target ES2022 --lib ES2022,DOM --moduleResolution bundler --module ESNext --skipLibCheck src/contracts/index.ts`
- **결과:** 종료 코드 `0`, 출력 없음(에러 0건). `HealingItem` 판별 유니온 추가, `GameWorld`/`CollisionResult`/`BalanceConfig` 확장, `ApplyCombat` 시그니처 변경(3-arg → 4-arg) 반영 후 독립 컴파일 통과.
