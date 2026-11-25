import { receiptNeedsAttention, receiptView, safeDisplay } from "@brain/core";
import { type BrainDb, checklistItemsRepo, featuresRepo, receiptsRepo } from "@brain/db";
import { type SessionUser, isPlausibleId, requireProjectAccess } from "./auth";
import { AppError } from "./errors";

const MAX_ITEMS = 200;
const MAX_RECEIPTS = 20;

/**
 * FEAT-034: one feature's page: its status (agreeing with its progress), its checklist and its newest receipts. The
 * owner's project only; a feature of another project, or an unknown id, is not found.
 */
export async function featureDetail(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  featureId: string,
) {
  const project = await requireProjectAccess(db, projectId, user);
  const feature = isPlausibleId(featureId)
    ? await featuresRepo.byId(db, project.id, featureId)
    : null;
  if (!feature) throw new AppError(404, "not_found");
  const [items, rows] = await Promise.all([
    checklistItemsRepo.listForFeature(db, project.id, feature.id, MAX_ITEMS),
    receiptsRepo.listForFeature(db, project.id, feature.id, MAX_RECEIPTS),
  ]);
  const done = items.filter((i) => i.status === "done").length;
  const status = !["todo", "in_progress", "done"].includes(feature.status)
    ? "unknown"
    : feature.status === "todo" && done > 0
      ? "in_progress"
      : feature.status;
  return {
    project: { id: project.id, name: safeDisplay(project.name, 100) },
    feature: { id: feature.id, name: safeDisplay(feature.name, 100), status },
    done,
    total: items.length,
    items: items.map((i) => ({
      id: i.id,
      text: safeDisplay(i.text),
      status: i.status as "open" | "partial" | "missed" | "done" | "done_untested" | "postponed",
    })),
    receipts: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      asked: safeDisplay(r.asked),
      attention: receiptNeedsAttention(receiptView(r.summaryJson)),
    })),
  };
}
