import {
  MAX_REQUEST_CHARS,
  classifyRequest,
  isAcknowledgement,
  maskSecretsIn,
  requestForStorage,
} from "@brain/core";
import { type BrainDb, featuresRepo, requestsRepo } from "@brain/db";
import { z } from "zod";
import { dailyAiBudget, dailyCaptureCap } from "./code-index-limits";
import { AppError } from "./errors";
import { getLlm } from "./llm";
import { releaseDaily, reserveDaily } from "./rate-limit";

// Requests captured by the agents' prompt-submit hooks (`codeceipt hook prompt`), tied to the agent session. One AI
// call per new message, counted against the daily budget, decides whether it is a request, its feature and its
// checklist; the text is masked and capped first. A message the same session already sent is not recorded again.
// Only a short summary is stored (no pasted code), acknowledgements cost nothing, and stored captures have a daily cap.
const SAME_TEXT_WINDOW_MS = 24 * 3600_000;
const MAX_FEATURE_NAMES = 200;

const captureSchema = z
  .object({
    text: z.string().max(1_000_000),
    session_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "must be a plain id"),
  })
  .strict();

export async function captureRequest(
  db: BrainDb,
  projectId: string,
  raw: unknown,
  now = new Date(),
) {
  const parsed = captureSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "invalid_input", "input validation failed");
  const { session_id: sessionId } = parsed.data;
  if (parsed.data.text.includes("\u0000"))
    throw new AppError(400, "invalid_input", "text has a NUL byte");
  const text = maskSecretsIn(parsed.data.text.trim()).slice(0, MAX_REQUEST_CHARS).trim();
  if (text === "") throw new AppError(400, "invalid_input", "text is empty");
  if (isAcknowledgement(text)) return { recorded: false };
  const stored = requestForStorage(text);

  const since = new Date(now.getTime() - SAME_TEXT_WINDOW_MS);
  const known = await requestsRepo.findRecentByText(db, projectId, stored, since, sessionId);
  if (known) return { recorded: true, duplicate: true, request_id: known.id };
  if ((await reserveDaily(db, `capture:${projectId}`, dailyCaptureCap(), 1, now)) === 0) {
    return { recorded: false, reason: "daily_capture_cap" };
  }

  const { features } = await featuresRepo.listSummaries(db, projectId, MAX_FEATURE_NAMES);
  const llm = getLlm();
  const granted = llm ? await reserveDaily(db, `ai:${projectId}`, dailyAiBudget(), 1, now) : 0;
  // No AI (not configured, or the day's budget is used up): the request is kept as said, without a checklist.
  let captured: Awaited<ReturnType<typeof classifyRequest>> | null = null;
  if (llm && granted > 0) {
    try {
      captured = await classifyRequest(
        llm,
        text,
        features.map((f) => f.name),
      );
    } catch {
      await releaseDaily(db, `ai:${projectId}`, 1, now);
    }
  }
  if (captured?.kind === "none") {
    await releaseDaily(db, `capture:${projectId}`, 1, now);
    return { recorded: false };
  }
  const feature = captured?.feature ? features.find((f) => f.name === captured.feature) : undefined;
  const items = captured?.kind === "request" ? captured.items : [];
  const created = await requestsRepo.createWithItems(
    db,
    projectId,
    { featureId: feature?.id ?? null, text: stored, sessionId },
    items.map((i) => ({ text: i.text, needsClarification: i.needs_clarification })),
  );
  return {
    recorded: true,
    request_id: created.request.id,
    feature: feature ? maskSecretsIn(feature.name) : null,
    items: created.items.length,
  };
}
