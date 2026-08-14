/**
 * E2E observation/control bridge (design.md §6.9, ui-contracts.md §4). Loaded via a
 * dynamic `import('@/testBridge')` from `GameBoard.tsx` ONLY when the URL carries
 * `?e2e=1`, so this module (and the network request for its chunk) never reaches a
 * normal player's session. Exposes exactly the 3-method `TestBridge` surface — no
 * gameplay-bypassing APIs.
 * @module @/testBridge
 */
import type { TestBridge } from '@/contracts';

import type { GameLoopController } from '@/hooks/useGameLoop';

export function installTestBridge(controller: Readonly<GameLoopController>): void {
  const bridge: TestBridge = {
    getSnapshot: () => controller.getHudSnapshot(),
    stepFrames: (frameCount: number) => {
      controller.stepFrames(frameCount);
    },
    seed: (seedValue: number) => {
      controller.reseed(seedValue);
    },
  };
  window.__TRICKAL_TEST__ = bridge;
}
