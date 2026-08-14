/**
 * Composition root: wires `useKeyboardInput` -> `useGameLoop` -> `GameCanvas` + `Hud`,
 * renders the D-6 game-over overlay, and installs the E2E bridge when `?e2e=1` is
 * present (design.md §6.9, ui-contracts.md §3/§4).
 * @module @/ui/GameBoard
 */
import { useEffect, useRef, type JSX } from 'react';

import { BALANCE } from '@/game/balance';
import { useGameLoop } from '@/hooks/useGameLoop';
import { useHudSnapshot } from '@/hooks/useHudSnapshot';
import { useKeyboardInput } from '@/hooks/useKeyboardInput';

import { GameCanvas } from './GameCanvas';
import { Hud } from './Hud';

export function GameBoard(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useKeyboardInput();
  const controller = useGameLoop(canvasRef, inputRef);
  const snapshot = useHudSnapshot();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('e2e') !== '1') {
      return;
    }
    let cancelled = false;
    void import('@/testBridge').then(({ installTestBridge }) => {
      if (!cancelled) {
        installTestBridge(controller);
      }
    });
    return () => {
      cancelled = true;
      delete window.__TRICKAL_TEST__;
    };
  }, [controller]);

  return (
    <div className="game-board">
      <GameCanvas
        ref={canvasRef}
        widthPx={BALANCE.canvas.width}
        heightPx={BALANCE.canvas.height}
        ariaLabel="슈팅 게임 화면"
      />
      <Hud snapshot={snapshot} />
      {snapshot.status === 'gameover' && (
        <div data-testid="game-over" className="game-over-overlay">
          <h2>GAME OVER</h2>
          <p>Press R to Restart</p>
        </div>
      )}
    </div>
  );
}
