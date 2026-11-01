import { fixPrompt, receiptView, safeDisplay } from "@brain/core";
import { type BoardSort, type BrainDb, checklistItemsRepo, dashboardRepo } from "@brain/db";
import { type SessionUser, requireProjectAccess } from "./auth";

// FEAT-017 dashboard data. Every function checks that the signed-in user owns the project first (404 otherwise) and
// reads one page of at most PAGE_SIZE rows; every text is cleaned and masked for display.
export const PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

/** ?page=N from the URL: a whole number from 1; anything else is page 1. */
export function pageNumber(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value && /^\d{1,5}$/.test(value) ? Number(value) : 1;
  return Math.min(Math.max(n, 1), MAX_PAGE);
}

export type Paged<T> = { rows: T[]; total: number; page: number; pages: number };
const paged = <T>(rows: T[], total: number, page: number): Paged<T> => ({
  rows,
  total,
  page,
  pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
});
const offset = (page: number) => (page - 1) * PAGE_SIZE;

/** The feature board's order from ?sort= (anything else is by name). */
export function boardSort(raw: string | string[] | undefined): BoardSort {
  return raw === "open" || raw === "recent" ? raw : "name";
}

export async function featureBoard(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  page: number,
  sort: BoardSort = "name",
) {
  const project = await requireProjectAccess(db, projectId, user);
  const [{ rows, total }, counts] = await Promise.all([
    dashboardRepo.featureBoard(db, project.id, PAGE_SIZE, offset(page), sort),
    dashboardRepo.featureCounts(db, project.id),
  ]);
  return {
    project: { id: project.id, name: safeDisplay(project.name, 100) },
    sort,
    counts,
    ...paged(
      rows.map((r) => ({
        id: r.id,
        name: safeDisplay(r.name, 100),
        // Free text in the database: anything but the known values is shown as "unknown".
        status: ["todo", "in_progress", "done"].includes(r.status) ? r.status : "unknown",
        files: r.files,
        openItems: r.openItems,
        doneItems: r.doneItems,
        totalItems: r.totalItems,
        nextItem: r.nextItem === null ? null : safeDisplay(r.nextItem) || null,
        lastReceiptAt: r.lastReceiptAt?.toISOString() ?? null,
      })),
      total,
      page,
    ),
  };
}

export async function receiptsFeed(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  page: number,
) {
  const project = await requireProjectAccess(db, projectId, user);
  const { rows, total } = await dashboardRepo.receiptsFeed(db, project.id, PAGE_SIZE, offset(page));
  return {
    project: { id: project.id, name: safeDisplay(project.name, 100) },
    ...paged(
      rows.map((r) => {
        const view = receiptView(r.summaryJson);
        const asked = r.asked === null ? null : safeDisplay(r.asked);
        return {
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          asked,
          commitSha:
            r.commitSha && /^[0-9a-f]{7,40}$/.test(r.commitSha) ? r.commitSha.slice(0, 12) : null,
          view,
          fixPrompt: fixPrompt(asked, view),
        };
      }),
      total,
      page,
    ),
  };
}

export async function pendingProposals(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  page: number,
) {
  const project = await requireProjectAccess(db, projectId, user);
  const { rows, total } = await checklistItemsRepo.listProposals(
    db,
    project.id,
    PAGE_SIZE,
    offset(page),
  );
  return {
    project: { id: project.id, name: safeDisplay(project.name, 100) },
    ...paged(
      rows.flatMap((r) => {
        const change = r.proposedChange;
        if (!change || !r.proposedAt) return [];
        return [
          {
            id: r.id,
            text: safeDisplay(r.text),
            // The exact proposal shown: the dashboard sends it back with confirm or reject (FEAT-017).
            proposedAt: r.proposedAt.toISOString(),
            change: "text" in change ? { text: change.text } : { dismiss: true as const },
            shownText: "text" in change ? safeDisplay(change.text) : null,
          },
        ];
      }),
      total,
      page,
    ),
  };
}

export async function connectStatus(db: BrainDb, user: SessionUser, projectId: string) {
  const project = await requireProjectAccess(db, projectId, user);
  return {
    project: { id: project.id, name: safeDisplay(project.name, 100) },
    indexedFiles: await dashboardRepo.indexedFiles(db, project.id),
  };
}
