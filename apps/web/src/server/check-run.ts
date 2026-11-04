// FEAT-022: the result of the repo's own check command (build or tests), run on the user's computer after a session.
// Only the result is accepted: status, exit code, duration and test counts. Any other field (output above all) is
// refused, so command output can never be stored.
import { type BrainDb, receiptsRepo } from "@brain/db";
import { z } from "zod";
import { AppError } from "./errors";

const count = z.number().int().min(0).max(1_000_000);
const schema = z
  .object({
    receipt_id: z.string().regex(/^[\w-]{1,64}$/),
    status: z.enum(["passed", "failed", "timed_out"]),
    exit_code: z.number().int().min(-255).max(255).nullable(),
    duration_ms: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600 * 1000),
    passed: count.optional(),
    failed: count.optional(),
  })
  .strict();

export async function recordCheckRun(db: BrainDb, projectId: string, raw: unknown) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      400,
      "invalid_input",
      "send { receipt_id, status, exit_code, duration_ms, passed?, failed? } and nothing else",
    );
  }
  const { receipt_id, ...run } = parsed.data;
  if (!(await receiptsRepo.setCheckRun(db, projectId, receipt_id, run))) {
    throw new AppError(404, "not_found");
  }
  return { receipt_id };
}
