import { CopyButton } from "./ui/copy-button";

// A command to run in a terminal, shown in full with a copy button (onboarding).
export function CopyCommand({ command, label = "Copy" }: { command: string; label?: string }) {
  return (
    <div className="card row" style={{ justifyContent: "space-between" }}>
      <code className="wrap">{command}</code>
      <CopyButton text={command} label={label} variant="primary" />
    </div>
  );
}
