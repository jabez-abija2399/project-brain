// Status is never shown by color alone (docs/DESIGN.md): every badge has an icon and a label.
export type Status =
  | "done"
  | "done_untested"
  | "partial"
  | "missed"
  | "open"
  | "warning"
  | "not_verified"
  | "question"
  | "postponed"
  | "already_present"
  | "not_done"
  | "asked"
  | "neutral";

const LOOK: Record<Status, { icon: string; label: string; tone: string }> = {
  done: { icon: "✓", label: "Done", tone: "done" },
  // The change is there, but no test changed to prove it (apart from "Not verified": could not be checked at all).
  done_untested: { icon: "✓?", label: "Done, no test proves it", tone: "partial" },
  partial: { icon: "◐", label: "Partly done", tone: "partial" },
  missed: { icon: "✕", label: "Missed", tone: "missed" },
  open: { icon: "○", label: "Open", tone: "open" },
  warning: { icon: "!", label: "Check", tone: "warning" },
  not_verified: { icon: "?", label: "Not verified", tone: "warning" },
  // A clarifying question for the user (D-025): never a task, never missed.
  question: { icon: "?", label: "Question", tone: "neutral" },
  // Real-test G: the user deferred it; never missed.
  postponed: { icon: "⏸", label: "Postponed", tone: "neutral" },
  // Real-test F: a receipt with no changed file.
  already_present: { icon: "✓", label: "Already present", tone: "done" },
  not_done: { icon: "○", label: "Not done", tone: "open" },
  // Real-test B: listed, but the user explicitly asked for it, so it is not an alarm.
  asked: { icon: "↩", label: "You asked for this", tone: "neutral" },
  neutral: { icon: "•", label: "Unknown", tone: "neutral" },
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
