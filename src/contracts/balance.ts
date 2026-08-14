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
  /** px/sec; always applied along -x (D-5). */
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
  readonly spawn: SpawnBalance;
  readonly progression: ProgressionBalance;
  readonly limits: LimitsBalance;
  readonly loop: LoopBalance;
}
