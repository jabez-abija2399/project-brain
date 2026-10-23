import type { ZodSchema } from "zod";
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
