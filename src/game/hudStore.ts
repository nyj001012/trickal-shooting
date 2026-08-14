/**
 * Framework-independent HUD publish/subscribe store (design.md §6.1). Bridges the rAF
 * loop and React without ever triggering a per-frame `setState`: `publish` only swaps
 * the stored snapshot reference (and notifies) when a shallow compare finds a
 * difference, so `useSyncExternalStore` never tears or infinite-loops.
 * @module @/game/hudStore
 */
import type { HudSnapshot, HudStore } from '@/contracts';

import { BALANCE } from './balance';

const INITIAL_SNAPSHOT: Readonly<HudSnapshot> = {
  hp: BALANCE.player.maxHp,
  maxHp: BALANCE.player.maxHp,
  mana: 0,
  score: 0,
  level: 1,
  status: 'playing',
};

function shallowEqual(a: Readonly<HudSnapshot>, b: Readonly<HudSnapshot>): boolean {
  return (
    a.hp === b.hp &&
    a.maxHp === b.maxHp &&
    a.mana === b.mana &&
    a.score === b.score &&
    a.level === b.level &&
    a.status === b.status
  );
}

function createHudStore(): HudStore {
  let snapshot: Readonly<HudSnapshot> = INITIAL_SNAPSHOT;
  const listeners = new Set<() => void>();

  return {
    subscribe(callback: () => void): () => void {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    getSnapshot(): Readonly<HudSnapshot> {
      return snapshot;
    },
    publish(next: Readonly<HudSnapshot>): void {
      if (shallowEqual(snapshot, next)) {
        return;
      }
      snapshot = next;
      for (const listener of listeners) {
        listener();
      }
    },
    reset(): void {
      snapshot = INITIAL_SNAPSHOT;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export const hudStore: HudStore = createHudStore();
