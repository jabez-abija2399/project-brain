import { DIRECTIVE_BUDGET, buildHandoffNote, maskSecretsIn, plainText } from "@brain/core";
import {
  type BrainDb,
  agentSessionsRepo,
  checklistItemsRepo,
  criteriaRepo,
  decisionsRepo,
  directivesRepo,
  featuresRepo,
} from "@brain/db";
import { z } from "zod";
import { type SessionUser, requireProjectAccess } from "./auth";
import { AppError } from "./errors";
import { blueprintEnabled } from "./migration-check";

// Field caps (FEAT-010 threat model: unbounded free text is noise). Over-length input returns 400.
const CAP = {
  goal: 200,
  nextStep: 500,
  done: 1000,
  unfinished: 1000,
  decisionTitle: 120,
  reason: 1000,
  directive: 500,
} as const;
const MAX_LIST = 50;
const DEFAULT_LIST = 20;
// Feature names in the handoff note; the note cuts the line to fit its limit.
const HANDOFF_FEATURES = 100;
// list_features returns at most this many features (by name) and says when the list was cut.
export const LIST_FEATURES_LIMIT = 200;

// The project a project token belongs to. The MCP transport (FEAT-011) resolves it from the bearer token.
export type ToolToken = { id: string; projectId: string };

// Optional: the token already names the project. When given it must be the token's own project (bindToken).
const projectIdField = z.string().min(1).max(100).optional();
const listLimit = z.number().int().min(1).max(MAX_LIST).optional();
const noNul = (value: string) => !value.includes("\u0000");
const required = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "is required")
    .max(max, `must be ${max} characters or fewer`)
    .refine(noNul, "must not contain NUL bytes");
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be ${max} characters or fewer`)
    .refine(noNul, "must not contain NUL bytes")
    .optional();

const progressSchema = z
  .object({
    projectId: projectIdField,
    goal: required(CAP.goal),
    done: optional(CAP.done),
    unfinished: optional(CAP.unfinished),
    nextStep: required(CAP.nextStep),
  })
  .strict();
const listProgressSchema = z.object({ projectId: projectIdField, limit: listLimit }).strict();
const decisionSchema = z
  .object({
    projectId: projectIdField,
    title: required(CAP.decisionTitle),
    reason: optional(CAP.reason),
  })
  .strict();
const listDecisionsSchema = z.object({ projectId: projectIdField, limit: listLimit }).strict();
const directiveSchema = z
  .object({ projectId: projectIdField, text: required(CAP.directive) })
  .strict();
const projectOnlySchema = z.object({ projectId: projectIdField }).strict();

// Secrets in saved text are masked before they are stored (AGENTS.md). Empty optional text is stored as null.
const mask = (value: string) => maskSecretsIn(value);
const maskOptional = (value: string | undefined) => (value ? maskSecretsIn(value) : null);

function parseArgs<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) fieldErrors[issue.path.join(".") || "_"] = issue.message;
  throw new AppError(400, "invalid_input", "input validation failed", fieldErrors);
}

// The tool's project argument, when given, must be the token's own project. Anything else is 404, like a missing
// project. Left out, the token's project is used.
export function bindToken(token: ToolToken, projectId: string | undefined): void {
  if (projectId !== undefined && projectId !== token.projectId)
    throw new AppError(404, "not_found");
}

// One log line per tool call: tool, project, duration, outcome. Never the saved text.
async function run<T>(tool: string, token: ToolToken, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  let outcome = "ok";
  try {
    return await fn();
  } catch (err) {
    outcome = err instanceof AppError ? err.code : "server_error";
    throw err;
  } finally {
    console.info(
      "[mcp]",
      tool,
      JSON.stringify({ projectId: token.projectId, ms: Date.now() - started, outcome }),
    );
  }
}

export async function saveProgress(db: BrainDb, token: ToolToken, raw: unknown) {
  return run("save_progress", token, async () => {
    const input = parseArgs(progressSchema, raw);
    bindToken(token, input.projectId);
    const row = await agentSessionsRepo.insert(db, token.projectId, {
      goal: mask(input.goal),
      done: maskOptional(input.done),
      unfinished: maskOptional(input.unfinished),
      nextStep: mask(input.nextStep),
    });
    return { ok: true as const, id: row.id };
  });
}

export async function listProgress(db: BrainDb, token: ToolToken, raw: unknown) {
  return run("list_progress", token, async () => {
    const input = parseArgs(listProgressSchema, raw);
    bindToken(token, input.projectId);
    const rows = await agentSessionsRepo.listNewest(
      db,
      token.projectId,
      input.limit ?? DEFAULT_LIST,
    );
    return {
      ok: true as const,
      sessions: rows.map((r) => ({
        id: r.id,
        goal: r.goal,
        done: r.done,
        unfinished: r.unfinished,
        nextStep: r.nextStep,
        createdAt: r.createdAt,
      })),
    };
  });
}

export async function addDecision(db: BrainDb, token: ToolToken, raw: unknown) {
  return run("add_decision", token, async () => {
    const input = parseArgs(decisionSchema, raw);
    bindToken(token, input.projectId);
    const row = await decisionsRepo.insert(db, token.projectId, {
      title: mask(input.title),
      reason: maskOptional(input.reason),
    });
    return { ok: true as const, id: row.id };
  });
}

export async function listDecisions(db: BrainDb, token: ToolToken, raw: unknown) {
  return run("list_decisions", token, async () => {
    const input = parseArgs(listDecisionsSchema, raw);
    bindToken(token, input.projectId);
    const rows = await decisionsRepo.listNewest(db, token.projectId, input.limit ?? DEFAULT_LIST);
    return {
      ok: true as const,
      decisions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    };
  });
}

// A directive from an agent is a proposal. It reaches where_did_we_stop only after the owner confirms it.
export async function saveDirective(db: BrainDb, token: ToolToken, raw: unknown) {
  return run("save_directive", token, async () => {
    const input = parseArgs(directiveSchema, raw);
    bindToken(token, input.projectId);
    const row = await directivesRepo.insert(db, token.projectId, {
      text: mask(input.text),
      status: "proposal",
      createdBy: "agent",
    });
    return { ok: true as const, id: row.id };
  });
}

// Filler words that do not change what an item asks for. Only these are dropped: the key stays conservative, so
// "/about" and "/contact" never collapse.
const FILLER = new Set(["a", "the", "short", "please", "to", "at", "top", "of"]);

// Real-test H: a near-duplicate key. Lowercase, punctuation out, filler words out. "Add a short comment at the top of
// the main page" and "Add a comment at the top of the main page" share one key.
export function nearDuplicateKey(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w && !FILLER.has(w));
  // A text made only of filler words keeps its own (lowercased) form.
  return words.length > 0 ? words.join(" ") : text.trim().toLowerCase();
}

/**
 * Real-test H (2026-11-01): the start note's items, newest request first. Open work (open, partly done, missed) and
 * postponed items are "still open"; questions and items done without a test are listed apart. A repeated request, or
 * a near-duplicate of one (nearDuplicateKey), is listed once with its count, "(xN)". `open` is the open work alone, in
 * order (the first is the next step).
 */
export function startNoteItems(
  rows: { text: string; status: string; needsClarification: boolean }[],
) {
  // Rows with the same near-duplicate key are one item: the first (newest) text is shown, with its count when > 1.
  const groups = new Map<string, { first: (typeof rows)[number]; count: number }>();
  for (const r of rows) {
    const key = nearDuplicateKey(r.text);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { first: r, count: 1 });
  }
  const out = {
    open: [] as string[],
    checklist: [] as string[],
    questions: [] as string[],
    untested: [] as string[],
  };
  for (const { first: r, count } of groups.values()) {
    const text = count > 1 ? `${r.text} (x${count})` : r.text;
    if (r.status === "done_untested") out.untested.push(text);
    else if (r.needsClarification) out.questions.push(text);
    else if (r.status === "postponed") out.checklist.push(`(postponed) ${text}`);
    else {
      out.open.push(text);
      out.checklist.push(text);
    }
  }
  return out;
}

export async function whereDidWeStop(db: BrainDb, token: ToolToken, raw: unknown): Promise<string> {
  return run("where_did_we_stop", token, async () => {
    const input = parseArgs(projectOnlySchema, raw);
    bindToken(token, input.projectId);
    const pid = token.projectId;
    // DB reads only, no LLM call (AGENTS.md). Seven small queries; each one is bounded.
    const [sessions, checklist, features, decisions, directives, all, next] = await Promise.all([
      agentSessionsRepo.listNewest(db, pid, 1),
      checklistItemsRepo.listOpenForProject(db, pid, 40),
      featuresRepo.listInProgress(db, pid, 10),
      decisionsRepo.listNewest(db, pid, 5),
      directivesRepo.listActive(db, pid),
      featuresRepo.listSummaries(db, pid, HANDOFF_FEATURES),
      featuresRepo.nextByBuildOrder(db, pid),
    ]);
    const last = sessions[0];
    const nextRules = next ? await nextFeatureRules(db, pid, next.id) : [];
    const items = startNoteItems(checklist);
    // Real-test H: the next step is the first truly open item; a saved step naming finished work is not repeated.
    // The "(xN)" count is not part of an item's text, so it is left off before the keys are compared.
    const plain = (t: string) => t.replace(/ \(x\d+\)$/, "");
    const listed = new Set(
      [...items.questions, ...items.untested].map((t) => nearDuplicateKey(plain(t))),
    );
    const saved = last?.nextStep ?? "";
    const nextStep =
      items.open[0] ?? (listed.has(nearDuplicateKey(saved)) ? "Start the next request" : saved);
    return buildHandoffNote({
      session: last
        ? {
            goal: last.goal ?? "",
            done: last.done,
            unfinished: last.unfinished,
            nextStep,
          }
        : null,
      checklist: items.checklist,
      questions: items.questions,
      untested: items.untested,
      featuresInProgress: features.map((f) => f.name),
      decisions: decisions.map((d) => ({ title: d.title, createdAt: d.createdAt })),
      directives: directives.map((d) => d.text),
      // With each id, so an agent can pass either to the tools that take a feature (dogfooding, edutech).
      // A name cannot fake another feature's id: commas and parentheses in it are shown as spaces (security pass).
      features: all.features.map(
        (f) => `${maskSecretsIn(f.name).replace(/[(),]/g, " ")} (id ${f.id})`,
      ),
      // FEAT-019: the approved plan's next feature by build order (AC-019-05).
      nextFeature: next ? maskSecretsIn(next.name) : null,
      nextRules,
    });
  });
}

// Roadmap Phase 4b: the next feature's owner-approved must-never and security criteria for the start note (DB read,
// at most 3). Empty before the Blueprint is set up, and on any read error: the note never fails because of it.
async function nextFeatureRules(db: BrainDb, pid: string, featureId: string): Promise<string[]> {
  if (!(await blueprintEnabled(db))) return [];
  try {
    const rows = await criteriaRepo.guardsForFeature(db, pid, featureId);
    // Invisible marks out first, then masking: a hidden mark inside a key can never keep it from being masked.
    return rows.map((c) => maskSecretsIn(plainText(c.text)));
  } catch {
    return [];
  }
}

// MCP list_features: the token's project's features by name, with primary file counts and status. DB read only.
export async function listFeatures(db: BrainDb, token: ToolToken, raw: unknown) {
  return run("list_features", token, async () => {
    const input = parseArgs(projectOnlySchema, raw);
    bindToken(token, input.projectId);
    const { features, total } = await featuresRepo.listSummaries(
      db,
      token.projectId,
      LIST_FEATURES_LIMIT,
    );
    return {
      features: features.map((f) => ({
        id: f.id,
        name: maskSecretsIn(f.name),
        files: f.files,
        status: f.status,
      })),
      total,
      truncated: total > features.length,
    };
  });
}

/** The owner dismisses an agent's directive proposal (backlog). Another project's or a non-proposal is 404. */
export async function dismissDirective(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  directiveId: string,
) {
  await requireProjectAccess(db, projectId, user);
  if (!(await directivesRepo.dismiss(db, projectId, directiveId))) {
    throw new AppError(404, "not_found");
  }
  return { id: directiveId, status: "dismissed" as const };
}

/** The owner's list of directive proposals waiting for a decision (backlog). */
export async function directiveProposals(db: BrainDb, user: SessionUser, projectId: string) {
  await requireProjectAccess(db, projectId, user);
  const rows = await directivesRepo.listProposals(db, projectId, new Date());
  return rows.map((d) => ({ id: d.id, text: d.text, createdAt: d.createdAt.toISOString() }));
}

// Dashboard side (the project owner's session, never an MCP token): confirms a proposal so it becomes active.
export async function confirmDirective(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  directiveId: string,
) {
  await requireProjectAccess(db, projectId, user);
  const result = await directivesRepo.activate(
    db,
    projectId,
    directiveId,
    DIRECTIVE_BUDGET,
    new Date(),
  );
  switch (result.kind) {
    case "activated":
      return {
        id: result.directive.id,
        status: result.directive.status,
        confirmedAt: result.directive.confirmedAt,
      };
    case "not_found":
      throw new AppError(404, "not_found");
    case "not_proposal":
      throw new AppError(409, "directive_not_proposal", `directive is already ${result.status}`);
    case "too_many":
      throw new AppError(
        409,
        "directive_limit",
        `a project may have at most ${result.max} active directives`,
      );
    case "over_budget":
      throw new AppError(
        409,
        "directive_budget_exceeded",
        `active directives may total ${result.budget} characters`,
      );
  }
}
