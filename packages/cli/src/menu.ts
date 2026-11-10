// Roadmap Phase 9: `codeceipt` with no arguments, in a repo that is already connected and in a terminal someone can
// answer, shows a short numbered menu instead of running the setup again. Each entry is an ordinary command (the same
// one `codeceipt status` and docs/actions.md name), so the menu only saves typing.

export type MenuEntry = { label: string; argv: string[] | null };

export const MENU: MenuEntry[] = [
  { label: "What to do next (codeceipt status)", argv: ["status"] },
  { label: "Show the last receipt (codeceipt last)", argv: ["last"] },
  { label: "Review my changes against the build checklist (codeceipt review)", argv: ["review"] },
  { label: "Check my changes before a commit (codeceipt guard)", argv: ["guard"] },
  { label: "Run the tests for this change (codeceipt prove)", argv: ["prove"] },
  { label: "Check the install, login and hooks (codeceipt doctor)", argv: ["doctor"] },
  // null: the setup itself (connect this repo again).
  { label: "Connect this repo again (codeceipt connect)", argv: null },
];

export const MENU_QUESTION = "This repo is connected to Codeceipt. What do you want to do?";

/** The answer typed at the prompt as a menu index, or null to quit (Enter, q, or anything not on the menu). */
export function menuChoice(answer: string, size = MENU.length): number | null {
  const t = answer.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return n >= 1 && n <= size ? n - 1 : null;
}
