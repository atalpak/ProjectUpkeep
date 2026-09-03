/**
 * Small shared primitives. Not a design system — just enough to stop every page
 * re-inventing a button, and to give Claude Design one place to restyle.
 */

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm " +
  "font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

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
  "text-base sm:text-sm placeholder:text-ink-muted";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cx(FIELD_BASE, className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cx(FIELD_BASE, className)} />;
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
        "rounded-lg border border-border bg-surface p-4",
        className,
      )}
    />
  );
}

/** Inline error/success banner. `role` makes it announced by screen readers. */
export function Banner({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cx(
        "rounded-md border px-3 py-2 text-sm",
        kind === "error"
          ? "border-danger text-danger"
          : "border-border bg-surface-muted",
      )}
    >
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center">
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
    <div className="rounded-lg border border-border bg-surface-raised px-4 py-3.5">
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
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
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
        </div>

        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Small inline label, used for location types and card metadata. */
export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
      {children}
    </span>
  );
}
