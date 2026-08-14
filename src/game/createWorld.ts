/**
 * Fresh `GameWorld` factory (design.md §6.2.1-(6), D-6 restart contract). Deterministic,
 * zero-argument, no time/randomness consumed.
 * @module @/game/createWorld
 */
import type { CreateWorld, GameWorld } from '@/contracts';

import { BALANCE } from './balance';

export const createWorld: CreateWorld = (): GameWorld => ({
  bounds: { width: BALANCE.canvas.width, height: BALANCE.canvas.height },
  player: {
    id: 0,
    kind: 'player',
    alive: true,
    x: BALANCE.player.spawnX,
    y: BALANCE.player.spawnY,
    width: BALANCE.player.width,
    height: BALANCE.player.height,
    fireCooldownRemainSec: 0,
    invulnRemainSec: 0,
  },
  enemies: [],
  projectiles: [],
  session: {
    hp: BALANCE.player.maxHp,
    maxHp: BALANCE.player.maxHp,
    mana: 0,
    score: 0,
    level: 1,
    status: 'playing',
  },
  spawner: {
    intervalRemainSec: BALANCE.spawn.initialIntervalSec,
    currentIntervalSec: BALANCE.spawn.initialIntervalSec,
  },
  nextEntityId: 1,
});
