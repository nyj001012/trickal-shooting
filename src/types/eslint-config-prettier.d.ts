/**
 * `eslint-config-prettier` ships no type declarations and there is no `@types` package
 * for it (plain JS module, package.json has no `types` field). This ambient declaration
 * is a minimal, accurate-enough shape (a flat-config rules object that only turns rules
 * off) so `eslint.config.ts` can import it without `any`/`as unknown as` (design.md
 * §6.5.2/§6.5.3). Declarations only — no runtime code. Consumed only by
 * `tsconfig.node.json` (added to its `include`), since only `eslint.config.ts` imports
 * this package.
 */
declare module 'eslint-config-prettier' {
  interface PrettierFlatConfig {
    readonly rules: Readonly<Record<string, 0 | 'off'>>;
  }
  const config: PrettierFlatConfig;
  export default config;
}
