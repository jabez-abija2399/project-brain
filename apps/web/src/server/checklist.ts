import { createHash } from "node:crypto";
import {
  MAX_ITEM_CHARS,
  MAX_REQUEST_CHARS,
  errorType,
  maskSecretsIn,
  oneLineText,
  splitRequest,
} from "@brain/core";
import {
  type BrainDb,
  type ShownProposal,
  checklistItemsRepo,
  featuresRepo,
  requestsRepo,
} from "@brain/db";
import { z } from "zod";
import { type SessionUser, isPlausibleId, requireProjectAccess } from "./auth";
import { dailyAiBudget } from "./code-index-limits";
import { AppError } from "./errors";
import { resolveFeature } from "./feature-ref";
import { getLlm } from "./llm";
import { reserveDaily } from "./rate-limit";
import { type ToolToken, bindToken } from "./session-tools";

const id = z.string().min(1).max(100);
const createSchema = z
  .object({
    projectId: id.optional(),
    // The feature as list_features and the start note show it (name, key or id); featureId is the older name.
    feature: id.optional(),
    featureId: id.optional(),
    request: z
      .string()
      .trim()
      .min(1, "is required")
      .max(MAX_REQUEST_CHARS, `must be ${MAX_REQUEST_CHARS} characters or fewer`)
      .refine((v) => !v.includes("\u0000"), "must not contain NUL bytes"),
  })
  .strict();
const proposeSchema = z
  .object({
    projectId: id.optional(),
    itemId: id,
    text: z
      .string()
      .trim()
      .min(3, "must be at least 3 characters")
      .max(MAX_ITEM_CHARS, `must be ${MAX_ITEM_CHARS} characters or fewer`)
      .refine((v) => !v.includes("\u0000"), "must not contain NUL bytes")
      .optional(),
    dismiss: z.literal(true).optional(),
  })
  .strict()
  .refine((v) => (v.text === undefined) !== (v.dismiss === undefined), {
    message: "give either text or dismiss",
    path: ["text"],
  });

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) fieldErrors[issue.path.join(".") || "_"] = issue.message;
  throw new AppError(400, "invalid_input", "input validation failed", fieldErrors);
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

export type CreatedChecklist = {
  request_id: string;
  feature_id: string;
  feature: string;
  items: { id: string; text: string; needs_clarification: boolean }[];
};

/**
 * MCP create_checklist (FEAT-012): stores the request on its feature and splits it into 1-10 items with exactly one
 * LLM call, counted against the project's daily AI budget. The request is stored as written (secrets masked) and
 * is only ever handed back as labelled user data. Logs ids, counts and a hash, never the text.
 */
export async function createChecklist(
  db: BrainDb,
  token: ToolToken,
  raw: unknown,
  now = new Date(),
): Promise<CreatedChecklist> {
  const started = Date.now();
  const input = parse(createSchema, raw);
  bindToken(token, input.projectId);
  const pid = token.projectId;
  const ref = input.feature ?? input.featureId;
  if (!ref)
    throw new AppError(400, "invalid_input", "input validation failed", { feature: "is required" });
  // A feature of another project is not found, like a missing one; the error lists this project's names.
  const feature = await resolveFeature(db, pid, ref);
  const llm = getLlm();
  if (!llm)
    throw new AppError(503, "ai_not_configured", "the checklist splitter is not configured");
  const granted = await reserveDaily(db, `ai:${pid}`, dailyAiBudget(), 1, now);
  if (granted === 0) {
    throw new AppError(
      429,
      "ai_budget_exhausted",
      "the project's daily AI budget is used up; try tomorrow",
    );
  }
  let items: Awaited<ReturnType<typeof splitRequest>>;
  try {
    items = await splitRequest(llm, input.request);
  } catch (err) {
    console.error(
      "[mcp]",
      "create_checklist",
      JSON.stringify({ projectId: pid, error: errorType(err) }),
    );
    throw new AppError(502, "ai_unavailable", "the checklist could not be made; try again");
  }
  const stored = await requestsRepo.createWithItems(
    db,
    pid,
    { featureId: feature.id, text: maskSecretsIn(input.request) },
    items.map((i) => ({ text: i.text, needsClarification: i.needs_clarification })),
  );
  console.info(
    "[mcp]",
    "create_checklist",
    JSON.stringify({
      projectId: pid,
      featureId: feature.id,
      ms: Date.now() - started,
      items: stored.items.length,
      llmCalls: 1,
      requestHash: hash(input.request),
      requestLength: input.request.length,
    }),
  );
  return {
    request_id: stored.request.id,
    feature_id: feature.id,
    feature: maskSecretsIn(feature.name),
    items: stored.items.map((i) => ({
      id: i.id,
      text: i.text,
      needs_clarification: i.needsClarification,
    })),
  };
}

/** MCP propose_checklist_change: an agent never rewords or deletes an item; it only leaves a proposal. */
export async function proposeChecklistChange(
  db: BrainDb,
  token: ToolToken,
  raw: unknown,
  now = new Date(),
): Promise<{ ok: true; id: string; status: "proposal" }> {
  const input = parse(proposeSchema, raw);
  bindToken(token, input.projectId);
  const change =
    input.text !== undefined
      ? { text: maskSecretsIn(oneLineText(input.text)) }
      : { dismiss: true as const };
  const row = await checklistItemsRepo.propose(db, token.projectId, input.itemId, change, now);
  if (!row) throw new AppError(404, "not_found");
  return { ok: true, id: row.id, status: "proposal" };
}

/**
 * Dashboard: the project is the user's and the item is in it, else 404. Checked before the request body, so a stranger
 * or a wrong item id always gets the same answer.
 */
export async function requireChecklistItem(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  itemId: string,
) {
  await requireProjectAccess(db, projectId, user);
  if (!isPlausibleId(itemId) || !(await checklistItemsRepo.byId(db, projectId, itemId))) {
    throw new AppError(404, "not_found");
  }
}

/**
 * Dashboard (the owner's session, never an MCP token): applies or rejects the item's proposed change. `shown` is the
 * proposal the owner saw (FEAT-017); when it no longer matches (the agent replaced it meanwhile), nothing changes and
 * the answer is 409 proposal_changed, so the owner looks again.
 */
export async function confirmChecklistChange(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  itemId: string,
  shown: ShownProposal,
) {
  await requireProjectAccess(db, projectId, user);
  const result = await checklistItemsRepo.applyProposal(db, projectId, itemId, shown);
  if (!result) throw new AppError(404, "not_found");
  if (result.kind === "no_proposal")
    throw new AppError(409, "no_proposal", "this item has no proposed change");
  if (result.kind === "changed") throw proposalChanged();
  return { id: result.item.id, text: result.item.text, status: result.item.status };
}

export async function rejectChecklistChange(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  itemId: string,
  shown: ShownProposal,
) {
  await requireProjectAccess(db, projectId, user);
  const result = await checklistItemsRepo.discardProposal(db, projectId, itemId, shown);
  if (!result) throw new AppError(404, "not_found");
  if (result.kind === "no_proposal")
    throw new AppError(409, "no_proposal", "this item has no proposed change");
  if (result.kind === "changed") throw proposalChanged();
  return { id: result.item.id, text: result.item.text, status: result.item.status };
}

const proposalChanged = () =>
  new AppError(
    409,
    "proposal_changed",
    "the proposal changed since you opened the page; reload and check it again",
  );
