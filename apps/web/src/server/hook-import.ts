import {
  IMPORT_SOURCES,
  ITEM_KINDS,
  draftHash,
  importDraft,
  safeDisplay,
  safePath,
} from "@brain/core";
import { type BrainDb, featuresRepo, planDraftsRepo } from "@brain/db";
import { z } from "zod";
import { AppError } from "./errors";

// Roadmap Phase 8: `codeceipt import`. The CLI reads the spec files on the user's machine and sends only what they
// describe (feature names, short criterion texts, file and line); no file content beyond that. The server cleans it
// again (never trusting the client), keeps only features the project does not have, and saves it as the project's plan
// draft. Nothing is active until the owner approves that exact draft on the Plan tab (approve_import is high risk);
// a project token has no way to approve it.

const EXISTING_LIMIT = 1_000;
const line = z.number().int().min(1).max(10_000_000);
const itemSchema = z
  .object({ text: z.string().trim().min(1).max(300), kind: z.enum(ITEM_KINDS), line })
  .strict();
const featureSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    path: z.string().min(1).max(200),
    line,
    dependsOn: z.array(z.string().max(100)).max(20),
    items: z.array(itemSchema).max(50),
  })
  .strict();
const bodySchema = z
  .object({
    source: z.enum(IMPORT_SOURCES),
    features: z.array(featureSchema).min(1).max(500),
  })
  .strict();

function parse(raw: unknown) {
  const r = bodySchema.safeParse(raw);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const i of r.error.issues.slice(0, 10)) fields[i.path.join(".") || "_"] = i.message;
  throw new AppError(400, "invalid_input", "input validation failed", fields);
}

export async function hookImport(db: BrainDb, projectId: string, raw: unknown) {
  const input = parse(raw);
  // Cleaned on the server as well: one line, invisible marks removed, secrets masked, capped.
  const features = input.features
    .map((f) => ({
      name: safeDisplay(f.name, 100),
      path: safePath(f.path).slice(0, 120),
      line: f.line,
      dependsOn: f.dependsOn.map((d) => safeDisplay(d, 100)).filter(Boolean),
      items: f.items
        .map((i) => ({ text: safeDisplay(i.text, 240), kind: i.kind, line: i.line }))
        .filter((i) => i.text.length > 0),
    }))
    .filter((f) => f.name.length > 0 && f.path.length > 0);
  const { features: existing } = await featuresRepo.listSummaries(db, projectId, EXISTING_LIMIT);
  const result = importDraft(
    input.source,
    features,
    existing.map((f) => f.name),
  );
  const count = result.draft.features.length;
  const base = { skipped: result.skipped, more: result.more, cut_items: result.cutItems };
  if (count === 0) {
    return {
      ...base,
      draft_id: null,
      features: 0,
      criteria: 0,
      next: "Nothing new to import: every feature found is already in the project.",
    };
  }
  const row = await planDraftsRepo.saveQuestions(db, projectId, {
    ideaText: `Imported from ${input.source}`,
    questions: { restated: result.draft.restated, questions: [] },
    createdBy: "import",
  });
  const saved = await planDraftsRepo.saveDraft(db, projectId, row.id, {
    answers: {},
    draft: result.draft,
    hash: draftHash(result.draft),
  });
  if (!saved)
    throw new AppError(409, "plan_changed", "another plan was saved at the same time; try again");
  return {
    ...base,
    draft_id: saved.id,
    features: count,
    criteria: result.draft.features.reduce((n, f) => n + f.items.length, 0),
    next: "This import is a draft, not active. The project owner reviews and approves it on the Plan tab; agents and tokens cannot approve it.",
  };
}
