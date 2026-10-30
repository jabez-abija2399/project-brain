import { CopyButton } from "@/components/ui/copy-button";

// A command for the terminal on the landing page, with a copy button that says "Copied".
export function TerminalSnippet({ command, note }: { command: string; note?: string }) {
  return (
    <div className="lp-terminal">
      <code className="wrap">
        <span aria-hidden="true" className="lp-prompt">
          ${" "}
        </span>
        {command}
      </code>
      <CopyButton text={command} label="Copy" />
      {note ? <span className="lp-terminal-note">{note}</span> : null}
    </div>
  );
}
