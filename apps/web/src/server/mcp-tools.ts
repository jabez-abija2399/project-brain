import { projectTokensRepo } from "@brain/db";
import { type AuthInfo, type McpServer, ProtocolError } from "@modelcontextprotocol/server";
import { z } from "zod";
import { checkPackage } from "./check-package";
import { createChecklist, proposeChecklistChange } from "./checklist";
import { findSimilarComponents } from "./components";
import { getContextPack } from "./context-pack";
import { getDb } from "./db";
import { AppError } from "./errors";
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

// JSON-RPC error codes of the MCP route (docs/specs/FEAT-011.md section 7).
export const MCP_ERROR = {
  invalidParams: -32602,
  unauthorized: -32001,
  notFound: -32004,
  rateLimited: -32005,
  internal: -32603,
} as const;

// Bearer token -> the one project it belongs to. Missing, unknown or revoked tokens return undefined, so the route
// answers 401 before any tool runs. The token itself is never logged.
export async function verifyProjectToken(
  _req: Request,
  bearer?: string,
): Promise<AuthInfo | undefined> {
  const value = bearer?.trim();
  if (!value) return undefined;
  const db = getDb();
  const row = await projectTokensRepo.findActiveByValue(db, value);
  if (!row) return undefined;
  await projectTokensRepo.touchLastUsed(db, row.projectId, row.id).catch(() => {});
  return { token: value, clientId: row.id, scopes: [], extra: { projectId: row.projectId } };
}

function tokenOf(authInfo: AuthInfo | undefined): ToolToken {
  const projectId = authInfo?.extra?.projectId;
  if (!authInfo || typeof projectId !== "string") {
    throw new ProtocolError(MCP_ERROR.unauthorized, "unauthorized");
  }
  return { id: authInfo.clientId, projectId };
}

// One error shape: field name for invalid input, not_found for anything the token may not see, nothing internal.
function toProtocolError(err: unknown): ProtocolError {
  if (err instanceof ProtocolError) return err;
  if (err instanceof AppError) {
    if (err.status === 400) {
      const field = Object.keys(err.fieldErrors ?? {})[0] ?? "_";
      const reason = err.fieldErrors?.[field] ?? "invalid";
      return new ProtocolError(MCP_ERROR.invalidParams, `invalid argument "${field}": ${reason}`, {
        field,
      });
    }
    if (err.status === 401) return new ProtocolError(MCP_ERROR.unauthorized, "unauthorized");
    if (err.status === 404) return new ProtocolError(MCP_ERROR.notFound, "not_found");
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

const projectId = z
  .string()
  .optional()
  .describe("Optional: the token's project is used. If given, it must be the token's project id.");

// The FEAT-011 tools (plus list_features and the FEAT-012 checklist tools). Arguments are checked again by each service (field caps, trimming); the schemas here
// describe them to the client. Read tools never call an LLM.
export function registerBrainTools(server: McpServer): void {
  server.registerTool(
    "where_did_we_stop",
    {
      description:
        "Handoff note for the start of a session: last goal, next step, open items, recent decisions, the project's feature names and the owner's standing instructions.",
      inputSchema: z.object({ projectId }),
    },
    async (args, ctx) =>
      run("where_did_we_stop", ctx.http?.authInfo, (token) => whereDidWeStop(getDb(), token, args)),
  );

  server.registerTool(
    "get_context_pack",
    {
      description:
        "A feature's files, component summaries, recent decisions and the owner's rules. No source code.",
      inputSchema: z.object({ projectId, feature: z.string().describe("Feature name") }),
    },
    async (args, ctx) =>
      run("get_context_pack", ctx.http?.authInfo, async (token) => {
        const input = parseFeatureArgs(args);
        bindToken(token, input.projectId);
        return getContextPack(getDb(), token.projectId, input.feature);
      }),
  );

  server.registerTool(
    "find_similar_component",
    {
      description:
        "Existing components whose name or summary is close to the query, so the agent reuses instead of duplicating.",
      inputSchema: z.object({ projectId, query: z.string().describe("Component name or purpose") }),
    },
    async (args, ctx) =>
      run("find_similar_component", ctx.http?.authInfo, async (token) => {
        const input = parseQueryArgs(args);
        bindToken(token, input.projectId);
        const matches = await findSimilarComponents(getDb(), token.projectId, input.query);
        return JSON.stringify({ matches });
      }),
  );

  server.registerTool(
    "list_features",
    {
      description:
        "The project's features by name, with how many files each has and its status (at most 200; truncated says when there are more).",
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
      description:
        "Save where this session stopped: goal, what was done, what is unfinished, the next step.",
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
        "Store the user's request on a feature and split it into 1-10 checklist items (items that are too vague " +
        "are flagged needs_clarification). Items can only be changed later through propose_checklist_change.",
      inputSchema: z.object({
        projectId,
        featureId: z.string().describe("Feature id the request belongs to"),
        request: z.string().describe("The user's request, as they wrote it (max 4,000 characters)"),
      }),
    },
    async (args, ctx) =>
      run("create_checklist", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await createChecklist(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "propose_checklist_change",
    {
      description:
        "Propose new wording for a checklist item, or dismissing it. Nothing changes until the project owner " +
        "confirms the proposal in the dashboard.",
      inputSchema: z.object({
        projectId,
        itemId: z.string().describe("Checklist item id"),
        text: z.string().optional().describe("Proposed new wording"),
        dismiss: z.literal(true).optional().describe("Propose dismissing the item"),
      }),
    },
    async (args, ctx) =>
      run("propose_checklist_change", ctx.http?.authInfo, async (token) =>
        JSON.stringify(await proposeChecklistChange(getDb(), token, args)),
      ),
  );

  server.registerTool(
    "generate_receipt",
    {
      description:
        "Check a change against the request's open checklist items: per item done/partial/missed with file " +
        "evidence, changed files by feature, files outside the request's feature, items that are not verified, " +
        "new dependencies, and security findings (secrets, RLS off or open to everyone).",
      inputSchema: z.object({
        projectId,
        requestId: z
          .string()
          .describe("The request the change was made for (from create_checklist)"),
        changedFiles: z
          .array(z.string())
          .describe("Repo-relative paths of the changed files (max 200)"),
        commitSha: z.string().optional().describe("Commit id of the change, if committed"),
        packageJson: z
          .array(
            z.object({
              path: z.string().describe("Repo-relative path of the package.json"),
              before: z
                .string()
                .nullable()
                .optional()
                .describe("Its text before the change (null if new)"),
              after: z.string().describe("Its text after the change"),
            }),
          )
          .optional()
          .describe(
            "Changed package.json files; every newly added dependency is checked on npm (max 10 files)",
          ),
        secretFindings: z
          .array(
            z.object({
              file: z.string(),
              line: z.number(),
              type: z.string(),
              masked_value: z.string(),
            }),
          )
          .optional()
          .describe(
            "Masked secret findings from `projectbrain scan-secrets` on the changed files (never raw values)",
          ),
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
        "Check an npm package before installing it: exists, risky, not found or unreachable, with its age, last " +
        "release, repository link, and the 7-day release cooldown for the latest (or given) version.",
      inputSchema: z.object({
        projectId,
        name: z.string().describe("npm package name, e.g. zod or @scope/name"),
        version: z
          .string()
          .optional()
          .describe("Exact version to check, e.g. 3.23.8 (default: latest)"),
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
