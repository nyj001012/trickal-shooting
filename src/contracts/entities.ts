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

/**
 * An enemy entity ("슬라임"). As of issue #19, an enemy's per-tick motion is governed by
 * one of three behaviors (`action`) that it selects exactly once, immediately on spawn,
 * and keeps for the rest of its life — this supersedes design.md D-5's original "always
 * moves left at a constant speed" description; see invariants.md INV-EAI-1..5 for the
 * authoritative formulas. Regardless of `action`, the enemy still dies with no session
 * side effects the tick it fully exits the left edge (`x + width < 0`, unchanged
 * INV-ESCAPE-1).
 */
export interface Enemy extends EntityBase {
  readonly kind: 'enemy';
  /** count; current remaining hit points. Enemy dies (alive=false) when this reaches <= 0. */
  hp: number;
  /**
   * The behavior this enemy executes for its entire lifetime (issue #19, amended:
   * periodic re-roll removed). Chosen uniformly at random by `updateEnemyAi` exactly once,
   * on the first tick after spawn while `actionInitialized === false` (INV-EAI-1).
   * `applyMovement` reads this every tick to decide which of the three
   * position-integration formulas to apply (INV-EAI-2/3/4); it never changes `action`
   * itself. Once selected, `action` never changes again for this enemy.
   */
  action: 'dash' | 'oscillate' | 'circle';
  /**
   * Whether this enemy has already been assigned its permanent `action` (issue #19,
   * amended: replaces the removed countdown-based re-roll timer). `spawnTick` initializes
   * this to `false`. On the first tick where it is `false`, `updateEnemyAi` selects
   * `action` (and every field below that belongs to the chosen action) exactly once, then
   * flips this to `true`. While `true`, `updateEnemyAi` never re-selects or mutates any of
   * these fields again for this enemy — they hold for the enemy's entire remaining
   * lifetime (INV-EAI-1).
   */
  actionInitialized: boolean;
  /**
   * px/sec; horizontal velocity for the DASH behavior. Chosen once when DASH is selected
   * (from a fixed compass-direction table gated by `world.session.level`, INV-EAI-2) and
   * held constant for the enemy's entire remaining lifetime. Meaningless while
   * `action !== 'dash'`.
   */
  dashVx: number;
  /** px/sec; vertical velocity for the DASH behavior. Same lifetime rules as `dashVx`. */
  dashVy: number;
  /**
   * px; the y position captured at the moment the OSCILLATE behavior was selected.
   * `applyMovement` oscillates around this baseline every tick for the enemy's entire
   * remaining lifetime (INV-EAI-3). Meaningless while `action !== 'oscillate'`.
   */
  oscillateBaseY: number;
  /**
   * sec; cumulative elapsed time since the OSCILLATE behavior was selected. Initialized to
   * 0 by `updateEnemyAi` on selection, then incremented by `dt` every tick by
   * `applyMovement` (never by `updateEnemyAi`) for as long as `action === 'oscillate'`
   * (INV-EAI-3). Meaningless while `action !== 'oscillate'`.
   */
  oscillatePhaseSec: number;
  /**
   * px; x of the CIRCLE behavior's orbit center. Initialized by `updateEnemyAi` on
   * selection so the enemy's current position lands exactly on the orbit at
   * `circleAngleRad = 0` (no visible teleport), then drifted left every tick by
   * `applyMovement` for the enemy's entire remaining lifetime (INV-EAI-4). Meaningless
   * while `action !== 'circle'`.
   */
  circleCenterX: number;
  /**
   * px; y of the CIRCLE behavior's orbit center. Initialized once on selection (same
   * continuity rule as `circleCenterX`) and never changes afterward — only the center's
   * x drifts left; y is fixed for the enemy's entire remaining lifetime (INV-EAI-4).
   * Meaningless while `action !== 'circle'`.
   */
  circleCenterY: number;
  /**
   * rad; cumulative orbit angle. Initialized to 0 by `updateEnemyAi` on selection, then
   * incremented every tick by `applyMovement` by
   * `BalanceConfig.enemyAi.circleAngularSpeedRadPerSec * circleDir * dt` (INV-EAI-4).
   * Meaningless while `action !== 'circle'`.
   */
  circleAngleRad: number;
  /**
   * Rotation direction for the CIRCLE behavior: `1` for increasing `circleAngleRad`
   * (counter-clockwise in standard math orientation), `-1` for decreasing (clockwise).
   * Chosen uniformly at random by `updateEnemyAi` once, when CIRCLE is selected
   * (INV-EAI-4), and held for the enemy's entire remaining lifetime. Meaningless while
   * `action !== 'circle'`.
   */
  circleDir: 1 | -1;
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
  /**
   * px/sec; magnitude of velocity given to every EnemyProjectile this enemy fires.
   * Computed once from `BalanceConfig.enemyProjectile` and `world.session.level` AT THE
   * MOMENT THIS ENEMY SPAWNS, then frozen for this enemy's entire lifetime (issue #17
   * requirement 1; INV-EPROJ-1). A later level-up never changes this value, nor the
   * `vx`/`vy` of any EnemyProjectile this enemy has already fired.
   */
  readonly projSpeed: number;
  /**
   * sec; remaining cooldown before this enemy may fire another EnemyProjectile. 0 means
   * ready. Unlike `projSpeed`, the interval used to reset this cooldown is recomputed
   * from the CURRENT `world.session.level` every time it resets — only the projectile's
   * speed is a frozen per-enemy snapshot, not the firing interval (issue #17
   * requirement 2; INV-EPROJ-2).
   */
  projFireCooldownRemainSec: number;
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
 * A projectile fired by an enemy in one of the 8 fixed compass directions
 * (0/45/90/135/180/225/270/315 deg). Unlike SkillProjectile, its velocity is derived once
 * at spawn time from the firing enemy's frozen `projSpeed` snapshot and never changes
 * afterward — there is no homing/steering for this kind (issue #17 requirement 1/5).
 */
export interface EnemyProjectile extends EntityBase {
  readonly kind: 'enemyProjectile';
  /**
   * px/sec; horizontal velocity component. Fixed for this projectile's entire lifetime —
   * set once, at creation, to (chosen 8-direction unit vector).x * (firing enemy's
   * `projSpeed`). Never re-derived or steered afterward (contrast with
   * `SkillProjectile.vx`, which is re-steered every tick by `applyMovement`).
   */
  readonly vx: number;
  /** px/sec; vertical velocity component, fixed for the same reason as `vx` above. */
  readonly vy: number;
  /**
   * count; HP damage dealt to the player on hit. Captured from
   * `BalanceConfig.enemyProjectile` at the moment this projectile is created (not derived
   * from the firing enemy), so it is independent of any per-enemy snapshot logic.
   */
  readonly damage: number;
  /**
   * sec; remaining lifetime before automatic expiry — a safety net in case a projectile's
   * direction never carries it off any of the 4 playfield edges (INV-EPROJ-3).
   */
  lifetimeRemainSec: number;
}

/**
 * Discriminated union over `kind`. Use this (not Box) whenever code must branch on entity
 * kind — the `switch` must be exhaustive (§6.3 / §6.5.4, `switch-exhaustiveness-check`).
 */
export type Entity = Player | Enemy | RegularProjectile | SkillProjectile | EnemyProjectile;

/** Derived, never hand-duplicated (§6.5.4). */
export type EntityKind = Entity['kind'];
