import Link from "next/link";

/**
 * Cross-links for the two public legal pages (`/terms`, `/privacy`).
 *
 * They sit outside the `(app)` nav shell, and there is no site-wide footer, so
 * without this a reader who lands on one has no way to the other or back to the
 * front page. `current` drops the self-link so the row never points at the page
 * you are already on.
 */
export function LegalFooter({ current }: { current: "terms" | "privacy" }) {
  return (
    <nav className="flex gap-4 border-t border-border pt-6 text-xs text-ink-muted">
      {current !== "terms" && (
        <Link href="/terms" className="text-accent underline">
          Trading terms
        </Link>
      )}
      {current !== "privacy" && (
        <Link href="/privacy" className="text-accent underline">
          Privacy
        </Link>
      )}
      <Link href="/" className="text-accent underline">
        Home
      </Link>
    </nav>
  );
}
