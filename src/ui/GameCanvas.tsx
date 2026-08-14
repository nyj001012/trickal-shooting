/**
 * The `<canvas>` element only. Owns no game state and never calls the 2D context itself
 * — `useGameLoop` (via the forwarded ref) draws every frame (design.md §6.0 rule 3).
 * Sets up HiDPI backing-store scaling once on mount so `src/render/**` can keep working
 * entirely in the logical 800x600 coordinate space (§6.7).
 * @module @/ui/GameCanvas
 */
import { forwardRef, useEffect } from 'react';

import type { GameCanvasProps } from '@/contracts';

export const GameCanvas = forwardRef<HTMLCanvasElement, GameCanvasProps>(function GameCanvas(
  { widthPx, heightPx, ariaLabel },
  ref,
) {
  useEffect(() => {
    const canvas = typeof ref === 'function' ? null : ref?.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = widthPx * dpr;
    canvas.height = heightPx * dpr;
    canvas.style.width = `${widthPx}px`;
    canvas.style.height = `${heightPx}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, [ref, widthPx, heightPx]);

  return (
    <canvas
      ref={ref}
      data-testid="game-canvas"
      aria-label={ariaLabel}
      className="game-canvas"
      width={widthPx}
      height={heightPx}
    />
  );
});
