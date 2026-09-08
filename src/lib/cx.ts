/**
 * Joins class names, dropping falsy ones.
 *
 * Its own module rather than living in components/ui.tsx: ManaCost.tsx and
 * SetSymbol.tsx both need it, and ui.tsx wanting to use those two
 * decoratively (see EmptyState) would otherwise be a circular import.
 */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
