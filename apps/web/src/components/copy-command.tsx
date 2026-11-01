import { CommandBox } from "./landing/command-box";

// A command to run in a terminal with a copy button that says "Copied" (onboarding). Same box as the landing page.
export function CopyCommand({ command }: { command: string; label?: string }) {
  return <CommandBox command={command} />;
}
