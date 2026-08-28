/**
 * Function-signature contracts for `src/game/**`.
 *
 * Every exported type here is a *named function type* (design.md §5.4): implementers
 * bind their function to it directly —
 *   `export const stepWorld: StepWorld = (world, input, dt, rng) => { ... }`
 * — instead of retyping the signature by hand, so any drift becomes a compile error.
 *
 * Each type carries a `@module` JSDoc tag naming the file that is expected to implement
 * it (design.md §5.2) and a `@mutates` tag naming exactly which fields it is allowed to
 * write (design.md §5.3 rule 7). Anything not listed under `@mutates` must not be
 * written by that function. Functions with no `@mutates` tag are pure: same input ->
 * same output, no reference to DOM/window/Date/Math.random (§6.0 rule 1).
 *
 * Declarations only — see the header rules in `entities.ts`.
 */

import type {
  Box,
  Enemy,
  EnemyProjectile,
  HealingItem,
  RegularProjectile,
  SkillProjectile,
} from './entities';
import type { GameWorld, InputState, Rng } from './world';

// ---------------------------------------------------------------------------
// collision.ts
// ---------------------------------------------------------------------------

/** One regular projectile that overlapped one enemy this tick. */
export interface RegularProjectileHit {
  readonly projectile: Readonly<RegularProjectile>;
  readonly enemy: Readonly<Enemy>;
}

/** One skill projectile that overlapped one enemy this tick. */
export interface SkillProjectileHit {
  readonly projectile: Readonly<SkillProjectile>;
  readonly enemy: Readonly<Enemy>;
}

/** The player overlapped one enemy this tick via direct contact (not a projectile). */
export interface PlayerContact {
  readonly enemy: Readonly<Enemy>;
}

/**
 * One enemy-fired projectile that overlapped `world.player` this tick. There is no
 * `enemy` field here (unlike `RegularProjectileHit`/`SkillProjectileHit`) because the
 * target is always the single `world.player`, not an array entry — this is a distinct
 * collision path from `PlayerContact` (issue #17 requirement 4).
 */
export interface EnemyProjectileHit {
  readonly projectile: Readonly<EnemyProjectile>;
}

/**
 * The player overlapped one alive `HealingItem` this tick (issue #21). Same pattern as
 * `PlayerContact`: only `world.player` participates (never an array entry on the other
 * side of a projectile), so there is no `enemy`-style companion field.
 */
export interface PlayerItemPickup {
  readonly item: Readonly<HealingItem>;
}

/** Everything `combat.ts` needs to apply the effects of this tick's overlaps. */
export interface CollisionResult {
  readonly regularProjectileHits: readonly RegularProjectileHit[];
  readonly skillProjectileHits: readonly SkillProjectileHit[];
  readonly playerContacts: readonly PlayerContact[];
  readonly enemyProjectileHits: readonly EnemyProjectileHit[];
  readonly playerItemPickups: readonly PlayerItemPickup[];
}

/**
 * Pure axis-aligned bounding box overlap test. Carries no entity-kind knowledge, so it
 * is testable with two `Box` literals and reused for every entity pair.
 *
 * **Boundary rule (strict inequality — edge/corner touch is NOT an overlap):**
 * ```
 * overlap(a, b) =
 *      a.x        <  b.x + b.width
 *   && a.x + a.width  >  b.x
 *   && a.y        <  b.y + b.height
 *   && a.y + a.height >  b.y
 * ```
 * All four comparisons use `<`/`>` (never `<=`/`>=`). Two boxes that merely touch along
 * an edge or at a corner (e.g. `a.x + a.width === b.x`) are **not** overlapping — this
 * function returns `false` for that case. This is required for INV-SPAWN-1 to hold
 * exactly as stated (an enemy spawned at `x === world.bounds.width`, i.e. its left edge
 * exactly on the right boundary, must not register as overlapping the player even if
 * their y-ranges touch) and applies uniformly everywhere this function is used:
 * `detectCollisions` uses the same strict rule for regular-projectile hits,
 * skill-projectile hits, and player-enemy contacts, so merely grazing an edge on a given
 * tick (zero-area or zero-width intersection) deals no damage that tick. See
 * invariants.md — "AABB Overlap Boundary Rule".
 * @module @/game/systems/collision
 */
export type AabbOverlap = (a: Readonly<Box>, b: Readonly<Box>) => boolean;

/**
 * Independently scans `world.regularProjectiles` and `world.skillProjectiles` against
 * `world.enemies`, scans `world.player` against `world.enemies` (`playerContacts`), scans
 * `world.enemyProjectiles` against `world.player` (`enemyProjectileHits` — a distinct path
 * from `playerContacts`, issue #17 requirement 4), and — only while `world.player.alive`
 * — scans `world.player` against every alive `world.healingItems` entry
 * (`playerItemPickups`, issue #21, same scan pattern as `playerContacts`). Only alive
 * entities participate. Performs no mutation or removal and keeps all hit lists separate
 * for `combat.ts`. Uses `AabbOverlap`'s strict boundary rule everywhere.
 * @module @/game/systems/collision
 */
export type DetectCollisions = (world: Readonly<GameWorld>) => CollisionResult;

// ---------------------------------------------------------------------------
// movement.ts
// ---------------------------------------------------------------------------

/**
 * One system, five responsibilities, run in this fixed sub-order every tick
 * (see invariants.md for the exact formulas):
 *   1. Player: resolve up/down/left/right into a diagonal-normalized displacement
 *      (INV-MOVE-1), apply it, then clamp both axes to `world.bounds` in the same tick
 *      (INV-MOVE-2).
 *   2. Enemies (issue #19 — action-based motion, supersedes the original constant `-x`
 *      description): for every alive enemy, integrate position from its CURRENT
 *      `action` and that action's fields (set by the most recent `updateEnemyAi` call,
 *      which always runs AFTER this system within the same tick — see the System
 *      Execution Order in invariants.md — so this system always reads one-tick-old
 *      decisions, never a same-tick reselection) using exactly one of:
 *      - `'dash'`: `x += dashVx * dt; y += dashVy * dt` (constant velocity, no other
 *        field changes).
 *      - `'oscillate'`: `x -= BalanceConfig.enemyAi.oscillateDriftSpeed * dt;
 *        oscillatePhaseSec += dt; y = oscillateBaseY + BalanceConfig.enemyAi.oscillateAmplitudePx
 *        * Math.sin((2 * Math.PI / BalanceConfig.enemyAi.oscillatePeriodSec) * oscillatePhaseSec)`.
 *      - `'circle'`: `circleCenterX -= BalanceConfig.enemyAi.circleDriftSpeed * dt;
 *        circleAngleRad += BalanceConfig.enemyAi.circleAngularSpeedRadPerSec * circleDir * dt;
 *        x = circleCenterX + BalanceConfig.enemyAi.circleRadiusPx * Math.cos(circleAngleRad) - width / 2;
 *        y = circleCenterY + BalanceConfig.enemyAi.circleRadiusPx * Math.sin(circleAngleRad) - height / 2`
 *        (`circleCenterY` is read-only here — it never drifts, only `circleCenterX` does).
 *      Then, for EVERY alive enemy regardless of `action` (INV-EAI-5): clamp
 *      `y = clamp(y, 0, world.bounds.height - height)` (top/bottom — both edges);
 *      clamp `x = Math.min(x, world.bounds.width - width)` (right edge only — the left
 *      edge is deliberately never clamped, so DASH/OSCILLATE/CIRCLE can still exit
 *      left); then, unchanged from before issue #19, any enemy whose right edge has
 *      crossed the left screen edge (`x + width < 0`) becomes `alive = false` in the
 *      same tick without changing HP or any other session field (INV-ESCAPE-1).
 *   3. Regular projectiles: move every alive projectile by `+regularSpeed * dt` on x,
 *      decrement its lifetime, and expire it at the right edge or at lifetime zero.
 *   4. Skill projectiles: retain the alive enemy matching `targetId`; only when that lock
 *      is absent, reacquire the nearest alive enemy by center-distance squared (first
 *      array entry wins ties). Interpolate toward the desired `skillSpeed` vector with
 *      `nearTurnFactor` strictly inside `nearTurnDistancePx`, otherwise
 *      `farTurnFactor`; normalize back to `skillSpeed`, then move. A zero/non-finite
 *      interpolated vector falls back to the desired vector. With no target they clear
 *      `targetId` and retain the current velocity. Decrement lifetime and expire outside
 *      any playfield edge or at lifetime zero.
 *   5. Enemy projectiles: move every alive projectile by its fixed `vx * dt` / `vy * dt`
 *      (never re-derived or steered here — that only happens once, at creation, in
 *      `fireEnemyProjectiles`), decrement its lifetime, and expire it the tick it exits
 *      the playfield through ANY of the 4 edges — `x + width < 0 || x > bounds.width ||
 *      y + height < 0 || y > bounds.height` — or at lifetime zero (INV-EPROJ-3). This is
 *      unlike regular projectiles, which only ever check the right edge.
 *   6. Healing items (issue #21, 2026-08-28 revision — replaces the original left/down
 *      drift): apply NO movement at all — `x`/`y` never change after spawn. Instead,
 *      decrement `lifetimeRemainSec` by `dt` (floored at 0 via `Math.max(0, ...)`) for
 *      every alive item, and expire it (`alive = false`) once it reaches 0. There is no
 *      boundary check of any kind for this entity kind (INV-ITEM-2).
 * @mutates world.player.x, world.player.y, world.enemies[].x, world.enemies[].y,
 *          world.enemies[].alive, world.enemies[].oscillatePhaseSec,
 *          world.enemies[].circleAngleRad, world.enemies[].circleCenterX,
 *          world.regularProjectiles[].x, world.regularProjectiles[].lifetimeRemainSec,
 *          world.regularProjectiles[].alive, world.skillProjectiles[].x,
 *          world.skillProjectiles[].y, world.skillProjectiles[].vx,
 *          world.skillProjectiles[].vy, world.skillProjectiles[].targetId,
 *          world.skillProjectiles[].lifetimeRemainSec, world.skillProjectiles[].alive,
 *          world.enemyProjectiles[].x, world.enemyProjectiles[].y,
 *          world.enemyProjectiles[].lifetimeRemainSec, world.enemyProjectiles[].alive,
 *          world.healingItems[].lifetimeRemainSec, world.healingItems[].alive
 * @module @/game/systems/movement
 */
export type ApplyMovement = (world: GameWorld, input: Readonly<InputState>, dt: number) => void;

// ---------------------------------------------------------------------------
// weapon.ts
// ---------------------------------------------------------------------------

/**
 * Decrements both projectile cooldowns first. Space may enter skill mode only with at
 * least `skillStartMana`; once active, holding Space and positive mana maintain it.
 * Skill mode drains mana, may spawn one skill projectile, and never spawns or regenerates
 * a regular projectile in the same tick. Otherwise mana regenerates and one regular
 * projectile may auto-fire. Every mana update saturates to [0, manaMax]. At either
 * projectile cap, creation is skipped and that cooldown still resets (INV-FIRE-1,
 * INV-MANA-1). If drain reaches zero, the current tick stays skill-only and the mode is
 * disabled for the following tick. When a skill projectile is actually added, `rng` is
 * consumed exactly once to derive its initial Y velocity in the configured symmetric
 * spread range; skipped/capped shots do not consume it.
 * @mutates world.player.regularFireCooldownRemainSec,
 *          world.player.skillFireCooldownRemainSec, world.player.isSkillFiring,
 *          world.session.mana, world.regularProjectiles, world.skillProjectiles,
 *          world.nextEntityId
 * @module @/game/systems/weapon
 */
export type FireWeapon = (
  world: GameWorld,
  input: Readonly<InputState>,
  dt: number,
  rng: Rng,
) => void;

// ---------------------------------------------------------------------------
// enemyWeapon.ts
// ---------------------------------------------------------------------------

/**
 * For every alive enemy (processed in `world.enemies` array order), decrements
 * `projFireCooldownRemainSec` by `dt` (floored at 0). When it reaches <= 0:
 *
 * 1. If `world.enemyProjectiles.length < BalanceConfig.limits.maxEnemyProjectiles`, fires
 *    one EnemyProjectile from that enemy's current AABB center. `rng` selects one of the
 *    8 fixed compass directions uniformly via `index = Math.floor(rng() * 8)` (clamped to
 *    7 for the theoretical `rng() === 1` edge case) against this fixed, order-significant
 *    table of unit vectors:
 *    ```
 *    0: ( 1,  0)   // 0deg   (+x)
 *    1: ( 1,  1)/sqrt(2)  // 45deg
 *    2: ( 0,  1)   // 90deg  (+y)
 *    3: (-1,  1)/sqrt(2)  // 135deg
 *    4: (-1,  0)   // 180deg (-x)
 *    5: (-1, -1)/sqrt(2)  // 225deg
 *    6: ( 0, -1)   // 270deg (-y)
 *    7: ( 1, -1)/sqrt(2)  // 315deg
 *    ```
 *    The new projectile's `vx`/`vy` are that unit vector times the FIRING ENEMY's own
 *    `readonly projSpeed` snapshot — never a value recomputed from `BalanceConfig`
 *    directly (INV-EPROJ-1). Its `damage` and `lifetimeRemainSec` are captured fresh from
 *    `BalanceConfig.enemyProjectile` at creation time. `rng` is consumed exactly once per
 *    enemy that actually fires this tick, in `world.enemies` array order.
 * 2. Regardless of whether the cap in step 1 blocked creation, the cooldown is reset to
 *    the fire interval computed from the CURRENT `world.session.level` (NOT a value
 *    frozen at this enemy's spawn time — INV-EPROJ-2):
 *    `max(BalanceConfig.enemyProjectile.fireIntervalBase -
 *    BalanceConfig.enemyProjectile.fireIntervalDecayPerLevel * (world.session.level - 1),
 *    BalanceConfig.enemyProjectile.fireIntervalMinSec)`. At the cap, `rng` is not
 *    consumed (mirrors `FireWeapon`'s / `SpawnTick`'s cap behavior).
 *
 * This is the only place an EnemyProjectile's `vx`/`vy` are ever set; `applyMovement`
 * only reads them afterward and never re-derives them (contrast with SkillProjectile).
 * @mutates world.enemies[].projFireCooldownRemainSec, world.enemyProjectiles,
 *          world.nextEntityId
 * @module @/game/systems/enemyWeapon
 */
export type FireEnemyProjectiles = (world: GameWorld, dt: number, rng: Rng) => void;

// ---------------------------------------------------------------------------
// spawner.ts
// ---------------------------------------------------------------------------

/**
 * Decrements `world.spawner.intervalRemainSec` by `dt`. When it reaches <= 0 AND
 * `world.enemies.length < BalanceConfig.limits.maxEnemies`, spawns one enemy at
 * `x = world.bounds.width` (fully off-screen, right edge — INV-SPAWN-1) with
 * `y = rng() * (world.bounds.height - BalanceConfig.enemy.height)`, then resets
 * `intervalRemainSec` to `world.spawner.currentIntervalSec`. If the enemy cap is
 * reached, the timer still resets (the spawn attempt is skipped, not queued).
 *
 * The new enemy's `readonly projSpeed` is computed ONCE here, from
 * `BalanceConfig.enemyProjectile` and the CURRENT `world.session.level` at this exact
 * spawn moment — `clamp(speedBase + speedPerLevel * (level - 1), speedBase, speedMax)` —
 * and never recomputed afterward, even if the level later changes (INV-EPROJ-1). Its
 * `projFireCooldownRemainSec` is initialized to the same current-level fire interval
 * formula used by `FireEnemyProjectiles` (see that type's `@module` doc), so a
 * newly-spawned enemy does not fire in the same tick it spawns.
 * A newly-created enemy's action-related fields (`action`, `actionInitialized`, `dashVx`,
 * `dashVy`, `oscillateBaseY`, `oscillatePhaseSec`, `circleCenterX`, `circleCenterY`,
 * `circleAngleRad`, `circleDir`) are initialized to trivial placeholders — any valid
 * `EntityKind`-consistent values are acceptable as long as `actionInitialized` is exactly
 * `false` — because `applyMovement` already ran earlier in this same tick (before
 * `spawnTick`, per the System Execution Order) and therefore never reads a
 * same-tick-spawned enemy's placeholders, and `updateEnemyAi` (which runs immediately
 * after `spawnTick` in the same tick) is guaranteed to fully select every one of those
 * fields exactly once, the instant it sees `actionInitialized === false` (issue #19,
 * INV-EAI-1 — "스폰 직후 단 1회" is satisfied by this same-tick placeholder-then-select
 * handoff, not by `spawnTick` picking real values itself). Once selected, this enemy's
 * `updateEnemyAi` never touches these fields again for the rest of its lifetime.
 * @mutates world.spawner, world.enemies, world.nextEntityId
 * @module @/game/systems/spawner
 */
export type SpawnTick = (world: GameWorld, dt: number, rng: Rng) => void;

// ---------------------------------------------------------------------------
// enemyAi.ts
// ---------------------------------------------------------------------------

/**
 * One-time-per-enemy movement-behavior selection (issue #19, amended: the original
 * periodic re-roll was removed). Runs once per tick, after `spawnTick` and before
 * `detectCollisions`, and is the ONLY system allowed to consume `rng` on behalf of enemy
 * behavior selection — `applyMovement` (which runs earlier, before `spawnTick`, in the
 * same tick) never receives an `rng` argument and only integrates positions from
 * whatever action fields this system set, once, on a PRIOR tick (see `ApplyMovement`'s
 * JSDoc for the exact one-tick-lag data-flow rationale).
 *
 * For every alive enemy, in `world.enemies` array order:
 * 1. If `actionInitialized === true`, do nothing further for this enemy this tick (no
 *    `rng` consumed, no field touched — the enemy's `action` and every action-derived
 *    field are permanent for the rest of its lifetime, INV-EAI-1).
 * 2. Otherwise (`actionInitialized === false`, true for every newly-spawned enemy this
 *    tick — INV-EAI-1), select in this exact order, consuming `rng` exactly once per
 *    numbered step below, then set `actionInitialized = true`:
 *    a. `actionIndex = Math.min(2, Math.floor(rng() * 3))` against the fixed table
 *       `0: 'dash', 1: 'oscillate', 2: 'circle'`; set `action` to the result.
 *    b. Exactly one of the following, depending on the `action` chosen in step (a):
 *       - `'dash'`: direction MUST always have a leftward component (unit vector
 *         `ux < 0`) — candidates that point up/down/right permanently strand the enemy
 *         against the right or top/bottom bounds once behaviors became permanent
 *         (INV-EAI-1), since it can then never satisfy the leftward-exit despawn rule
 *         (INV-ESCAPE-1); this regression was found in play and is now closed at the
 *         contract level (INV-EAI-2). While
 *         `world.session.level < BalanceConfig.enemyAi.dashOctoDirectionLevel`: consume
 *         NO additional `rng()` call — deterministically use index `4` (due west, 180
 *         deg) from the fixed 8-direction unit-vector table documented on
 *         `FireEnemyProjectiles`. Otherwise (level at or above the threshold): draw one
 *         more `rng()` call, `index3 = Math.min(2, Math.floor(rng() * 3))`, mapped
 *         through `[3, 4, 5]` (southwest, west, northwest — the only three table entries
 *         with `ux < 0`) into that same table. Either way, set
 *         `dashVx = unitVector.x * BalanceConfig.enemy.speed` and
 *         `dashVy = unitVector.y * BalanceConfig.enemy.speed`.
 *       - `'oscillate'`: consumes no additional `rng`. Set `oscillateBaseY` to this
 *         enemy's CURRENT `y` and `oscillatePhaseSec` to `0` (INV-EAI-3).
 *       - `'circle'`: draw one more `rng()` call: `circleDir = rng() < 0.5 ? 1 : -1`.
 *         Set `circleAngleRad = 0`, then — so the enemy's current position lands
 *         exactly on the new orbit with no visible jump —
 *         `circleCenterX = (x + width / 2) - BalanceConfig.enemyAi.circleRadiusPx` and
 *         `circleCenterY = y + height / 2` (INV-EAI-4).
 *    c. `actionInitialized = true` — from this point on, step 1 above short-circuits for
 *       this enemy for the rest of its lifetime; none of these fields are ever
 *       re-selected or mutated by this system again.
 *
 * An enemy being initialized this tick consumes `rng` exactly 1 time for `'oscillate'` or
 * for `'dash'` below `dashOctoDirectionLevel` (no extra direction draw), exactly 2 times
 * for `'circle'` or for `'dash'` at/above `dashOctoDirectionLevel` (one extra direction
 * draw); an already-initialized enemy consumes 0, on every subsequent tick for the rest
 * of its life. The same initial seed, world, input, and spawn sequence always reproduce
 * the same per-enemy action selection.
 * @mutates world.enemies[].action, world.enemies[].actionInitialized,
 *          world.enemies[].dashVx, world.enemies[].dashVy,
 *          world.enemies[].oscillateBaseY, world.enemies[].oscillatePhaseSec,
 *          world.enemies[].circleCenterX, world.enemies[].circleCenterY,
 *          world.enemies[].circleAngleRad, world.enemies[].circleDir
 * @module @/game/systems/enemyAi
 */
export type UpdateEnemyAi = (world: GameWorld, dt: number, rng: Rng) => void;

// ---------------------------------------------------------------------------
// combat.ts
// ---------------------------------------------------------------------------

/**
 * In order: (1) decrement `world.player.invulnRemainSec` by `dt` (floored at 0);
 * (2) apply regular-projectile hits, marking each projectile dead and granting both score
 * and saturated mana when a live enemy dies — for EACH enemy that dies in this step
 * (issue #21), immediately after that enemy's `alive` is set to `false`, consume `rng`
 * exactly once: if `rng() < BalanceConfig.healingItem.dropChance`, create one
 * `HealingItem` (`id = world.nextEntityId++`, size from
 * `BalanceConfig.healingItem.width`/`height` centered on the dead enemy's AABB center,
 * fixed permanently at that position, `lifetimeRemainSec = BalanceConfig.healingItem.lifetimeSec`)
 * and push it onto `world.healingItems` (INV-ITEM-1); (3) apply skill-projectile hits
 * independently, granting score but no mana when a live enemy dies, applying the
 * IDENTICAL per-death drop-chance roll described in step 2 (one `rng()` call per enemy
 * that dies in this step, same formula, same push target — INV-ITEM-1; the two loops run
 * in this fixed order, regular hits first, skill hits second); (4) for each
 * `PlayerContact`, only if `world.player.invulnRemainSec <= 0`: reduce
 * `world.session.hp` by the enemy's `contactDamage` (floored at 0), mark that enemy
 * `alive = false`, and reset `world.player.invulnRemainSec` to
 * `BalanceConfig.player.invulnSec` (INV-DMG-1). Contacts arriving while already
 * invulnerable still remove the contacting enemy but cause no further HP loss. A
 * contact-kill never rolls for a healing-item drop (only the projectile-kill paths in
 * steps 2/3 do).
 * (5) for each `EnemyProjectileHit`: ALWAYS mark that projectile `alive = false`
 * (consumed on hit regardless of invulnerability, mirroring step 4's contact-removal
 * behavior — a hit projectile never lingers to hit again), and only if
 * `world.player.invulnRemainSec <= 0` at this point (i.e. after step 4 may already have
 * reset it): reduce `world.session.hp` by the projectile's own `damage` (floored at 0)
 * and reset `world.player.invulnRemainSec` to `BalanceConfig.player.invulnSec`
 * (INV-EPROJ-4). `EnemyProjectileHit` and `PlayerContact` share the exact same
 * `world.player.invulnRemainSec` state — because step 4 runs first, a contact hit and an
 * enemy-projectile hit landing in the same tick never stack HP loss.
 * (6) for each `PlayerItemPickup` (issue #21), LAST: if
 * `world.session.hp < world.session.maxHp`, increment `world.session.hp` by
 * `BalanceConfig.healingItem.healAmount` (capped at `maxHp`); otherwise add
 * `BalanceConfig.healingItem.fullHpBonusScore` to `world.session.score`. Either way mark
 * that `HealingItem.alive = false`. This step never consumes `rng` (INV-ITEM-3).
 * All hit lists come from `DetectCollisions`, so a merely-touching (edge/corner,
 * zero-area) pair never appears here in the first place — this function never needs to
 * re-check the boundary rule itself.
 * @mutates world.enemies[].hp, world.enemies[].alive,
 *          world.regularProjectiles[].alive, world.skillProjectiles[].alive,
 *          world.enemyProjectiles[].alive, world.healingItems, world.healingItems[].alive,
 *          world.session.score, world.session.mana, world.session.hp,
 *          world.player.invulnRemainSec, world.nextEntityId
 * @module @/game/systems/combat
 */
export type ApplyCombat = (
  world: GameWorld,
  collisions: Readonly<CollisionResult>,
  dt: number,
  rng: Rng,
) => void;

// ---------------------------------------------------------------------------
// progression.ts
// ---------------------------------------------------------------------------

/**
 * In order: (1) defensively clamp `world.session.mana` to [0,
 * `BalanceConfig.progression.manaMax`] without resetting a full gauge; (2) while
 * `world.session.score >= world.session.level * BalanceConfig.progression.levelUpScoreStep`
 * and `world.session.level < BalanceConfig.progression.maxLevel`, increment
 * `world.session.level` and shrink `world.spawner.currentIntervalSec` by
 * `BalanceConfig.spawn.intervalDecayPerLevel`, floored at
 * `BalanceConfig.spawn.minIntervalSec` (D-4); (3) if `world.session.hp <= 0`, set
 * `world.session.status` to `'gameover'`.
 * @mutates world.session.mana, world.session.level, world.session.status,
 *          world.spawner.currentIntervalSec
 * @module @/game/systems/progression
 */
export type ApplyProgression = (world: GameWorld) => void;

// ---------------------------------------------------------------------------
// stepWorld.ts
// ---------------------------------------------------------------------------

/**
 * Orchestrates exactly one fixed-size simulation tick, in the order documented in
 * invariants.md ("System Execution Order"). As of issue #19, that order is a 9-step
 * sequence: `fireWeapon` (1), `fireEnemyProjectiles` (2), `applyMovement` (3),
 * `spawnTick` (4), `updateEnemyAi` (5), `detectCollisions` (6), `applyCombat` (7),
 * `applyProgression` (8), dead-entity sweep (9) — see invariants.md for the full,
 * authoritative sequence and the rationale for placing `updateEnemyAi` after
 * `spawnTick`/before `detectCollisions`. As of issue #21, step 7 (`applyCombat`) also
 * receives this same `rng` (healing-item drop-chance rolls, INV-ITEM-1) and step 9's
 * dead-entity sweep also filters `world.healingItems`.
 * A no-op when `world.session.status !== 'playing'` (D-6 — a finished/errored world does
 * not keep simulating). `dt` is always the fixed step in seconds
 * (`BalanceConfig.loop.FIXED_STEP_MS / 1000`), never a raw frame delta (§6.2).
 * @mutates world (see the @mutates tags of every system type above)
 * @module @/game/stepWorld
 */
export type StepWorld = (
  world: GameWorld,
  input: Readonly<InputState>,
  dt: number,
  rng: Rng,
) => void;

// ---------------------------------------------------------------------------
// createWorld.ts
// ---------------------------------------------------------------------------

/**
 * Builds a brand-new `GameWorld` in its initial state: empty `enemies`,
 * `regularProjectiles`, `skillProjectiles`, `enemyProjectiles`, and `healingItems`
 * (issue #21); `player` at
 * `BalanceConfig.player.spawnX/spawnY` with both cooldowns and invulnerability zeroed,
 * `isSkillFiring: false`,
 * `session` at `{ hp: maxHp, mana: 0, score: 0, level: 1, status: 'playing' }`, and
 * `spawner.currentIntervalSec` at `BalanceConfig.spawn.initialIntervalSec`. Takes no
 * time or randomness — deterministic with zero arguments, matching the D-6 restart
 * contract (`createWorld()` re-invoked with no seed/session carry-over). No `Enemy`
 * exists yet, so no `projSpeed`/`projFireCooldownRemainSec` snapshot is created here —
 * those only come into existence when `spawnTick` creates an enemy.
 * @module @/game/createWorld
 */
export type CreateWorld = () => GameWorld;

// ---------------------------------------------------------------------------
// rng.ts
// ---------------------------------------------------------------------------

/**
 * Creates a deterministic PRNG (e.g. mulberry32) seeded by `seed`. Two `Rng` instances
 * created from the same `seed` produce an identical sequence of `next()` results for
 * the same number of calls, regardless of process or wall-clock time.
 * @module @/game/rng
 */
export type CreateRng = (seed: number) => Rng;

// ---------------------------------------------------------------------------
// input.ts
// ---------------------------------------------------------------------------

/**
 * Returns a fresh `InputState` with every flag `false`. Used on initial mount and to
 * fully reset input on window `blur` (§6.2.1-(1) — "포커스 상실 시 InputState를 전부
 * false로 초기화").
 * @module @/game/input
 */
export type CreateInputState = () => InputState;
