// FEAT-021: read-only links to one receipt. The owner makes and revokes them; anyone with the link sees that receipt
// (request, items, checks, evidence summary) and nothing else from the project. A link's token is 192 random bits,
// shown once; only its SHA-256 is stored, and a lookup also compares the hash in constant time.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { itemIdsOf, receiptView, safeDisplay } from "@brain/core";
import { type BrainDb, checklistItemsRepo, shareLinksRepo } from "@brain/db";
import { type SessionUser, isPlausibleId, requireProjectAccess } from "./auth";
import { AppError } from "./errors";

export const MAX_ACTIVE_LINKS = 100;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createShareLink(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  receiptId: string,
  origin: string,
): Promise<{ id: string; url: string; createdAt: string }> {
  const project = await requireProjectAccess(db, projectId, user);
  if (
    !isPlausibleId(receiptId) ||
    !(await shareLinksRepo.receiptInProject(db, project.id, receiptId))
  ) {
    throw new AppError(404, "not_found");
  }
  if ((await shareLinksRepo.activeCount(db, project.id)) >= MAX_ACTIVE_LINKS) {
    throw new AppError(
      409,
      "too_many_links",
      `This project already has ${MAX_ACTIVE_LINKS} active share links: revoke one first.`,
    );
  }
  const token = randomBytes(24).toString("base64url");
  const row = await shareLinksRepo.create(db, project.id, receiptId, hashOf(token));
  return { id: row.id, url: `${origin}/r/${token}`, createdAt: row.createdAt.toISOString() };
}

export async function revokeShareLink(
  db: BrainDb,
  user: SessionUser,
  projectId: string,
  linkId: string,
): Promise<void> {
  const project = await requireProjectAccess(db, projectId, user);
  if (!isPlausibleId(linkId) || !(await shareLinksRepo.revoke(db, project.id, linkId))) {
    throw new AppError(404, "not_found");
  }
}

/** The receipt behind a link, ready to show read-only; null for anything but an active link's exact token. */
export async function sharedReceipt(db: BrainDb, token: string) {
  if (!TOKEN.test(token)) return null;
  const hash = hashOf(token);
  const row = await shareLinksRepo.findActiveByHash(db, hash);
  if (!row || !timingSafeEqual(Buffer.from(row.tokenHash, "utf8"), Buffer.from(hash, "utf8")))
    return null;
  const closed = await checklistItemsRepo.closedByOwnerAmong(
    db,
    row.projectId,
    itemIdsOf(row.summaryJson),
  );
  return {
    id: row.receiptId,
    createdAt: row.createdAt.toISOString(),
    asked: row.asked === null ? null : safeDisplay(row.asked),
    commitSha:
      row.commitSha && /^[0-9a-f]{7,40}$/.test(row.commitSha) ? row.commitSha.slice(0, 12) : null,
    view: receiptView(row.summaryJson, closed),
  };
}
