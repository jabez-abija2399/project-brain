import { oauthRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import { type AuthInfo, type McpServer, ProtocolError } from "@modelcontextprotocol/server";
import { z } from "zod";
import { appOriginOf } from "./auth";
import { blueprintSummary, proposeBlueprint } from "./blueprint-agent";
import { checkPackage } from "./check-package";
import { createChecklist, proposeChecklistChange } from "./checklist";
import { findSimilarComponents } from "./components";
import { getContextPack } from "./context-pack";
import { getDb } from "./db";
import { AppError } from "./errors";
import { FeatureNotFoundError, resolveFeature } from "./feature-ref";
import { mcpResource, verifyOAuthAccessToken } from "./mcp-oauth";
import { planProject } from "./plan";
import { MCP_CALLS_PER_MINUTE, rateLimit } from "./rate-limit";
import { generateReceipt } from "./receipt";
import {
  type ToolToken,
  addDecision,
  bindToken,
  listFeatures,
  saveProgress,
  whereDidWeStop,
} from "./session-tools";
import { SUSPENDED_PROJECT, SUSPENDED_USER } from "./suspension";

// JSON-RPC error codes of the MCP route (docs/specs/FEAT-011.md section 7).

export const MCP_ERROR = {
  invalidParams: -32602,
  unauthorized: -32001,
  notFound: -32004,
  rateLimited: -32005,
  internal: -32603,
} as const;

// Bearer token -> the one project it belongs to. Missing, unknown or revoked tokens return undefined, so the route
// answers 401 before any tool runs. The token itself is never logged. Two kinds are accepted, and both resolve to one
// project only: a CLI project token (pb_...), and an OAuth access token from a grant made for this server's /mcp
// (mcp-oauth.ts). The OAuth project comes from its grant, never from the request.
export async function verifyProjectToken(
  req: Request,
  bearer?: string,
): Promise<AuthInfo | undefined> {
  const value = bearer?.trim();
  if (!value) return undefined;
  const db = getDb();
  const row = await projectTokensRepo.findActiveByValue(db, value);
  if (row) {
    await projectTokensRepo.touchLastUsed(db, row.projectId, row.id).catch(() => {});
    return authInfoFor(db, value, row.id, row.projectId);
  }
  const oauth = await verifyOAuthAccessToken(db, value, mcpResource(appOriginOf(req)));
  if (!oauth) return undefined;
  await oauthRepo.touchGrant(db, oauth.grantId, new Date()).catch(() => {});
  return authInfoFor(db, value, oauth.grantId, oauth.projectId, oauth.expiresAt);
}

// Suspension (2026-11-01) is carried to the tools, which answer with the clear message instead of a bare 401.
async function authInfoFor(
  db: ReturnType<typeof getDb>,
  token: string,
  clientId: string,
  projectId: string,
  expiresAt?: Date,
): Promise<AuthInfo> {
  const s = await projectsRepo.suspensionOf(db, projectId);
  const suspended = s?.owner ? "user" : s?.project ? "project" : "";
  return {
    token,
    clientId,
    scopes: [],
    ...(expiresAt ? { expiresAt: expiresAt.getTime() / 1000 } : {}),
    extra: { projectId, suspended },
  };
}

function tokenOf(authInfo: AuthInfo | undefined): ToolToken {
  const projectId = authInfo?.extra?.projectId;
  if (!authInfo || typeof projectId !== "string") {
    throw new ProtocolError(MCP_ERROR.unauthorized, "unauthorized");
  }
  const suspended = authInfo.extra?.suspended;
  if (suspended === "user") throw new AppError(403, "suspended", SUSPENDED_USER);
  if (suspended === "project") throw new AppError(403, "suspended", SUSPENDED_PROJECT);
  return { id: authInfo.clientId, projectId };
}

// One error shape: field name for invalid input, not_found for anything the token may not see, nothing internal.
function toProtocolError(err: unknown): ProtocolError {
  if (err instanceof ProtocolError) return err;
  // A wrong feature names the valid ones (this project's only), so the agent can retry with one of them.
  if (err instanceof FeatureNotFoundError) {
    // The name asked for is not echoed: the answer is the same for a missing feature and another project's one.
    return new ProtocolError(
      MCP_ERROR.notFound,
      `feature not found; use one of: ${err.valid.join(", ") || "(no features yet: run the index)"}`,
      { valid_features: err.valid },
    );
  }
  if (err instanceof AppError) {
    if (err.status === 400) {
      const field = Object.keys(err.fieldErrors ?? {})[0] ?? "_";
      const reason = err.fieldErrors?.[field] ?? "invalid";
      return new ProtocolError(MCP_ERROR.invalidParams, `invalid argument "${field}": ${reason}`, {
        field,
      });
    }
    if (err.status === 401) return new ProtocolError(MCP_ERROR.unauthorized, "unauthorized");
    if (err.code === "suspended") return new ProtocolError(MCP_ERROR.unauthorized, err.message);
    if (err.status === 404) return new ProtocolError(MCP_ERROR.notFound, "not_found");
    // A fixed state code (plan_not_open): the call cannot apply to the current state.
    if (err.status === 409) return new ProtocolError(MCP_ERROR.invalidParams, err.code);
    if (err.code === "ai_budget_exhausted") {
      const now = Date.now();
      const nextDay = (Math.floor(now / 86_400_000) + 1) * 86_400_000;
      return new ProtocolError(MCP_ERROR.rateLimited, "ai_budget_exhausted", {
        retry_after_s: Math.ceil((nextDay - now) / 1000),
      });
    }
    if (err.status === 429) {
      return new ProtocolError(MCP_ERROR.rateLimited, "rate_limited", { retry_after_s: 60 });
    }
    // Safe, fixed codes (ai_unavailable, ai_not_configured): what to do next, no internal detail.
    if (err.status === 502 || err.status === 503)
      return new ProtocolError(MCP_ERROR.internal, err.code);
  }
  console.error("[mcp] unexpected error:", err instanceof Error ? err.name : "unknown");
  return new ProtocolError(MCP_ERROR.internal, "internal error");
}

// Postgres counters, shared by every server instance (D-010).
export { MCP_CALLS_PER_MINUTE };

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

// Runs a tool for the token's project and maps every failure to the route's error shape.
async function run(
  name: string,
  authInfo: AuthInfo | undefined,
  fn: (token: ToolToken) => Promise<string>,
) {
  const started = Date.now();
  let outcome = "ok";
  let projectId = "";
  try {
    const token = tokenOf(authInfo);
    projectId = token.projectId;
    await rateLimit(getDb(), `mcp:${token.id}`, MCP_CALLS_PER_MINUTE);
    await rateLimit(getDb(), `mcp-project:${token.projectId}`, MCP_CALLS_PER_MINUTE);
    return text(await fn(token));
  } catch (err) {
    // The SDK turns any error thrown by a tool into an isError result whose text is only the message, so the
    // tool returns that result itself, with the spec's code and data as JSON the client can read.
    const mapped = toProtocolError(err);
    outcome = String(mapped.code);
    const body = {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.data ? { data: mapped.data } : {}),
    };
    return { ...text(JSON.stringify(body)), isError: true };
  } finally {
    console.info("[mcp]", name, JSON.stringify({ projectId, ms: Date.now() - started, outcome }));
  }
}

// Dogfooding (edutech): the feature exactly as where_did_we_stop shows it. Descriptions are kept short: every
// connected agent loads all of them at the start of each session (roadmap Phase 2a budget, docs/performance.md).
const FEATURE_REF = "Feature name, key or id";

const projectId = z.string().optional().describe("Optional; must be the token's project");

// The FEAT-011 tools (plus the FEAT-012 checklist tools; list_features is the old name of where_did_we_stop {features: true}). Arguments are checked again by each service (field caps, trimming); the schemas here
// describe them to the client. Read tools never call an LLM.
export function registerBrainTools(server: McpServer): void {
  server.registerTool(
    "where_did_we_stop",
    {
      description:
        "Start-of-session note: goal, next step, open items, decisions, the owner's rules. With features: true, " +
        "the feature list (id, name, files, status) instead.",
      inputSchema: z.object({
        projectId,
        features: z.literal(true).optional().describe("Return the feature list instead"),
        blueprint: z.literal(true).optional().describe("The Blueprint instead"),
      }),
    },
    async (args, ctx) =>
      run("where_did_we_stop", ctx.http?.authInfo, async (token) => {
        const { features, blueprint, ...rest } = (args ?? {}) as {
          features?: unknown;
          blueprint?: unknown;
        };
        if (blueprint !== undefined) {
          if (blueprint !== true || features !== undefined) {
            throw new AppError(400, "invalid_input", "blueprint must be true, without features");
          }
          const { projectId: pid, ...extra } = rest as { projectId?: string };
          if (Object.keys(extra).length > 0)
            throw new AppError(400, "invalid_input", "unknown field");
          return blueprintSummary(getDb(), token, pid);
        }
        if (features === undefined) return whereDidWeStop(getDb(), token, rest);
        if (features !== true) throw new AppError(400, "invalid_input", "features must be true");
        return JSON.stringify(await listFeatures(getDb(), token, rest));
      }),
  );

  server.registerTool(
    "get_context_pack",
    {
      description: "A feature's files, components, decisions, rules and checklist. No source code.",
      inputSchema: z.object({
        projectId,
        feature: z.string().describe(FEATURE_REF),
      }),
    },
    async (args, ctx) =>
      run("get_context_pack", ctx.http?.authInfo, async (token) => {
        const input = parseFeatureArgs(args);
        bindToken(token, input.projectId);
        const feature = await resolveFeature(getDb(), token.projectId, input.feature);
        return getContextPack(getDb(), token.projectId, feature.name);
      }),
  );

  server.registerTool(
    "find_similar_component",
    {
      description: "Up to 3 existing components like the query, to reuse instead of duplicating.",
      inputSchema: z.object({ projectId, query: z.string().describe("Name or purpose") }),
    },
    async (args, ctx) =>
      run("find_similar_component", ctx.http?.authInfo, async (token) => {
        const input = parseQueryArgs(args);
        bindToken(token, input.projectId);
        const matches = await findSimilarComponents(getDb(), token.projectId, input.query);
        return JSON.stringify({ matches });
      }),
  );

  // The old name of where_did_we_stop {features: true}: kept listed for one release (AC-011-01 names it; changing
  // that criterion is the owner's call, docs/owner-actions.md). Same answer, one short line in tools/list.
  server.registerTool(
    "list_features",
    {
      description: "Old name of where_did_we_stop with features: true.",
      inputSchema: z.object({ projectId }),
    },
    async (args, ctx) =>
      run("list_features", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await listFeatures(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "save_progress",
    {
      description: "Save where this session stopped: goal, done, unfinished, next step.",
      inputSchema: z.object({
        projectId,
        goal: z.string(),
        done: z.string().optional(),
        unfinished: z.string().optional(),
        nextStep: z.string(),
      }),
    },
    async (args, ctx) =>
      run("save_progress", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await saveProgress(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "add_decision",
    {
      description: "Record a decision with its reason.",
      inputSchema: z.object({ projectId, title: z.string(), reason: z.string().optional() }),
    },
    async (args, ctx) =>
      run("add_decision", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await addDecision(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "create_checklist",
    {
      description:
        "Store the user's request on a feature as 1-10 checklist items (vague ones flagged). Change items only " +
        "via propose_checklist_change.",
      inputSchema: z.object({
        projectId,
        feature: z.string().optional().describe(FEATURE_REF),
        featureId: z.string().optional().describe("Older name of feature"),
        request: z.string().describe("The user's request as written (max 4,000 chars)"),
      }),
    },
    async (args, ctx) =>
      run("create_checklist", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await createChecklist(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "plan_project",
    {
      description:
        "Plan a project. Stage 1: idea -> restated idea + up to 8 questions with defaults. Stage 2: planId + " +
        "answers (or approveDefaults) -> draft plan. Only the owner can approve it, in the dashboard.",
      inputSchema: z.object({
        projectId,
        idea: z.string().optional().describe("Stage 1: the idea as written (max 8,000 chars)"),
        planId: z.string().optional().describe("Stage 2: plan_id from stage 1"),
        answers: z
          .record(z.string(), z.string())
          .optional()
          .describe("Stage 2: answers by question id (q1..q8)"),
        approveDefaults: z.literal(true).optional().describe("Stage 2: use every default"),
      }),
    },
    async (args, ctx) =>
      run("plan_project", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await planProject(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "propose_checklist_change",
    {
      description:
        "Propose rewording or dismissing a checklist item; the owner confirms it in the dashboard.",
      inputSchema: z.object({
        projectId,
        itemId: z.string().describe("Checklist item id"),
        text: z.string().optional().describe("New wording"),
        dismiss: z.literal(true).optional().describe("Propose dismissing it"),
      }),
    },
    async (args, ctx) =>
      run("propose_checklist_change", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await proposeChecklistChange(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "propose_blueprint",
    {
      description:
        "Propose a criterion, a rewording (replaces) or a boundary; the owner approves it.",
      inputSchema: z.object({
        projectId,
        feature: z.string().optional().describe(FEATURE_REF),
        text: z.string().describe("EARS sentence, or path/package"),
        kind: z.enum([
          "behaviour",
          "must_never",
          "security",
          "protected_path",
          "allowed_dependency",
          "disallowed_dependency",
        ]),
        replaces: z.string().optional(),
      }),
    },
    async (args, ctx) =>
      run("propose_blueprint", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await proposeBlueprint(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "generate_receipt",
    {
      description:
        "Check a change against the request's checklist: per-item done/partial/missed with evidence, files by " +
        "feature, new dependencies, security findings.",
      // Only the fields an agent fills in are advertised. The session-end hook also sends replacesReceiptId,
      // secretFindings*, testIntegrity, changeSummaries, preExistingFiles and snapshot: looseObject passes them
      // through and the service validates every field strictly, so nothing unchecked reaches the receipt.
      inputSchema: z.looseObject({
        projectId,
        requestId: z.string().optional().describe("From create_checklist (optional)"),
        changedFiles: z.array(z.string()).describe("Changed repo paths (max 200)"),
        commitSha: z.string().optional().describe("Commit id, if committed"),
        packageJson: z
          .array(
            z.object({
              path: z.string(),
              before: z.string().nullable().optional(),
              after: z.string(),
            }),
          )
          .optional()
          .describe("Changed package.json files, text before and after (max 10)"),
      }),
    },
    async (args, ctx) =>
      run("generate_receipt", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await generateReceipt(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "check_package",
    {
      description:
        "Check an npm package before installing: exists, age, last release, repo, 7-day release cooldown.",
      inputSchema: z.object({
        projectId,
        name: z.string().describe("npm package name"),
        version: z.string().optional().describe("Exact version (default: latest)"),
      }),
    },
    async (args, ctx) =>
      run("check_package", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await checkPackage(token, args)),
      ),
  );
}

const featureArgs = z
  .object({
    projectId: z.string().min(1).max(100).optional(),
    feature: z.string().trim().min(1, "is required").max(100, "must be 100 characters or fewer"),
  })
  .strict();
const queryArgs = z
  .object({
    projectId: z.string().min(1).max(100).optional(),
    query: z.string().trim().min(1, "is required").max(200, "must be 200 characters or fewer"),
  })
  .strict();

function parseWith<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) fieldErrors[issue.path.join(".") || "_"] = issue.message;
  throw new AppError(400, "invalid_input", "input validation failed", fieldErrors);
}
const parseFeatureArgs = (raw: unknown) => parseWith(featureArgs, raw);
const parseQueryArgs = (raw: unknown) => parseWith(queryArgs, raw);
