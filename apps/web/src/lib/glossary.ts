// FEAT-028: the words Codeceipt uses, each in one plain sentence. Shown as tooltips (components/ui/term.tsx) and on
// /glossary. Keys are lowercase; `match` finds the word in running text.
export type GlossaryTerm = { key: string; label: string; match: RegExp; text: string };

export const GLOSSARY: GlossaryTerm[] = [
  {
    key: "receipt",
    label: "Receipt",
    match: /\breceipts?\b/i,
    text: "A short report of one agent session: what you asked for, what changed in your code, and what is missing.",
  },
  {
    key: "blueprint",
    label: "Blueprint",
    match: /\bblueprint\b/i,
    text: "The list of what your app must do and must never do, kept up to date as your agents work.",
  },
  {
    key: "checklist item",
    label: "Checklist item",
    match: /\bchecklist items?\b/i,
    text: "One thing you asked your agent for. Each receipt says whether it was done, missed or could not be checked.",
  },
  {
    key: "connection key",
    label: "Connection key",
    match: /\b(connection )?keys?\b/i,
    text: "Lets one computer or agent send receipts for one project. Remove a key and that computer stops at once.",
  },
  {
    key: "rls",
    label: "RLS (row level security)",
    match: /\bRLS\b/,
    text: "A lock on a database table so people can only read and change their own rows. Without it, anyone with your public key can.",
  },
  {
    key: "mcp",
    label: "MCP",
    match: /\bMCP\b/,
    text: "The way AI agents like Claude Code and Cursor talk to tools such as Codeceipt.",
  },
];

export const glossaryTerm = (key: string) => GLOSSARY.find((t) => t.key === key) ?? null;
