/**
 * Renders HP/MANA/SCORE/LEVEL as real text DOM nodes (never drawn to canvas — design.md
 * §6.10 accessibility, §6.9 `data-testid`/string formats fixed in ui-contracts.md).
 * @module @/ui/Hud
 */
import type * as React from 'react';

import type { HudProps } from '@/contracts';

export function Hud({ snapshot }: HudProps): React.JSX.Element {
  return (
    <div className="hud">
      <span data-testid="hud-hp">
        ♥ {snapshot.hp} / {snapshot.maxHp}
      </span>
      <span data-testid="hud-mana">MANA: {snapshot.mana}%</span>
      <span data-testid="hud-score">SCORE: {snapshot.score}</span>
      <span data-testid="hud-level">LV. {snapshot.level}</span>
    </div>
  );
}
