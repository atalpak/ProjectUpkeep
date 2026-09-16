"use client";

import { useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";

/**
 * Fades and lifts its children in once, the first time they scroll into
 * view — the landing page's one animation primitive, reused down every
 * section rather than each one rolling its own.
 *
 * CSS-only motion (a plain opacity/transform transition), triggered by a
 * single `IntersectionObserver` per instance and never re-armed — a section
 * you've already seen doesn't re-hide itself if you scroll back up to it.
 * `motion-safe:` gates the transition itself, not the end state, so
 * `prefers-reduced-motion` just makes the reveal instant rather than making
 * content that never appears.
 */
export function Reveal({
  children,
  className,
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Stagger for a row of these revealed by the same scroll — see the
   *  three-screen strips below. */
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={cx(
        "motion-safe:transition-all motion-safe:duration-700 motion-safe:ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
