import { cx } from "@/components/ui";

/**
 * The brand mark: a stylized card (art frame + two text lines) with a
 * checkmark badge overlapping the corner — literally "a card that's been
 * accounted for," which is the whole pitch. Colors are fixed rather than
 * themed, like most brand marks: the same file is also `app/icon.svg`, and a
 * logo that changes with light/dark reads as inconsistent rather than
 * considered.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className ?? "size-6"}
      aria-hidden="true"
    >
      <rect x="6" y="4" width="44" height="56" rx="9" fill="#D98A2C" />
      <rect x="14" y="14" width="28" height="18" rx="3" fill="#FCF8EE" />
      <rect x="14" y="38" width="28" height="4" rx="2" fill="#FCF8EE" opacity="0.85" />
      <rect x="14" y="46" width="19" height="4" rx="2" fill="#FCF8EE" opacity="0.6" />
      <circle cx="48" cy="50" r="13" fill="#2F6B4F" />
      <path
        d="M42.5 50 l4.2 4.2 l8.5 -9.4"
        stroke="#FCF8EE"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * The mark plus the wordmark text. `size="lg"` is for the signed-out landing
 * page, where the wordmark carries more weight with no nav around it; every
 * signed-in surface (header, drawer) uses the default.
 */
export function Wordmark({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "lg";
}) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <Mark className={size === "lg" ? "size-10" : "size-6"} />
      <span
        className={cx(
          "font-display font-semibold tracking-tight whitespace-nowrap",
          size === "lg" ? "text-3xl" : "text-sm",
        )}
      >
        Project<span className="text-accent">Upkeep</span>
      </span>
    </span>
  );
}
