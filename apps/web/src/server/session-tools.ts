import { DIRECTIVE_BUDGET, buildHandoffNote, maskSecretsIn } from "@brain/core";
import {
  type BrainDb,
  agentSessionsRepo,
  checklistItemsRepo,
  decisionsRepo,
  directivesRepo,
  featuresRepo,
} from "@brain/db";
import { z } from "zod";
import { type SessionUser, requireProjectAccess } from "./auth";
import { AppError } from "./errors";

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

// The project a project token belongs to. The MCP transport (FEAT-011) resolves it from the bearer token.
export type ToolToken = { id: string; projectId: string };

const projectIdField = z.string().min(1).max(100);
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

// The tool's project argument must be the token's own project. Anything else is 404, like a missing project.
export function bindToken(token: ToolToken, projectId: string): void {
  if (projectId !== token.projectId) throw new AppError(404, "not_found");
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
      `[mcp] ${tool}`,
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

export async function whereDidWeStop(db: BrainDb, token: ToolToken, raw: unknown): Promise<string> {
  return run("where_did_we_stop", token, async () => {
    const input = parseArgs(projectOnlySchema, raw);
    bindToken(token, input.projectId);
    const pid = token.projectId;
    // DB reads only, no LLM call (AGENTS.md). Five small queries; each one is bounded.
    const [sessions, checklist, features, decisions, directives] = await Promise.all([
      agentSessionsRepo.listNewest(db, pid, 1),
      checklistItemsRepo.listOpenForProject(db, pid, 20),
      featuresRepo.listInProgress(db, pid, 10),
      decisionsRepo.listNewest(db, pid, 5),
      directivesRepo.listActive(db, pid),
    ]);
    const last = sessions[0];
    return buildHandoffNote({
      session: last
        ? {
            goal: last.goal ?? "",
            done: last.done,
            unfinished: last.unfinished,
            nextStep: last.nextStep ?? "",
          }
        : null,
      checklist: checklist.map((c) => c.text),
      featuresInProgress: features.map((f) => f.name),
      decisions: decisions.map((d) => ({ title: d.title, createdAt: d.createdAt })),
      directives: directives.map((d) => d.text),
    });
  });
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
