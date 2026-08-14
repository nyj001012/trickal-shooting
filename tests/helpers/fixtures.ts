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
  GameSession,
  GameWorld,
  InputState,
  Player,
  Projectile,
  SpawnerState,
} from '@/contracts';

export const DEFAULT_BOUNDS: Bounds = { width: 800, height: 600 };

export function makeInputState(overrides: Partial<InputState> = {}): InputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
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
    fireCooldownRemainSec: 0,
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
    scoreValue: 10,
    manaGain: 5,
    contactDamage: 1,
    ...overrides,
  };
}

export function makeProjectile(overrides: Partial<Projectile> = {}): Projectile {
  return {
    id: 2,
    kind: 'projectile',
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
    projectiles: [],
    session: makeSession(),
    spawner: makeSpawner(),
    nextEntityId: 100,
    ...overrides,
  };
}
