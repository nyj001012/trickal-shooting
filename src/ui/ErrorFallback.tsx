/**
 * Rendered by the Error Boundary in `App.tsx` when a render (not simulation) error is
 * caught (design.md §6.10). Simulation-loop crashes are handled separately by
 * `useGameLoop` transitioning `status` to `'error'`; this component is the last-resort
 * fallback if React itself throws while rendering the tree.
 * @module @/ui/ErrorFallback
 */
import type * as React from 'react';

import type { ErrorFallbackProps } from '@/contracts';

export function ErrorFallback({ message }: ErrorFallbackProps): React.JSX.Element {
  return (
    <div role="alert" className="error-fallback">
      <h2>예상치 못한 오류로 화면을 표시할 수 없습니다.</h2>
      <p>{message}</p>
    </div>
  );
}
