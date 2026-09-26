/**
 * The handful of glyphs the table draws. Inline SVG, `currentColor`, no icon
 * library: the app has none, and a dozen small strokes do not justify one.
 * All are decorative (`aria-hidden`); the button that holds one carries the
 * accessible name.
 */

function Icon({ children, className = "size-4" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

type P = { className?: string };

export const KebabIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </Icon>
);
export const QuestionIcon = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8" />
    <path d="M12 17h.01" />
  </Icon>
);
export const ExternalIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M14 4h6v6" />
    <path d="m20 4-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);
export const MenuIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
export const HeartIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" />
  </Icon>
);
export const SkullIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M6 14a6.5 6.5 0 1 1 12 0v3H6v-3Z" />
    <path d="M9 17v3M15 17v3M12 17v3" />
    <circle cx="9.5" cy="12" r="1" fill="currentColor" />
    <circle cx="14.5" cy="12" r="1" fill="currentColor" />
  </Icon>
);
export const SparkIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
  </Icon>
);
export const BoltIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
  </Icon>
);
export const ShieldIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
  </Icon>
);
export const NextIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="m6 5 7 7-7 7" />
    <path d="m13 5 7 7-7 7" />
  </Icon>
);
export const ArrowUpIcon = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </Icon>
);

/** A solid heart with no outline, for sitting softly behind a number. */
export const HeartFillIcon = ({ className }: P) => (
  <svg viewBox="0 0 24 24" className={className ?? "size-4"} fill="currentColor" aria-hidden="true">
    <path d="M12 21s-7.5-4.6-7.5-10.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 16.4 12 21 12 21Z" />
  </svg>
);
