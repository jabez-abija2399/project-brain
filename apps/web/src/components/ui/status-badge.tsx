// Status is never shown by color alone (docs/DESIGN.md): every badge has an icon and a label.
export type Status =
  | "done"
  | "partial"
  | "missed"
  | "open"
  | "warning"
  | "not_verified"
  | "neutral";

const LOOK: Record<Status, { icon: string; label: string; tone: string }> = {
  done: { icon: "✓", label: "Done", tone: "done" },
  partial: { icon: "◐", label: "Partly done", tone: "partial" },
  missed: { icon: "✕", label: "Missed", tone: "missed" },
  open: { icon: "○", label: "Open", tone: "open" },
  warning: { icon: "!", label: "Check", tone: "warning" },
  not_verified: { icon: "?", label: "Not verified", tone: "warning" },
  neutral: { icon: "•", label: "", tone: "neutral" },
};

export function StatusBadge({ status, label }: { status: Status; label?: string }) {
  const look = LOOK[status];
  return (
    <span className={`badge badge-${look.tone}`} data-status={status}>
      <span aria-hidden="true">{look.icon}</span>
      <span>{label ?? look.label}</span>
    </span>
  );
}
