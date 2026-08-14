/**
 * Root component: a single React Error Boundary wrapping `GameBoard` (design.md §6.10).
 * This catches React *render* errors; a crash inside the simulation loop itself is
 * handled separately by `useGameLoop`, which transitions `session.status` to `'error'`
 * and stops ticking rather than throwing during render.
 * @module @/App
 */
import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';

import { ErrorFallback } from '@/ui/ErrorFallback';
import { GameBoard } from '@/ui/GameBoard';

interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly errorMessage: string | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { errorMessage: null };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { errorMessage: message };
  }

  public override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] caught render error:', error, info.componentStack);
    }
  }

  public override render(): ReactNode {
    if (this.state.errorMessage !== null) {
      return <ErrorFallback message={this.state.errorMessage} />;
    }
    return this.props.children;
  }
}

export function App(): JSX.Element {
  return (
    <ErrorBoundary>
      <GameBoard />
    </ErrorBoundary>
  );
}
