import { MAX_PAGE_SIZE } from "@brain/db";
import { type ZodSchema, z } from "zod";
import { AppError } from "./errors";

export async function parseInput<T>(req: Request, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError(400, "invalid_json", "request body is not valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      fieldErrors[key] = issue.message;
    }
    throw new AppError(400, "invalid_input", "input validation failed", fieldErrors);
  }
  return result.data;
}

// Project name rule shared by create and rename: trimmed, 1-80 characters.
export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "name is required")
  .max(80, "name must be 80 characters or fewer");

// Feature names follow the same rule (FEAT-006 rename).
export const featureNameSchema = projectNameSchema;

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(MAX_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});

// ?limit= (1-50, default 50) and ?offset= (default 0) for list endpoints.
export function parsePage(req: Request): { limit: number; offset: number } {
  const params = new URL(req.url).searchParams;
  const result = pageSchema.safeParse({
    limit: params.get("limit") ?? undefined,
    offset: params.get("offset") ?? undefined,
  });
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues)
      fieldErrors[issue.path.join(".") || "_"] = issue.message;
    throw new AppError(400, "invalid_input", "invalid pagination parameters", fieldErrors);
  }
  return result.data;
}
