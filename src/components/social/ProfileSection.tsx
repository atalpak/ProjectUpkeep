import type { ReactNode } from "react";

/** A native disclosure keeps long profile sections reachable by keyboard and without JavaScript. */
export function ProfileSection({
  id,
  title,
  open = false,
  children,
}: {
  id: string;
  title: string;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} open={open} className="retro-panel group scroll-mt-24 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180">
          <path d="m4 7 6 6 6-6" />
        </svg>
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}
