// Roadmap Phase 6b: what the approvals page shows. The owner's project (access checked) and the approvals overview
// (policy, pending requests, automatic approvals), plus the plain-words risk table for the Detailed view.
import { APPROVAL_ACTIONS, type ApprovalAction, PRESETS, type Risk } from "@brain/core";
import type { BrainDb } from "@brain/db";
import { approvalsOverview } from "./approvals";
import { type SessionUser, requireProjectAccess } from "./auth";

/** Each action in plain words, for the page (the table in docs/approvals.md). */
export const ACTION_LABELS: Record<ApprovalAction, string> = {
  fix_wording: "Fix the wording of a rule",
  add_criterion: "Add a rule",
  link_test: "Link a test to a rule",
  postpone_item: "Postpone a checklist item",
  close_item: "Close a checklist item",
  add_decision: "Record a decision",
  change_criterion_meaning: "Change what a rule means",
  add_dependency: "Add a package",
  add_protected_path: "Protect a folder",
  rename_feature: "Rename a feature",
  merge_features: "Merge features",
  add_prove_command: "Add a new “prove it” command",
  remove_criterion: "Remove a rule",
  delete_feature: "Delete a feature",
  approve_plan: "Approve a plan",
  approve_import: "Approve an import",
  share_publicly: "Share publicly",
  edit_protected_file: "Edit a protected file",
  comment_on_public_pr: "Comment on a public pull request",
  remove_guard_criterion: "Remove a security or must-never rule",
  remove_protected_path: "Remove a protected folder",
  turn_off_done_gate: "Turn off the done gate",
  turn_off_guard: "Turn off Codeceipt Guard",
  change_approval_policy: "Change this approval policy",
};

export const CHOICE_LABELS = {
  never: "Never",
  ask: "Ask me",
  auto_tell: "Automatic, tell me",
  auto: "Automatic",
} as const;

export const PRESET_TEXT = {
  careful: "Careful: you are asked about anything beyond small fixes.",
  balanced:
    "Balanced: small things happen on their own, bigger ones are reported, risky ones are asked.",
  fast: "Fast: almost everything happens on its own; risky and locked actions are still asked.",
} as const;

export async function approvalsPage(db: BrainDb, user: SessionUser, projectId: string) {
  const project = await requireProjectAccess(db, projectId, user);
  const overview = await approvalsOverview(db, user, projectId);
  const table = (Object.entries(APPROVAL_ACTIONS) as [ApprovalAction, Risk][]).map(
    ([action, risk]) => ({
      action,
      label: ACTION_LABELS[action],
      risk,
      careful: risk === "locked" ? "ask" : PRESETS.careful[risk],
      balanced: risk === "locked" ? "ask" : PRESETS.balanced[risk],
      fast: risk === "locked" ? "ask" : PRESETS.fast[risk],
    }),
  );
  return { project: { id: project.id, name: project.name }, overview, table };
}
