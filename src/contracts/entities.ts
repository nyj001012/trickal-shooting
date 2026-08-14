/**
 * Entity model contracts (SSOT).
 *
 * Rules for this file (see design.md §5.3):
 * - Declarations only. Zero runtime code (no `const`/`function`/`class`/`enum`/`as const` objects).
 * - Zero external dependencies (no react/DOM/other src modules).
 * - `any` forbidden. Finite sets are literal unions. `enum` forbidden.
 * - Only fields that are genuinely immutable after spawn are `readonly`
 *   (design.md §6.5.1: "id, kind, bounds 등").
 */

/**
 * Generic axis-aligned box, used for geometry-only operations (e.g. AABB overlap)
 * that must work identically for any entity kind, and for literal test fixtures.
 */
export interface Box {
  /** px; left edge, world space */
  x: number;
  /** px; top edge, world space */
  y: number;
  /** px */
  width: number;
  /** px */
  height: number;
}

/** Fields shared by every simulated entity kind. */
export interface EntityBase extends Box {
  /** Stable identity, assigned from GameWorld.nextEntityId at spawn time. Never reused. */
  readonly id: number;
  /**
   * false marks the entity for removal at the end of the current tick
   * (see invariants.md "System Execution Order" — dead-entity sweep).
   * Systems must never `splice` mid-iteration; they only flip this flag.
   */
  alive: boolean;
}

/** The player-controlled entity ("에르핀"). Exactly one instance exists per GameWorld. */
export interface Player extends EntityBase {
  readonly kind: 'player';
  /** sec; remaining cooldown before another regular shot. 0 means ready (D-2). */
  regularFireCooldownRemainSec: number;
  /** sec; remaining cooldown before another skill shot. 0 means ready (D-2). */
  skillFireCooldownRemainSec: number;
  /** Whether Space-triggered skill fire is active for the current simulation tick. */
  isSkillFiring: boolean;
  /**
   * sec; remaining invulnerability window after the last HP-reducing contact hit.
   * While > 0, contact damage must not reduce HP again (INV-DMG-1).
   */
  invulnRemainSec: number;
}

/** An enemy entity ("슬라임"). Moves left (-x) every tick until it dies or escapes (D-5). */
export interface Enemy extends EntityBase {
  readonly kind: 'enemy';
  /** count; current remaining hit points. Enemy dies (alive=false) when this reaches <= 0. */
  hp: number;
  /**
   * count; score granted to GameSession.score when this enemy dies to a projectile hit.
   * Captured from BalanceConfig at spawn time so combat.ts stays a pure function of its inputs.
   */
  readonly scoreValue: number;
  /**
   * percent (0-100 scale points, not a 0-1 fraction); mana granted to GameSession.mana
   * when this enemy dies to a projectile hit. Captured from BalanceConfig at spawn time.
   */
  readonly manaGain: number;
  /**
   * count; HP damage dealt to the player on direct contact with this enemy.
   * Captured from BalanceConfig at spawn time.
   */
  readonly contactDamage: number;
}

/** A regular projectile. It always travels in +x and can grant mana on an enemy kill. */
export interface RegularProjectile extends EntityBase {
  readonly kind: 'regularProjectile';
  /**
   * count; HP damage dealt to the enemy it hits. Captured from BalanceConfig at spawn time
   * so collision/combat fixtures never need to import the real balance module.
   */
  readonly damage: number;
  /** sec; remaining lifetime before automatic expiry (safety net if it never leaves bounds). */
  lifetimeRemainSec: number;
}

/** A skill projectile. It locks onto an alive enemy, steers with inertia, and never grants mana. */
export interface SkillProjectile extends EntityBase {
  readonly kind: 'skillProjectile';
  /** count; HP damage dealt to the enemy it hits. */
  readonly damage: number;
  /** sec; remaining lifetime before automatic expiry. */
  lifetimeRemainSec: number;
  /** px/sec; current horizontal velocity, gradually steered while a target exists. */
  vx: number;
  /** px/sec; current vertical velocity, initially spread by injected RNG. */
  vy: number;
  /** Stable Enemy.id currently locked by this projectile; null until acquisition or with no target. */
  targetId: number | null;
  /** 0-1 per fixed tick; interpolation factor outside the near-target radius. */
  readonly farTurnFactor: number;
  /** 0-1 per fixed tick; stronger interpolation factor inside the near-target radius. */
  readonly nearTurnFactor: number;
  /** px; strict center-distance threshold for applying nearTurnFactor. */
  readonly nearTurnDistancePx: number;
}

/**
 * Discriminated union over `kind`. Use this (not Box) whenever code must branch on entity
 * kind — the `switch` must be exhaustive (§6.3 / §6.5.4, `switch-exhaustiveness-check`).
 */
export type Entity = Player | Enemy | RegularProjectile | SkillProjectile;

/** Derived, never hand-duplicated (§6.5.4). */
export type EntityKind = Entity['kind'];
