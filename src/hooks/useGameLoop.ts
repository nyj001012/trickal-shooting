/**
 * Owns the world/rng refs, drives the fixed-timestep accumulator loop (design.md §6.1,
 * §6.2), draws each frame, throttle-publishes HUD snapshots, and handles the D-6 restart
 * gate (invariants.md §2 "재시작 게이팅" — `stepWorld` itself is a no-op once
 * `status !== 'playing'`, so *when* to call `createWorld()` again is this hook's job,
 * not the pure simulation's).
 *
 * Mounts its rAF loop exactly once (`useEffect(..., [])`-equivalent deps of only the
 * stable ref params) and always cancels it on cleanup. Pauses on `visibilitychange`
 * (tab hidden) and drops accumulated time on resume to avoid a tunneling burst of
 * substeps (design.md §6.1 "루프 수명주기").
 * @module @/hooks/useGameLoop
 */
import { useEffect, useRef } from 'react';

import type { GameWorld, HudSnapshot, InputState, Rng } from '@/contracts';

import { BALANCE } from '@/game/balance';
import { createRng } from '@/game/rng';
import { createWorld } from '@/game/createWorld';
import { hudStore } from '@/game/hudStore';
import { stepWorld } from '@/game/stepWorld';
import { drawScene } from '@/render/drawScene';

/** Read-only handle used by `src/testBridge.ts` to drive the loop without `rAF` (§6.9). */
export interface GameLoopController {
  getWorld(): Readonly<GameWorld>;
  /**
   * Fresh HUD-shaped snapshot computed directly from the live world, bypassing
   * `hudStore`'s publish throttle (ui-contracts.md §4 — `getSnapshot` must always
   * reflect the latest `world.session`, not the last throttled HUD publish).
   */
  getHudSnapshot(): Readonly<HudSnapshot>;
  stepFrames(frameCount: number): void;
  reseed(seedValue: number): void;
}

function toHudSnapshot(world: Readonly<GameWorld>): HudSnapshot {
  return {
    hp: world.session.hp,
    maxHp: world.session.maxHp,
    mana: world.session.mana,
    score: world.session.score,
    level: world.session.level,
    status: world.session.status,
  };
}

export function useGameLoop(
  canvasRef: Readonly<{ current: HTMLCanvasElement | null }>,
  inputRef: Readonly<{ current: Readonly<InputState> }>,
): Readonly<GameLoopController> {
  const worldRef = useRef<GameWorld>(createWorld());
  const rngRef = useRef<Rng>(createRng(Date.now()));

  const controllerRef = useRef<GameLoopController>({
    getWorld: () => worldRef.current,
    getHudSnapshot: () => toHudSnapshot(worldRef.current),
    stepFrames: (frameCount: number) => {
      const dtSec = BALANCE.loop.FIXED_STEP_MS / 1000;
      for (let i = 0; i < frameCount; i += 1) {
        stepWorld(worldRef.current, inputRef.current, dtSec, rngRef.current);
      }
      hudStore.publish(toHudSnapshot(worldRef.current));
    },
    reseed: (seedValue: number) => {
      rngRef.current = createRng(seedValue);
    },
  });

  useEffect(() => {
    let rafId: number | null = null;
    let lastTimeMs: number | null = null;
    let accumulatorMs = 0;
    let lastHudPublishMs = 0;
    const dtSec = BALANCE.loop.FIXED_STEP_MS / 1000;

    function publishSnapshot(force: boolean, nowMs: number): void {
      const snapshot = toHudSnapshot(worldRef.current);
      const statusChanged = hudStore.getSnapshot().status !== snapshot.status;
      const throttleElapsed = nowMs - lastHudPublishMs >= BALANCE.loop.HUD_PUBLISH_INTERVAL_MS;
      if (force || statusChanged || throttleElapsed) {
        hudStore.publish(snapshot);
        lastHudPublishMs = nowMs;
      }
    }

    function tryRestart(): void {
      if (worldRef.current.session.status === 'gameover' && inputRef.current.restart) {
        worldRef.current = createWorld();
        accumulatorMs = 0;
        hudStore.reset();
      }
    }

    function frame(timeMs: number): void {
      try {
        tryRestart();

        if (lastTimeMs === null) {
          lastTimeMs = timeMs;
        }
        const elapsedMs = Math.min(timeMs - lastTimeMs, BALANCE.loop.MAX_FRAME_MS);
        lastTimeMs = timeMs;
        accumulatorMs += elapsedMs;

        let substeps = 0;
        while (accumulatorMs >= BALANCE.loop.FIXED_STEP_MS) {
          stepWorld(worldRef.current, inputRef.current, dtSec, rngRef.current);
          accumulatorMs -= BALANCE.loop.FIXED_STEP_MS;
          substeps += 1;
          if (substeps >= BALANCE.loop.MAX_SUBSTEPS) {
            accumulatorMs = 0;
            break;
          }
        }

        const canvas = canvasRef.current;
        const ctx = canvas === null ? null : canvas.getContext('2d');
        if (ctx !== null) {
          drawScene(ctx, worldRef.current);
        }

        publishSnapshot(false, timeMs);
        rafId = requestAnimationFrame(frame);
      } catch (error) {
        worldRef.current.session.status = 'error';
        publishSnapshot(true, timeMs);
        if (import.meta.env.DEV) {
          console.error('[useGameLoop] simulation crashed, loop stopped:', error);
        }
      }
    }

    function handleVisibilityChange(): void {
      if (document.hidden) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
      } else {
        lastTimeMs = null;
        accumulatorMs = 0;
        if (rafId === null) {
          rafId = requestAnimationFrame(frame);
        }
      }
    }

    rafId = requestAnimationFrame(frame);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [canvasRef, inputRef]);

  return controllerRef.current;
}
