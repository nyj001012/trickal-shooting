// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createWorld } from '@/game/createWorld';
import { BALANCE } from '@/game/balance';

describe('createWorld — initial GameWorld shape (matches BalanceConfig)', () => {
  it('places the player at the configured spawn point with zeroed cooldown/invuln timers', () => {
    const world = createWorld();
    expect(world.player.x).toBe(BALANCE.player.spawnX);
    expect(world.player.y).toBe(BALANCE.player.spawnY);
    expect(world.player.fireCooldownRemainSec).toBe(0);
    expect(world.player.invulnRemainSec).toBe(0);
    expect(world.player.alive).toBe(true);
  });

  it('starts with no enemies and no projectiles', () => {
    const world = createWorld();
    expect(world.enemies).toEqual([]);
    expect(world.projectiles).toEqual([]);
  });

  it('starts the session at full HP, zero mana/score, level 1, playing status', () => {
    const world = createWorld();
    expect(world.session).toEqual({
      hp: BALANCE.player.maxHp,
      maxHp: BALANCE.player.maxHp,
      mana: 0,
      score: 0,
      level: 1,
      status: 'playing',
    });
  });

  it('starts the spawner at the initial spawn interval', () => {
    const world = createWorld();
    expect(world.spawner.currentIntervalSec).toBe(BALANCE.spawn.initialIntervalSec);
  });

  it('uses the fixed canvas bounds', () => {
    const world = createWorld();
    expect(world.bounds).toEqual({ width: BALANCE.canvas.width, height: BALANCE.canvas.height });
  });

  it('returns a brand-new object graph every call — no shared mutable references (required for leak-free restart, D-6)', () => {
    const worldA = createWorld();
    const worldB = createWorld();
    expect(worldA).not.toBe(worldB);
    expect(worldA.player).not.toBe(worldB.player);
    expect(worldA.enemies).not.toBe(worldB.enemies);
    expect(worldA.session).not.toBe(worldB.session);
    expect(worldA).toEqual(worldB);
  });
});
