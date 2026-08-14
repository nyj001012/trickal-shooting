// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorFallback } from '@/ui/ErrorFallback';

// DOM cleanup between tests is registered globally in vitest.setup.ts (FE-DEV owned,
// `afterEach(() => cleanup())`) to work around `test.globals: false` (vite.config.ts).
//
// The static title copy was changed (per frontend-developer) so it can never
// coincidentally equal a test's `message` prop value, so this can safely go back to
// asserting the message renders exactly once.

describe('ErrorFallback — loop-crash fallback UI (§6.10)', () => {
  it('renders the provided message text', () => {
    render(<ErrorFallback message="문제가 발생했습니다." />);
    expect(screen.getByText('문제가 발생했습니다.')).toBeInTheDocument();
  });
});
