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

import type { Box, Enemy, Projectile } from './entities';
import type { GameWorld, InputState, Rng } from './world';

// ---------------------------------------------------------------------------
// collision.ts
// ---------------------------------------------------------------------------

/** One projectile that overlapped one enemy this tick (both still `alive` at scan time). */
export interface ProjectileHit {
  readonly projectile: Readonly<Projectile>;
  readonly enemy: Readonly<Enemy>;
}

/** The player overlapped one enemy this tick via direct contact (not a projectile). */
export interface PlayerContact {
  readonly enemy: Readonly<Enemy>;
}

/** Everything `combat.ts` needs to apply the effects of this tick's overlaps. */
export interface CollisionResult {
  readonly projectileHits: readonly ProjectileHit[];
  readonly playerContacts: readonly PlayerContact[];
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
 * `detectCollisions` uses the same strict rule for both projectile-enemy hits and
 * player-enemy contacts, so a projectile or the player merely grazing an edge on a given
 * tick (zero-area or zero-width intersection) deals no damage that tick. See
 * invariants.md — "AABB Overlap Boundary Rule".
 * @module @/game/systems/collision
 */
export type AabbOverlap = (a: Readonly<Box>, b: Readonly<Box>) => boolean;

/**
 * Scans `world.projectiles` x `world.enemies` and `world.player` x `world.enemies` for
 * AABB overlaps, considering only entities with `alive === true`. Performs no mutation
 * and no removal — it only reports pairs for `combat.ts` to act on (§6.4: "판정 함수는
 * 부수효과가 없어야 한다"). Uses `AabbOverlap`'s strict-inequality boundary rule (edge
 * touch = no overlap) for every pair it tests.
 * @module @/game/systems/collision
 */
export type DetectCollisions = (world: Readonly<GameWorld>) => CollisionResult;

// ---------------------------------------------------------------------------
// movement.ts
// ---------------------------------------------------------------------------

/**
 * One system, three responsibilities, run in this fixed sub-order every tick
 * (see invariants.md for the exact formulas):
 *   1. Player: resolve up/down/left/right into a diagonal-normalized displacement
 *      (INV-MOVE-1), apply it, then clamp both axes to `world.bounds` in the same tick
 *      (INV-MOVE-2).
 *   2. Enemies: move every alive enemy by `-enemySpeed * dt` on x; any enemy whose
 *      right edge has crossed the left screen edge (`x + width < 0`) becomes
 *      `alive = false` in the same tick without changing HP or any other session field
 *      (INV-ESCAPE-1).
 *   3. Projectiles: move every alive projectile by `+projectileSpeed * dt` on x and
 *      decrement `lifetimeRemainSec` by `dt`; a projectile whose lifetime has expired or
 *      whose left edge has crossed the right screen edge (`x > world.bounds.width`)
 *      is marked `alive = false`.
 * @mutates world.player.x, world.player.y, world.enemies[].x, world.enemies[].alive,
 *          world.projectiles[].x, world.projectiles[].lifetimeRemainSec,
 *          world.projectiles[].alive
 * @module @/game/systems/movement
 */
export type ApplyMovement = (world: GameWorld, input: Readonly<InputState>, dt: number) => void;

// ---------------------------------------------------------------------------
// weapon.ts
// ---------------------------------------------------------------------------

/**
 * Always decrements `world.player.fireCooldownRemainSec` by `dt` first (floored at 0).
 * If the cooldown is now <= 0, automatically spawns exactly one projectile at the
 * player's current position (traveling +x) and resets the cooldown to
 * `BalanceConfig.player.fireCooldownSec`. The initial zero cooldown therefore fires on
 * the first playing tick. At the projectile cap it skips creation and still resets the
 * cooldown; no input, buffering, or queued fire request exists (D-2, INV-FIRE-1).
 * @mutates world.player.fireCooldownRemainSec, world.projectiles, world.nextEntityId
 * @module @/game/systems/weapon
 */
export type FireWeapon = (world: GameWorld, dt: number) => void;

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
 * @mutates world.spawner, world.enemies, world.nextEntityId
 * @module @/game/systems/spawner
 */
export type SpawnTick = (world: GameWorld, dt: number, rng: Rng) => void;

// ---------------------------------------------------------------------------
// combat.ts
// ---------------------------------------------------------------------------

/**
 * In order: (1) decrement `world.player.invulnRemainSec` by `dt` (floored at 0);
 * (2) for each `ProjectileHit`, reduce the enemy's `hp` by the projectile's `damage`,
 * mark the projectile `alive = false`, and if the enemy's `hp` is now <= 0, mark it
 * `alive = false` and add its `scoreValue`/`manaGain` to `world.session.score`/`mana`;
 * (3) for each `PlayerContact`, only if `world.player.invulnRemainSec <= 0`: reduce
 * `world.session.hp` by the enemy's `contactDamage` (floored at 0), mark that enemy
 * `alive = false`, and reset `world.player.invulnRemainSec` to
 * `BalanceConfig.player.invulnSec` (INV-DMG-1). Contacts arriving while already
 * invulnerable still remove the contacting enemy but cause no further HP loss.
 * Both hit lists come from `DetectCollisions`, so a merely-touching (edge/corner,
 * zero-area) pair never appears here in the first place — this function never needs to
 * re-check the boundary rule itself.
 * @mutates world.enemies[].hp, world.enemies[].alive, world.projectiles[].alive,
 *          world.session.score, world.session.mana, world.session.hp,
 *          world.player.invulnRemainSec
 * @module @/game/systems/combat
 */
export type ApplyCombat = (
  world: GameWorld,
  collisions: Readonly<CollisionResult>,
  dt: number,
) => void;

// ---------------------------------------------------------------------------
// progression.ts
// ---------------------------------------------------------------------------

/**
 * In order: (1) if `world.session.mana >= BalanceConfig.progression.manaMax`, reset it
 * to 0 (D-3; no skill effect in this phase); (2) while
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
 * invariants.md ("System Execution Order"). A no-op when
 * `world.session.status !== 'playing'` (D-6 — a finished/errored world does not keep
 * simulating). `dt` is always the fixed step in seconds (`BalanceConfig.loop.FIXED_STEP_MS
 * / 1000`), never a raw frame delta (§6.2).
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
 * Builds a brand-new `GameWorld` in its initial state: empty `enemies`/`projectiles`,
 * `player` at `BalanceConfig.player.spawnX/spawnY` with zeroed cooldown/invuln timers,
 * `session` at `{ hp: maxHp, mana: 0, score: 0, level: 1, status: 'playing' }`, and
 * `spawner.currentIntervalSec` at `BalanceConfig.spawn.initialIntervalSec`. Takes no
 * time or randomness — deterministic with zero arguments, matching the D-6 restart
 * contract (`createWorld()` re-invoked with no seed/session carry-over).
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
