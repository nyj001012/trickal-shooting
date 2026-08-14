/**
 * Mana reset, score-threshold level-up (shrinking spawn interval, floored), and
 * game-over transition. Order: mana -> level -> status (design.md §6.4).
 * @module @/game/systems/progression
 */
import type { ApplyProgression } from '@/contracts';

import { BALANCE } from '../balance';

export const applyProgression: ApplyProgression = (world): void => {
  if (world.session.mana >= BALANCE.progression.manaMax) {
    world.session.mana = 0;
  }

  while (
    world.session.score >= world.session.level * BALANCE.progression.levelUpScoreStep &&
    world.session.level < BALANCE.progression.maxLevel
  ) {
    world.session.level += 1;
    world.spawner.currentIntervalSec = Math.max(
      BALANCE.spawn.minIntervalSec,
      world.spawner.currentIntervalSec - BALANCE.spawn.intervalDecayPerLevel,
    );
  }

  if (world.session.hp <= 0) {
    world.session.status = 'gameover';
  }
};
