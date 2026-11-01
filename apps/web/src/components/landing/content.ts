import type { Status } from "@/components/ui/status-badge";

// The landing page's words and sample data (2026-11-01 redesign). Everything here describes what is built today; the
// receipts, terminal lines and evidence match the CLI's real output (setup-command.ts, hooks.ts, last-evidence.ts).

export const COMMAND = "npx codeceipt";
export const NPM_URL = "https://www.npmjs.com/package/codeceipt";
export const STUDY_URL = "https://arxiv.org/abs/2604.20779";

export type ReceiptLine = {
  id: string;
  status: Status;
  label?: string;
  text: string;
  path?: string;
  tip: string;
};

// The hero receipt: one request, every kind of line, each with a short explanation shown on hover or focus.
export const HERO_ASKED = {
  text: "Add reviews to the salon page, sorted newest first",
  tip: "Your request, recorded when you sent it to the agent.",
};
export const HERO_ITEMS: ReceiptLine[] = [
  {
    id: "done",
    status: "done",
    text: "Reviews list on the salon page",
    path: "src/pages/Salon.tsx",
    tip: "Found in git: Salon.tsx now renders the reviews.",
  },
  {
    id: "untested",
    status: "done_untested",
    text: "Newest first",
    tip: "The sort is in the code, but no test changed to prove it works.",
  },
  {
    id: "missed",
    status: "missed",
    text: "Empty state when there are no reviews",
    tip: "Nothing in the changed files handles a salon with no reviews yet.",
  },
  {
    id: "outside",
    status: "warning",
    label: "Outside the request",
    text: "",
    path: "src/lib/payments.ts",
    tip: "The agent changed a file that has nothing to do with reviews. Ask it why.",
  },
];
export const HERO_CHECKS: ReceiptLine[] = [
  {
    id: "secret",
    status: "missed",
    label: "Secret",
    text: "sb_s*** in",
    path: "src/lib/supabase.ts",
    tip: "A key that looks secret sits in client code. Only its first 4 characters leave your machine.",
  },
  {
    id: "rls",
    status: "missed",
    label: "RLS",
    text: "Table reviews: RLS is off",
    tip: "Without row level security, anyone with your public key can read and change this table.",
  },
  {
    id: "tests",
    status: "warning",
    label: "Tests",
    text: "1 test was skipped",
    tip: "A test was switched off during the session. Skipped, deleted and weakened tests are flagged.",
  },
];
export const HERO_EVIDENCE = {
  text: "Salon.tsx: +42 -3, component and query changed",
  tip: "What the check was given: counts and names from git, never your code.",
};

export type AgentTab = {
  id: string;
  name: string;
  note: boolean;
  capture: boolean;
  receipt: boolean;
  how: string;
};

export const AGENT_TABS: AgentTab[] = [
  {
    id: "claude",
    name: "Claude Code",
    note: true,
    capture: true,
    receipt: true,
    how: "Session hooks do everything: a note about where you stopped when a session starts, your request recorded when you send it, and the receipt when the session ends. Run `codeceipt last` to see it again.",
  },
  {
    id: "cursor",
    name: "Cursor",
    note: true,
    capture: true,
    receipt: true,
    how: "Cursor hooks add the start note, record each prompt before it is sent, and write the receipt when the session ends.",
  },
  {
    id: "codex",
    name: "Codex",
    note: true,
    capture: true,
    receipt: true,
    how: "Codex hooks add the start note and record your prompts. Codex asks you to review new hooks once, in a trusted project; the receipt finishes in the background after the session ends.",
  },
  {
    id: "opencode",
    name: "OpenCode",
    note: true,
    capture: true,
    receipt: false,
    how: "A plugin adds the start note and records each message. OpenCode has no session-end event, so receipts are made with `codeceipt receipt` when you finish.",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    note: true,
    capture: false,
    receipt: false,
    how: "A hook adds the start note. Antigravity has no prompt event, so the agent records your request itself, and receipts are made with `codeceipt receipt` when you finish.",
  },
];

export type TermLine = { kind: "cmd" | "out" | "you" | "agent"; text: string };
export type Step = { id: string; title: string; caption: string; lines: TermLine[] };

const SITE = "https://codeceipts.vercel.app";
const PROJECT = `${SITE}/projects/7c1e4b2a`;

export const STEPS: Step[] = [
  {
    id: "setup",
    title: "Set up",
    caption: "Run one command in your app's folder and approve the code in your browser.",
    lines: [
      { kind: "cmd", text: COMMAND },
      { kind: "out", text: "Your code: WDJB-MJHT" },
      {
        kind: "out",
        text: `Opened the approval page in your browser: ${SITE}/device?code=WDJB-MJHT`,
      },
      { kind: "out", text: "Waiting for approval..." },
      { kind: "out", text: "Codeceipt is set up for this repo." },
      { kind: "out", text: `  Project: ${PROJECT}` },
      { kind: "out", text: "  Indexed: 186 files, 9 features" },
      { kind: "out", text: "  Agents:  Claude Code and Cursor" },
      { kind: "out", text: "What happens next:" },
      { kind: "out", text: "  1. Start Claude Code or Cursor in this folder." },
      { kind: "out", text: "  2. Ask it for a change, and end the session when it is done." },
      {
        kind: "out",
        text: "  3. See your receipt: run `codeceipt last`, or open the Receipts page",
      },
    ],
  },
  {
    id: "work",
    title: "Work",
    caption: "Use Claude Code as you always do. Codeceipt records the request and watches git.",
    lines: [
      { kind: "cmd", text: "claude" },
      { kind: "you", text: "Add reviews to the salon page, sorted newest first" },
      { kind: "agent", text: "Reading src/pages/Salon.tsx" },
      { kind: "agent", text: "Edited src/pages/Salon.tsx and src/lib/payments.ts" },
      { kind: "agent", text: "Done! Reviews now show on the salon page, newest first." },
      { kind: "you", text: "/exit" },
      { kind: "out", text: "Session ended. Codeceipt compares git with your request." },
    ],
  },
  {
    id: "receipt",
    title: "Get your receipt",
    caption: "Read the receipt in the terminal or on the Receipts page.",
    lines: [
      { kind: "cmd", text: "codeceipt last --evidence" },
      { kind: "out", text: "Latest receipt (2026-11-01 14:32 UTC):" },
      { kind: "out", text: "Codeceipt receipt: 2 files changed; 2 done, 1 missed." },
      {
        kind: "out",
        text: "Checks needing attention: 2 security findings, 1 test check, 1 done with no test proving it, 1 file outside the request.",
      },
      { kind: "out", text: "Evidence sent to the judge (no source code):" },
      {
        kind: "out",
        text: "  src/pages/Salon.tsx: +42 -3, symbols changed: Salon, fetchReviews (in the request's feature)",
      },
      {
        kind: "out",
        text: "  src/lib/payments.ts: +5 -0, comment only, top of file (outside the request's feature)",
      },
    ],
  },
];

export type StateKey =
  | "done"
  | "done_untested"
  | "not_verified"
  | "missed"
  | "question"
  | "outside"
  | "preexisting";

export const STATES: { key: StateKey; status: Status; label: string; meaning: string }[] = [
  {
    key: "done",
    status: "done",
    label: "Done",
    meaning: "The changed files show this part of your request was built.",
  },
  {
    key: "done_untested",
    status: "done_untested",
    label: "Done, no test proves it",
    meaning: "The change is in the code, but no test changed to show that it works.",
  },
  {
    key: "not_verified",
    status: "not_verified",
    label: "Not verified",
    meaning: "Codeceipt could not check this from the changed files, so try it yourself.",
  },
  {
    key: "missed",
    status: "missed",
    label: "Missed",
    meaning: "You asked for it, and nothing in the changed files does it.",
  },
  {
    key: "question",
    status: "question",
    label: "Question",
    meaning: "Something only you can decide; it is never counted as a task or as missed.",
  },
  {
    key: "outside",
    status: "warning",
    label: "Outside the request",
    meaning: "The agent changed a file that has nothing to do with what you asked.",
  },
  {
    key: "preexisting",
    status: "neutral",
    label: "Already in your working tree",
    meaning: "It was there before this session started, so this agent did not cause it.",
  },
];

// The annotated receipt in "Read a receipt": each line belongs to one state.
export const STATE_LINES: { state: StateKey; text: string; path?: string }[] = [
  { state: "done", text: "Reviews list on the salon page", path: "src/pages/Salon.tsx" },
  { state: "done_untested", text: "Newest first" },
  { state: "not_verified", text: "Reviews look right on a phone" },
  { state: "missed", text: "Empty state when there are no reviews" },
  { state: "question", text: "Can guests post reviews, or only signed-in users?" },
  { state: "outside", text: "Changed", path: "src/lib/payments.ts" },
  { state: "preexisting", text: "Secret sb_s*** in", path: "src/lib/supabase.ts" },
];

export const CHECKS: { id: string; title: string; text: string; example: string }[] = [
  {
    id: "secrets",
    title: "Secrets",
    text: "Changed files are scanned on your machine; a key that looks secret is reported masked to its first 4 characters.",
    example: "Secret: sb_s*** in src/lib/supabase.ts, move it to the server",
  },
  {
    id: "rls",
    title: "Supabase RLS",
    text: 'Your migrations run in a sandboxed Postgres to see which tables are really protected; a table it cannot read clearly shows "cannot confirm", never "safe".',
    example: "Table reviews: RLS is off",
  },
  {
    id: "tests",
    title: "Weakened tests",
    text: "Tests deleted, skipped or stripped of assertions during the session are flagged.",
    example: "1 test was skipped: reviews.test.ts",
  },
  {
    id: "packages",
    title: "Risky packages",
    text: "New dependencies are checked against npm for brand-new, missing or made-up names.",
    example:
      "react-star-ratingz: no package with this name on npm; it is probably an invented name",
  },
  {
    id: "scope",
    title: "Scope",
    text: "Files changed outside the feature you asked about are listed, so a quiet edit never slips by.",
    example: "Outside the request: src/lib/payments.ts",
  },
];

export const SENT = [
  "File paths",
  "Hashes",
  "Symbol names",
  'Counts like "+5 -0, comment only, top of file"',
  "Masked secret findings (sb_s***)",
];
export const NEVER_SENT = ["Source code", "Unmasked secrets", "Your token"];

export const COMPARISON: { name: string; checks: string; misses: string }[] = [
  {
    name: "Tests",
    checks: "That the code runs and does what the test says.",
    misses: "Whether the test covers what you asked for.",
  },
  {
    name: "Code review",
    checks: "That the code is correct and readable.",
    misses: "Your request, unless the reviewer was there when you asked.",
  },
  {
    name: "Codeceipt",
    checks: "That the agent did what you asked, from git.",
    misses: "Whether the code is good: keep your tests and reviews.",
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Do you store my code?",
    a: "No. Your code is read on your machine. Codeceipt stores file paths, hashes, symbol names, change counts and short summaries; source code never leaves your computer.",
  },
  {
    q: "Which agents does it work with?",
    a: "Claude Code, Cursor and Codex make receipts on their own. OpenCode and Antigravity work too; there you run `codeceipt receipt` when you finish.",
  },
  { q: "What does it cost?", a: "It's free during the beta." },
  {
    q: "Does it work with Lovable?",
    a: "Yes, through GitHub: connect the repository your Lovable, Bolt or Replit project pushes to, and receipts are made on push.",
  },
  {
    q: "What happens to my token?",
    a: "`npx codeceipt` saves it in your user config folder, never in your repo. The server keeps only a hash of it, and you can revoke it on your Account page at any time.",
  },
  {
    q: "How do I remove it?",
    a: "On your Account page, revoke the computer's key or delete your account (that removes every project and all its data). On your computer, delete the .git/codeceipt folder in your repo and the codeceipt folder in your user config folder. The Privacy page lists every step.",
  },
];
