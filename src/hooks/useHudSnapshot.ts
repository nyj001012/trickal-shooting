/**
 * Subscribes the calling component to `hudStore` via `useSyncExternalStore` (design.md
 * §6.1). Re-renders only when `hudStore.publish`/`reset` actually changes the snapshot.
 * @module @/hooks/useHudSnapshot
 */
import { useSyncExternalStore } from 'react';

import type { HudSnapshot } from '@/contracts';

import { hudStore } from '@/game/hudStore';

// Wrapped in local arrow functions (rather than passing `hudStore.subscribe` etc.
// directly) so the call always goes through the `hudStore.` property access and never
// risks losing its receiver if the interface is ever implemented with a `this`-using
// class (`@typescript-eslint/unbound-method`).
const subscribe = (callback: () => void): (() => void) => hudStore.subscribe(callback);
const getSnapshot = (): Readonly<HudSnapshot> => hudStore.getSnapshot();

export function useHudSnapshot(): Readonly<HudSnapshot> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
