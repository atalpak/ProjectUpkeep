/**
 * Mort Green and Deep Moss — the character's own colours (brand doc §6),
 * kept as plain TS constants rather than Tailwind theme tokens on purpose.
 * If these were `bg-mort-green` utilities, some future page would eventually
 * reach for one as app chrome, which is exactly the mistake the brand doc's
 * "Project Upkeep is not automatically a green UI because Mort is green"
 * rule exists to prevent (§6). Consumed only by the Mort placeholder in
 * `MortStage.tsx`. Mirrors `apps/mobile/src/theme.ts`'s `mort` export.
 */
export const mortPalette = {
  green: "#BB9B5A",
  deepMoss: "#5A6B3F",
} as const;
