// Roadmap Phase 6: approval policies. Every action that needs a decision has a risk level; the owner's policy (a preset
// plus rules) decides per action whether it is never allowed, always asked, done automatically and reported, or done
// automatically. Pure and deterministic: the server stores the policy and the requests, this decides. Agents can only
// ask; only the owner changes a policy or decides a request (enforced by the server). See docs/approvals.md.
import { globMatch } from "./blueprint/boundary-check";

export type Risk = "low" | "medium" | "high" | "locked";
export type Choice = "never" | "ask" | "auto_tell" | "auto";
export type Preset = "careful" | "balanced" | "fast";

/** Every action that needs a decision, with its risk level (docs/approvals.md lists them in plain words). */
export const APPROVAL_ACTIONS = {
  // Low: automatic by default.
  fix_wording: "low",
  add_criterion: "low",
  link_test: "low",
  postpone_item: "low",
  close_item: "low",
  add_decision: "low",
  // Medium: automatic, and the owner is told.
  change_criterion_meaning: "medium",
  add_dependency: "medium",
  add_protected_path: "medium",
  rename_feature: "medium",
  merge_features: "medium",
  add_prove_command: "medium",
  // High: the owner is asked.
  remove_criterion: "high",
  delete_feature: "high",
  approve_plan: "high",
  approve_import: "high",
  share_publicly: "high",
  edit_protected_file: "high",
  comment_on_public_pr: "high",
  // Locked: always asked, never automatic, whatever the policy says.
  remove_guard_criterion: "locked",
  remove_protected_path: "locked",
  turn_off_done_gate: "locked",
  turn_off_guard: "locked",
  change_approval_policy: "locked",
} as const satisfies Record<string, Risk>;
export type ApprovalAction = keyof typeof APPROVAL_ACTIONS;

export const isApprovalAction = (v: unknown): v is ApprovalAction =>
  typeof v === "string" && Object.hasOwn(APPROVAL_ACTIONS, v);

/** What each preset does per risk level. Locked is always "ask" (only a "never" rule is stricter). */
export const PRESETS: Record<Preset, Record<Exclude<Risk, "locked">, Choice>> = {
  careful: { low: "auto_tell", medium: "ask", high: "ask" },
  balanced: { low: "auto", medium: "auto_tell", high: "ask" },
  fast: { low: "auto", medium: "auto", high: "ask" },
};

/** A rule: when every given field matches, this choice applies. Absent fields match anything. */
export type ApprovalRule = {
  action?: ApprovalAction | "*";
  feature?: string;
  path?: string;
  agent?: string;
  choice: Choice;
};
export type Policy = { preset: Preset; rules: ApprovalRule[]; pausedUntil?: string | null };
export type ApprovalSubject = {
  action: ApprovalAction;
  feature?: string | null;
  path?: string | null;
  agent?: string | null;
};

export const MAX_RULES = 100;
export const DEFAULT_POLICY: Policy = { preset: "balanced", rules: [] };
const ORDER: Choice[] = ["never", "ask", "auto_tell", "auto"];

const ruleMatches = (r: ApprovalRule, s: ApprovalSubject) =>
  (r.action === undefined || r.action === "*" || r.action === s.action) &&
  (r.feature === undefined || (s.feature ?? "").toLowerCase() === r.feature.toLowerCase()) &&
  (r.agent === undefined || (s.agent ?? "").toLowerCase() === r.agent.toLowerCase()) &&
  (r.path === undefined || (s.path ? globMatch(r.path, s.path) : false));

/**
 * The decision for one action. Matching rules are evaluated never first, then ask, then the automatic choices (the
 * first matching rule wins within a level); with no matching rule the preset decides. A locked action is never
 * automatic, and while the policy is paused nothing is automatic.
 */
export function decide(
  policy: Policy,
  subject: ApprovalSubject,
  now: Date = new Date(),
): { choice: Choice; risk: Risk; reason: string } {
  const risk: Risk = APPROVAL_ACTIONS[subject.action];
  const matching = policy.rules.slice(0, MAX_RULES).filter((r) => ruleMatches(r, subject));
  let choice: Choice | undefined;
  let reason = "";
  for (const level of ORDER) {
    const rule = matching.find((r) => r.choice === level);
    if (rule) {
      choice = level;
      reason = "a rule of the owner's policy";
      break;
    }
  }
  if (choice === undefined) {
    choice = risk === "locked" ? "ask" : PRESETS[policy.preset][risk];
    reason = `the ${policy.preset} preset (${risk} risk)`;
  }
  if (risk === "locked" && choice !== "never" && choice !== "ask") {
    choice = "ask";
    reason = "locked actions are always asked";
  }
  const paused = policy.pausedUntil
    ? new Date(policy.pausedUntil).getTime() > now.getTime()
    : false;
  if (paused && (choice === "auto" || choice === "auto_tell")) {
    choice = "ask";
    reason = "automatic approvals are paused";
  }
  return { choice, risk, reason };
}

const strictness = (c: Choice) => ORDER.length - ORDER.indexOf(c);
const ALL_ACTIONS = Object.keys(APPROVAL_ACTIONS) as ApprovalAction[];

/**
 * Whether a new policy is looser than the old one for any action (then the owner confirms it), compared action by
 * action on its own (no feature, path or agent). Removing a pause also counts as loosening.
 */
export function loosens(before: Policy, after: Policy, now: Date = new Date()): boolean {
  for (const action of ALL_ACTIONS) {
    const a = decide(before, { action }, now).choice;
    const b = decide(after, { action }, now).choice;
    if (strictness(b) < strictness(a)) return true;
  }
  // Scoped rules: any rule that allows more than the preset would for its action.
  for (const rule of after.rules) {
    if (rule.choice !== "auto" && rule.choice !== "auto_tell") continue;
    const same = before.rules.some((r) => JSON.stringify(r) === JSON.stringify(rule));
    if (!same) return true;
  }
  return false;
}

const CHOICES = new Set<Choice>(["never", "ask", "auto_tell", "auto"]);
const PRESET_NAMES = new Set<Preset>(["careful", "balanced", "fast"]);
const SHORT = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;

/** A policy from untrusted input, or null when anything in it is not valid (nothing is half accepted). */
export function parsePolicy(raw: unknown): Policy | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { preset?: unknown; rules?: unknown; pausedUntil?: unknown };
  if (!PRESET_NAMES.has(r.preset as Preset)) return null;
  const rules = r.rules === undefined ? [] : r.rules;
  if (!Array.isArray(rules) || rules.length > MAX_RULES) return null;
  const out: ApprovalRule[] = [];
  for (const item of rules) {
    if (typeof item !== "object" || item === null) return null;
    const it = item as Record<string, unknown>;
    const keys = Object.keys(it);
    if (keys.some((k) => !["action", "feature", "path", "agent", "choice"].includes(k)))
      return null;
    if (!CHOICES.has(it.choice as Choice)) return null;
    if (it.action !== undefined && it.action !== "*" && !isApprovalAction(it.action)) return null;
    for (const k of ["feature", "path", "agent"] as const) {
      if (it[k] !== undefined && !SHORT(it[k], 200)) return null;
    }
    out.push(it as ApprovalRule);
  }
  let pausedUntil: string | null = null;
  if (r.pausedUntil !== undefined && r.pausedUntil !== null) {
    if (typeof r.pausedUntil !== "string" || Number.isNaN(Date.parse(r.pausedUntil))) return null;
    pausedUntil = new Date(r.pausedUntil).toISOString();
  }
  return { preset: r.preset as Preset, rules: out, pausedUntil };
}

/** How long a pending request waits for the owner (default 24 hours), then it expires (nothing happens). */
export const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
