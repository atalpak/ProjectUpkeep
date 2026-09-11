/**
 * Small shared primitives. Not a design system — just enough to stop every page
 * re-inventing a button, and to give Claude Design one place to restyle.
 */

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { ManaSymbol } from "@/components/ManaCost";

export { cx } from "@/lib/cx";
import { cx } from "@/lib/cx";

// Re-exported rather than defined here: Dialog needs hooks, and this file is
// imported directly by Server Components (the dashboard, for one) for the
// primitives that do not. See Dialog.tsx for the full reasoning.
export { Dialog } from "@/components/Dialog";

// 44px is the smallest target Apple and Google both call reliably tappable,
// and this app gets used standing at a table with a phone in one hand. It grows
// under `coarse` rather than at a breakpoint for the reason globals.css gives:
// a narrow laptop window still has a mouse, a wide tablet does not.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-sm " +
  "font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
  "coarse:min-h-11";

const BUTTON_VARIANTS = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary:
    "border border-border bg-surface hover:bg-surface-muted",
  ghost: "hover:bg-surface-muted",
  danger:
    "border border-border text-danger hover:bg-surface-muted",
} as const;

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return (
    <button
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], className)}
    />
  );
}

// text-base on mobile, text-sm from sm up. 16px is the threshold below which
// iOS Safari zooms the viewport when a field takes focus; desktop keeps the
// denser 14px.
const FIELD_BASE =
  "w-full rounded-md border border-border bg-surface px-3 py-2 " +
  "text-base sm:text-sm placeholder:text-ink-muted coarse:min-h-11";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(FIELD_BASE, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(FIELD_BASE, className)} />;
}

// Same chrome as Input. Four call sites still inline a raw <textarea>; a fifth
// (the feedback box) tipped it into a primitive. `coarse:min-h-11` from
// FIELD_BASE is only a floor — callers set `rows` for the real height.
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(FIELD_BASE, className)} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cx(
        "rounded-2xl border border-border bg-surface p-4",
        className,
      )}
    />
  );
}

/** Inline error/success banner. `role` makes it announced by screen readers. */
/** A left accent bar and a small mark, rather than a uniform thin border —
 *  the same "not everything gets the same chrome" idea as the border-radius
 *  scale, applied to the one primitive that had no shape of its own. */
export function Banner({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cx(
        "flex items-start gap-2 rounded-lg border-l-4 px-3 py-2 text-sm",
        kind === "error"
          ? "border-danger bg-danger/10 text-danger"
          : "border-accent bg-accent-soft text-ink",
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {kind === "error" ? (
          <svg viewBox="0 0 20 20" fill="none" className="size-4" stroke="currentColor" strokeWidth="1.7">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 6.5v4M10 13.2v.05" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" className="size-4" stroke="currentColor" strokeWidth="1.7">
            <path d="M4.5 10.5 8 14l7.5-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span>{children}</span>
    </p>
  );
}

/** The five colors, in WUBRG order — the one sequence every Magic player
 *  already reads without thinking. */
const PIPS = ["W", "U", "B", "R", "G"];

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  /** Defaults to a muted five-color mana-pip row. Pass `false` to omit it, or
   *  a node of your own to show something else instead. */
  icon?: ReactNode | false;
}) {
  const decoration =
    icon === false
      ? null
      : (icon ?? (
          <div className="mb-2 flex justify-center gap-1 opacity-35">
            {PIPS.map((code) => (
              <ManaSymbol key={code} code={code} />
            ))}
          </div>
        ));

  return (
    <div className="rounded-2xl border border-dashed border-border p-8 text-center">
      {decoration}
      <p className="font-medium">{title}</p>
      {children ? (
        <div className="mt-1 text-sm text-ink-muted">{children}</div>
      ) : null}
    </div>
  );
}

/**
 * A single headline number. Deliberately quiet: the figure carries the weight,
 * the label sits under it, and nothing is boxed in more chrome than a border.
 */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised px-4 py-3.5">
      <div className="font-display text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
      <div className="mt-0.5 text-xs font-medium text-ink-muted">{label}</div>
      {hint ? <div className="mt-1 text-xs text-ink-muted">{hint}</div> : null}
    </div>
  );
}

/**
 * The top of a page: an optional way back, the title, an optional line of
 * explanation, and an optional cluster of actions.
 *
 * One component rather than a hand-rolled block per page, which is how the
 * spacing drifted — some pages set `mt-1` on the subtitle and some did not, the
 * back-link sat at three different distances, and the action rows used two
 * different flex layouts. Actions wrap below the title on a narrow screen
 * rather than squeezing it.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {backHref ? (
        <Link href={backHref} className="text-sm text-accent underline">
          ← {backLabel ?? "Back"}
        </Link>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
        </div>

        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One row of a hairline-divided list — Direction A's answer to the bordered
 * card this file used to reach for regardless of what it was showing. A
 * `border-bottom` between rows and no box around the whole list, rather than
 * a `Card` with `divide-y` wrapped around everything.
 *
 * Three slots, the same shape `Field` uses for label/children/hint: `icon`
 * for a mark or thumbnail, the children for the row's own content (which is
 * free to be as simple or as composed as it needs to be), `trailing` for a
 * count or chevron pinned to the end. None are required — a caller with
 * nothing to put in `icon` just omits it, rather than the row reserving dead
 * space for it.
 *
 * Renders as a `Link` when given `href`, so a whole row is the tap target
 * rather than a smaller link floating inside it; `coarse:min-h-11` on that
 * path keeps it clear of the 44px touch floor.
 */
export function ListRow({
  icon,
  children,
  trailing,
  href,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  href?: string;
  className?: string;
}) {
  const row = (
    <div
      className={cx(
        "flex items-center gap-3 border-b border-border py-3 last:border-b-0",
        href && "transition-colors hover:bg-surface-muted",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );

  if (!href) return row;
  return (
    <Link href={href} className="block coarse:min-h-11">
      {row}
    </Link>
  );
}

/** Small inline label, used for location types and card metadata. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-ink-muted">
      {children}
    </span>
  );
}
