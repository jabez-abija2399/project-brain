import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  loading = false,
  size,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
  /** FEAT-039: "sm" for the row of small actions inside a card. */
  size?: "sm";
}) {
  return (
    <button
      type="button"
      {...props}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ""}`}
      disabled={loading || props.disabled}
      aria-busy={loading || undefined}
    >
      {loading ? "Working…" : children}
    </button>
  );
}
