import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  loading = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`btn btn-${variant}`}
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
    >
      {loading ? "Working…" : children}
    </button>
  );
}
