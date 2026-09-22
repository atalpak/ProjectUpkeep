/**
 * Which cards flip, and what the other side shows. The rules moved to
 * `@upkeep/domain` so the phone app asks the same question; this re-export
 * keeps the web app's `@/lib/cards/faces` import path (and the tests in
 * scripts/faces.test.ts) stable, the same arrangement as `stacking.ts`.
 */
export { FLIP_LAYOUTS, faceView, isFlipCard, type FlippableCard } from "@upkeep/domain";
