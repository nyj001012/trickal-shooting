/**
 * Greybox color palette (design.md §6.7). This is the ONLY place colors are named;
 * `src/render/**` reads tokens from here, never inline hex strings. `src/game/**` must
 * never import this module (§3.2 note 4 — color is a render-layer concern only).
 */
export const PALETTE = {
  background: '#222222',
  player: '#FFB6C1',
  enemy: '#90EE90',
  regularProjectile: '#FFD700',
  skillProjectile: '#00FFFF',
  enemyProjectile: '#FF8C00',
  hitFlash: '#FF4D4D',
  debug: '#00E5FF',
} as const satisfies Readonly<Record<string, string>>;

/** Derived, never hand-duplicated (design.md §6.5.4). */
export type PaletteToken = keyof typeof PALETTE;
