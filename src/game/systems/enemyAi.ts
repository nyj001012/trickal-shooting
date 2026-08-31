/**
 * Randomized enemy movement-behavior (re)selection (issue #19). Runs once per tick, after
 * `spawnTick` and before `detectCollisions` (see invariants.md "System Execution Order").
 * This is the ONLY system allowed to consume `rng` on behalf of enemy behavior selection —
 * `applyMovement` never receives an `rng` argument and only integrates positions from
 * whatever action fields this system set on a PRIOR tick.
 * @module @/game/systems/enemyAi
 */
import type { UpdateEnemyAi } from '@/contracts';

import { BALANCE } from '../balance';

/**
 * Fixed, order-significant 8-direction unit-vector table (matches the table documented on
 * `FireEnemyProjectiles`/INV-EAI-2 — duplicated locally per module rather than imported,
 * mirroring the existing `enemyWeapon.ts` pattern).
 */
const DIRECTION_TABLE: ReadonlyArray<{ readonly ux: number; readonly uy: number }> = [
  { ux: 1, uy: 0 },
  { ux: Math.SQRT1_2, uy: Math.SQRT1_2 },
  { ux: 0, uy: 1 },
  { ux: -Math.SQRT1_2, uy: Math.SQRT1_2 },
  { ux: -1, uy: 0 },
  { ux: -Math.SQRT1_2, uy: -Math.SQRT1_2 },
  { ux: 0, uy: -1 },
  { ux: Math.SQRT1_2, uy: -Math.SQRT1_2 },
];

/**
 * Octo-direction DASH candidates: only table entries with a leftward component (ux < 0),
 * i.e. 3 (down-left), 4 (left), 5 (up-left), per INV-EAI-2. Order is significant — rng maps
 * onto this array by index.
 */
const DASH_OCTO_DIRECTION_TABLE_INDEXES: readonly number[] = [3, 4, 5];

/** Fixed action-bucket table (INV-EAI-1 step a). */
const ACTIONS = ['dash', 'oscillate', 'circle'] as const;

export const updateEnemyAi: UpdateEnemyAi = (world, _dt, rng): void => {
  for (const enemy of world.enemies) {
    if (!enemy.alive) continue;

    if (enemy.actionInitialized) continue;

    const actionIndex = Math.min(2, Math.floor(rng() * 3));
    enemy.action = ACTIONS[actionIndex];
    enemy.actionInitialized = true;

    switch (enemy.action) {
      case 'dash': {
        const tableIndex =
          world.session.level < BALANCE.enemyAi.dashOctoDirectionLevel
            ? 4
            : DASH_OCTO_DIRECTION_TABLE_INDEXES[Math.min(2, Math.floor(rng() * 3))];
        const direction = DIRECTION_TABLE[tableIndex];
        enemy.dashVx = direction.ux * BALANCE.enemy.speed;
        enemy.dashVy = direction.uy * BALANCE.enemy.speed;
        break;
      }
      case 'oscillate': {
        enemy.oscillateBaseY = enemy.y;
        enemy.oscillatePhaseSec = 0;
        break;
      }
      case 'circle': {
        enemy.circleDir = rng() < 0.5 ? 1 : -1;
        enemy.circleAngleRad = 0;
        enemy.circleCenterX = enemy.x + enemy.width / 2 - BALANCE.enemyAi.circleRadiusPx;
        enemy.circleCenterY = enemy.y + enemy.height / 2;
        break;
      }
      default: {
        const exhaustive: never = enemy.action;
        throw new Error(`unhandled enemy action: ${String(exhaustive)}`);
      }
    }
  }
};
