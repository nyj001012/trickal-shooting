/**
 * Typed fixture builders for `src/contracts` shapes (design.md §6.8 — "픽스처는
 * tests/helpers/**에 타입 붙은 빌더로 작성한다").
 *
 * These builders exist purely to keep test files terse; every field defaults to a
 * plausible, contract-valid value and can be overridden per-test via `Partial<T>`.
 * They must never import anything from `src/game/**`, `src/hooks/**`, or `src/ui/**`
 * (frontend-qa clean room — only `@/contracts` is a legitimate dependency here).
 */
import type {
  Bounds,
  Enemy,
  EnemyProjectile,
  GameSession,
  GameWorld,
  HealingItem,
  InputState,
  Player,
  RegularProjectile,
  SkillProjectile,
  SpawnerState,
} from '@/contracts';

export const DEFAULT_BOUNDS: Bounds = { width: 800, height: 600 };

export function makeInputState(overrides: Partial<InputState> = {}): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    skill: false,
    restart: false,
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 0,
    kind: 'player',
    x: 40,
    y: 300,
    width: 32,
    height: 32,
    alive: true,
    regularFireCooldownRemainSec: 0,
    skillFireCooldownRemainSec: 0,
    isSkillFiring: false,
    invulnRemainSec: 0,
    ...overrides,
  };
}

export function makeEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    id: 1,
    kind: 'enemy',
    x: 800,
    y: 300,
    width: 28,
    height: 28,
    alive: true,
    hp: 1,
    // Issue #19 (INV-EAI-1..5, revised 2026-08-28) — action-based motion, selected
    // exactly once on spawn and held permanently thereafter (no periodic re-roll).
    // Defaults are plausible but arbitrary placeholders; tests that care about a
    // specific action's fields override them explicitly rather than relying on these
    // values. `actionInitialized: true` by default so a fixture enemy behaves as an
    // already-settled enemy unless a test explicitly opts into the pre-selection state
    // via `actionInitialized: false`.
    action: 'dash',
    actionInitialized: true,
    dashVx: -120,
    dashVy: 0,
    oscillateBaseY: 300,
    oscillatePhaseSec: 0,
    circleCenterX: 0,
    circleCenterY: 0,
    circleAngleRad: 0,
    circleDir: 1,
    scoreValue: 10,
    manaGain: 5,
    contactDamage: 1,
    // Matches BALANCE.enemyProjectile.speedBase at level 1 (INV-EPROJ-1's frozen
    // spawn-time snapshot); override explicitly when a test needs a different level.
    projSpeed: 150,
    // 0 = ready to fire immediately; override to exercise the cooldown-gate itself.
    projFireCooldownRemainSec: 0,
    ...overrides,
  };
}

export function makeEnemyProjectile(overrides: Partial<EnemyProjectile> = {}): EnemyProjectile {
  return {
    id: 4,
    kind: 'enemyProjectile',
    x: 400,
    y: 300,
    width: 10,
    height: 10,
    alive: true,
    vx: 150,
    vy: 0,
    damage: 1,
    lifetimeRemainSec: 3,
    ...overrides,
  };
}

export function makeRegularProjectile(
  overrides: Partial<RegularProjectile> = {},
): RegularProjectile {
  return {
    id: 2,
    kind: 'regularProjectile',
    x: 100,
    y: 300,
    width: 8,
    height: 4,
    alive: true,
    damage: 1,
    lifetimeRemainSec: 2,
    ...overrides,
  };
}

export function makeSkillProjectile(overrides: Partial<SkillProjectile> = {}): SkillProjectile {
  return {
    id: 3,
    kind: 'skillProjectile',
    x: 100,
    y: 300,
    width: 20,
    height: 20,
    alive: true,
    damage: 1,
    lifetimeRemainSec: 2,
    vx: 720,
    vy: 0,
    targetId: null,
    farTurnFactor: 0.06,
    nearTurnFactor: 0.3,
    nearTurnDistancePx: 150,
    ...overrides,
  };
}

/**
 * A healing item ("회복 젤리", issue #21, 2026-08-28 drift-removal revision). Fixed in
 * place at spawn — this kind no longer has `vx`/`vy` (INV-ITEM-2). It despawns purely
 * via `lifetimeRemainSec` counting down to 0 by `dt` each tick. Defaults to a plausible
 * mid-field position and a lifetime matching the recommended
 * `BalanceConfig.healingItem.lifetimeSec` value (4.0s, see invariants.md INV-ITEM-2);
 * tests that care about a specific despawn timing or a specific enemy-center placement
 * override x/y/lifetimeRemainSec explicitly rather than relying on these values.
 */
export function makeHealingItem(overrides: Partial<HealingItem> = {}): HealingItem {
  return {
    id: 5,
    kind: 'healingItem',
    x: 400,
    y: 300,
    width: 20,
    height: 20,
    alive: true,
    lifetimeRemainSec: 4,
    ...overrides,
  };
}

export function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    hp: 3,
    maxHp: 3,
    mana: 0,
    score: 0,
    level: 1,
    status: 'playing',
    ...overrides,
  };
}

export function makeSpawner(overrides: Partial<SpawnerState> = {}): SpawnerState {
  return {
    intervalRemainSec: 1.2,
    currentIntervalSec: 1.2,
    ...overrides,
  };
}

export function makeWorld(overrides: Partial<GameWorld> = {}): GameWorld {
  return {
    bounds: DEFAULT_BOUNDS,
    player: makePlayer(),
    enemies: [],
    regularProjectiles: [],
    skillProjectiles: [],
    enemyProjectiles: [],
    healingItems: [],
    session: makeSession(),
    spawner: makeSpawner(),
    nextEntityId: 100,
    ...overrides,
  };
}
