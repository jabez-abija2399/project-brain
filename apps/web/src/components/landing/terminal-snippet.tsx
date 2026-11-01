import { CommandBox } from "./command-box";

// A command to run in a terminal (docs), in the same copy box as the landing page.
export function TerminalSnippet({ command }: { command: string; note?: string }) {
  return <CommandBox command={command} />;
}
