/**
 * Contract barrel. The app and all tests import exclusively from `@/contracts`
 * (design.md §5.2) — never reach into `@/contracts/entities` etc. directly.
 * Re-exports only; zero runtime code.
 */

export type * from './entities';
export type * from './world';
export type * from './systems';
export type * from './ui';
export type * from './balance';
