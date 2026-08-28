/**
 * `BalanceConfig` — the exhaustive key list from design.md §6.6.1. Types only; the
 * actual numeric values live in `src/game/balance.ts` (frontend-developer,
 * `as const satisfies BalanceConfig`). See `.claude/_workspace/03_contracts/invariants.md`
 * for the recommended greybox values table.
 *
 * Keys must not be renamed, removed, or restructured without a contract revision.
 * Declarations only — see the header rules in `entities.ts`.
 */

export interface CanvasBalance {
  /** px; fixed logical width (§1.1). */
  readonly width: number;
  /** px; fixed logical height (§1.1). */
  readonly height: number;
}

export interface PlayerBalance {
  /** px; initial x position on `createWorld()`. */
  readonly spawnX: number;
  /** px; initial y position on `createWorld()`. */
  readonly spawnY: number;
  /** px; AABB width. */
  readonly width: number;
  /** px; AABB height. */
  readonly height: number;
  /** px/sec; movement speed, applied AFTER diagonal normalization (D-1, INV-MOVE-1). */
  readonly speed: number;
  /** count; starting and maximum HP. */
  readonly maxHp: number;
  /** sec; automatic-fire interval between regular shots (D-2). */
  readonly regularFireCooldownSec: number;
  /** sec; interval between skill shots while skill fire is active (D-2). */
  readonly skillFireCooldownSec: number;
  /** percent; minimum mana required to enter skill-fire mode. */
  readonly skillStartMana: number;
  /** percent/sec; passive mana recovery while skill fire is inactive. */
  readonly manaRegenPerSec: number;
  /** percent/sec; mana consumption while skill fire is active. */
  readonly skillManaDrainPerSec: number;
  /** sec; invulnerability window granted after a contact hit (INV-DMG-1). */
  readonly invulnSec: number;
}

export interface RegularProjectileBalance {
  /** px; AABB width. */
  readonly width: number;
  /** px; AABB height. */
  readonly height: number;
  /** px/sec; always applied along +x (D-2). */
  readonly speed: number;
  /** count; HP damage dealt to an enemy on hit. */
  readonly damage: number;
  /** sec; auto-expiry safety net if the projectile never leaves the bounds. */
  readonly lifetimeSec: number;
}

export interface SkillProjectileBalance {
  /** px; AABB width. */
  readonly width: number;
  /** px; AABB height. */
  readonly height: number;
  /** px/sec; magnitude of the homing velocity vector (D-2). */
  readonly speed: number;
  /** px/sec; maximum absolute initial Y velocity before steering (D-2). */
  readonly initialSpreadSpeedY: number;
  /** 0-1 per fixed tick; interpolation factor outside nearTurnDistancePx (D-2). */
  readonly farTurnFactor: number;
  /** 0-1 per fixed tick; interpolation factor strictly inside nearTurnDistancePx (D-2). */
  readonly nearTurnFactor: number;
  /** px; strict center-distance threshold for the near-target turn boost (D-2). */
  readonly nearTurnDistancePx: number;
  /** count; HP damage dealt to an enemy on hit. */
  readonly damage: number;
  /** sec; auto-expiry safety net. */
  readonly lifetimeSec: number;
}

export interface EnemyBalance {
  /** px; AABB width. */
  readonly width: number;
  /** px; AABB height. */
  readonly height: number;
  /**
   * px/sec; magnitude of the constant velocity vector used by the DASH behavior
   * (issue #19 — supersedes the original design.md D-5 "always applied along -x"
   * description; see invariants.md INV-EAI-2). OSCILLATE and CIRCLE use their own
   * dedicated speed fields in `EnemyAiBalance` instead of this one.
   */
  readonly speed: number;
  /** count; starting hit points. */
  readonly hp: number;
  /** count; score granted to the session on death by projectile. */
  readonly scoreValue: number;
  /** percent; mana granted to the session on death by projectile. */
  readonly manaGain: number;
  /** count; HP damage dealt to the player on direct contact. */
  readonly contactDamage: number;
}

/**
 * Tuning for the three randomized enemy movement behaviors introduced in issue #19
 * (DASH / OSCILLATE / CIRCLE). See invariants.md INV-EAI-1..5 for the formulas that
 * consume these values.
 */
export interface EnemyAiBalance {
  /**
   * integer level threshold. While `world.session.level < dashOctoDirectionLevel`, a
   * newly-selected DASH direction is drawn only from the 4 cardinal compass directions
   * (0/90/180/270 deg); at or above this level it is drawn from all 8 compass directions
   * (adding the 45/135/225/315 deg diagonals), matching `FireEnemyProjectiles`' fixed
   * 8-direction table (INV-EAI-2).
   */
  readonly dashOctoDirectionLevel: number;
  /** px; amplitude of the OSCILLATE behavior's vertical sine wave around `oscillateBaseY`. */
  readonly oscillateAmplitudePx: number;
  /** sec; period of one full OSCILLATE sine cycle. */
  readonly oscillatePeriodSec: number;
  /** px/sec; constant leftward drift speed applied to `x` while OSCILLATE is active. */
  readonly oscillateDriftSpeed: number;
  /** px; radius of the CIRCLE behavior's orbit. */
  readonly circleRadiusPx: number;
  /** rad/sec; angular speed of `circleAngleRad`, before the `circleDir` sign is applied. */
  readonly circleAngularSpeedRadPerSec: number;
  /** px/sec; constant leftward drift speed applied to `circleCenterX` while CIRCLE is active. */
  readonly circleDriftSpeed: number;
}

export interface EnemyProjectileBalance {
  /** px; AABB width. */
  readonly width: number;
  /** px; AABB height. */
  readonly height: number;
  /**
   * px/sec; EnemyProjectile speed magnitude for an enemy spawning at level 1. Combined
   * with `speedPerLevel`/`speedMax` to compute each Enemy's frozen `readonly projSpeed`
   * snapshot at the moment that enemy spawns (issue #17 requirement 1; INV-EPROJ-1).
   */
  readonly speedBase: number;
  /**
   * px/sec per level; amount `projSpeed` increases for each level above 1 AT THE MOMENT
   * an enemy spawns. Never applied retroactively to an already-spawned enemy.
   */
  readonly speedPerLevel: number;
  /** px/sec; ceiling applied to the computed `projSpeed` snapshot. */
  readonly speedMax: number;
  /** count; HP damage dealt to the player on hit. */
  readonly damage: number;
  /**
   * sec; auto-expiry safety net if a projectile's fixed direction never carries it off
   * any of the 4 playfield edges (INV-EPROJ-3).
   */
  readonly lifetimeSec: number;
  /**
   * sec; interval between shots for an enemy currently at level 1. Unlike the speed
   * fields above, this (with the two fields below) is recomputed from the CURRENT level
   * every time an enemy's fire cooldown resets — it is never snapshotted per-enemy
   * (issue #17 requirement 2; INV-EPROJ-2).
   */
  readonly fireIntervalBase: number;
  /** sec; amount the fire interval shrinks per level above 1 (mirrors SpawnBalance). */
  readonly fireIntervalDecayPerLevel: number;
  /** sec; floor below which the fire interval never shrinks further. */
  readonly fireIntervalMinSec: number;
}

/**
 * Tuning for the healing-item drop/pickup mechanic introduced in issue #21. See
 * invariants.md INV-ITEM-1..3 for the formulas that consume these values.
 */
export interface HealingItemBalance {
  /** 0-1 fraction; probability that a projectile-kill enemy death drops one item (INV-ITEM-1). */
  readonly dropChance: number;
  /** px; AABB width. */
  readonly width: number;
  /** px; AABB height. */
  readonly height: number;
  /** sec; total lifetime before automatic despawn if never picked up (INV-ITEM-2). */
  readonly lifetimeSec: number;
  /**
   * sec; once `lifetimeRemainSec` drops to this value or below, the item blinks
   * (same 100ms-interval flash cadence as the player's invulnerability visual) until it
   * despawns (INV-ITEM-2, render hint only — no behavioral effect).
   */
  readonly blinkRemainSec: number;
  /** count; HP restored to the player on pickup, capped at `player.maxHp` (INV-ITEM-3). */
  readonly healAmount: number;
  /** count; score granted instead of HP when picked up while already at `player.maxHp` (INV-ITEM-3). */
  readonly fullHpBonusScore: number;
}

export interface SpawnBalance {
  /** sec; interval between spawns at level 1. */
  readonly initialIntervalSec: number;
  /** sec; amount the interval shrinks per level-up (D-4). */
  readonly intervalDecayPerLevel: number;
  /** sec; floor below which the interval never shrinks further (§6.2.1-(5)). */
  readonly minIntervalSec: number;
  /** px; top/bottom margin kept clear when choosing a spawn y. */
  readonly marginY: number;
}

export interface ProgressionBalance {
  /** percent; saturation ceiling for every mana increase (D-3; always 100 here). */
  readonly manaMax: number;
  /** count; score distance between consecutive level-ups (D-4). */
  readonly levelUpScoreStep: number;
  /**
   * integer, or `Number.POSITIVE_INFINITY` for "no cap". Ceiling on `session.level`,
   * enforced together with `SpawnBalance.minIntervalSec`.
   */
  readonly maxLevel: number;
}

export interface LimitsBalance {
  /** count; hard cap enforced by `spawnTick` (§6.10 performance budget). */
  readonly maxEnemies: number;
  /** count; hard cap for `world.regularProjectiles`, enforced by `fireWeapon`. */
  readonly maxRegularProjectiles: number;
  /** count; hard cap for `world.skillProjectiles`, enforced by `fireWeapon`. */
  readonly maxSkillProjectiles: number;
  /**
   * count; hard cap for `world.enemyProjectiles`, enforced by `fireEnemyProjectiles`
   * (issue #17; §6.10 performance budget).
   */
  readonly maxEnemyProjectiles: number;
}

export interface LoopBalance {
  /** ms; fixed simulation step, `1000 / 60` (§6.2). */
  readonly FIXED_STEP_MS: number;
  /** ms; per-frame elapsed-time clamp before accumulation (§6.2). */
  readonly MAX_FRAME_MS: number;
  /** count; max `stepWorld` calls drained from the accumulator in one rAF frame (§6.2). */
  readonly MAX_SUBSTEPS: number;
  /** ms; minimum spacing between non-status-transition HUD publishes (§6.1). */
  readonly HUD_PUBLISH_INTERVAL_MS: number;
}

/** The complete, flat-by-group tuning surface for this phase. See §6.6.1 for the SSOT key list. */
export interface BalanceConfig {
  readonly canvas: CanvasBalance;
  readonly player: PlayerBalance;
  readonly regularProjectile: RegularProjectileBalance;
  readonly skillProjectile: SkillProjectileBalance;
  readonly enemy: EnemyBalance;
  readonly enemyAi: EnemyAiBalance;
  readonly enemyProjectile: EnemyProjectileBalance;
  readonly healingItem: HealingItemBalance;
  readonly spawn: SpawnBalance;
  readonly progression: ProgressionBalance;
  readonly limits: LimitsBalance;
  readonly loop: LoopBalance;
}
