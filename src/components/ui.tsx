/**
 * Small shared primitives. Not a design system — just enough to stop every page
 * re-inventing a button, and to give Claude Design one place to restyle.
 */

import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm " +
  "font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS = {
  primary: "bg-[--color-accent] text-[--color-accent-ink] hover:opacity-90",
  secondary:
    "border border-[--color-border] bg-[--color-surface] hover:bg-[--color-surface-muted]",
  ghost: "hover:bg-[--color-surface-muted]",
  danger:
    "border border-[--color-border] text-[--color-danger] hover:bg-[--color-surface-muted]",
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

const FIELD_BASE =
  "w-full rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-2 " +
  "text-sm placeholder:text-[--color-ink-muted]";

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
      <span className="text-xs font-medium text-[--color-ink-muted]">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-[--color-ink-muted]">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cx(
        "rounded-lg border border-[--color-border] bg-[--color-surface] p-4",
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
          ? "border-[--color-danger] text-[--color-danger]"
          : "border-[--color-border] bg-[--color-surface-muted]",
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
    <div className="rounded-lg border border-dashed border-[--color-border] p-8 text-center">
      <p className="font-medium">{title}</p>
      {children ? (
        <div className="mt-1 text-sm text-[--color-ink-muted]">{children}</div>
      ) : null}
    </div>
  );
}
