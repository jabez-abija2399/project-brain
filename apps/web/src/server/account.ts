import { safeDisplay } from "@brain/core";
import { type BrainDb, accountRepo, usersRepo } from "@brain/db";
import { z } from "zod";
import type { SessionUser } from "./auth";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";

// The account page (2026-11-01). Every function acts on the signed-in user only; ids from the client are never used.

const DELETES_PER_MINUTE = 5;
const EXPORTS_PER_MINUTE = 5;

export async function accountView(db: BrainDb, user: SessionUser) {
  const [row, computers] = await Promise.all([
    usersRepo.getById(db, user.id),
    accountRepo.connectedComputers(db, user.id),
  ]);
  if (!row) throw new AppError(404, "not_found");
  return {
    name: safeDisplay(row.name, 100),
    email: safeDisplay(row.email, 200),
    // GitHub avatars only (https on GitHub's own host); anything else shows the initial instead.
    image:
      row.image && /^https:\/\/avatars\.githubusercontent\.com\//.test(row.image)
        ? row.image
        : null,
    createdAt: row.createdAt.toISOString(),
    suspended: row.suspendedAt !== null,
    computers: computers.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      projectName: safeDisplay(c.projectName, 100),
      label: c.label === null ? null : safeDisplay(c.label, 100),
      createdAt: c.createdAt.toISOString(),
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      revokedAt: c.revokedAt?.toISOString() ?? null,
    })),
  };
}

/** Ends every session of this user, in every browser (this one too). */
export async function endAllSessions(db: BrainDb, user: SessionUser) {
  return { ended: await accountRepo.endAllSessions(db, user.id) };
}

/** The user's data as JSON: projects, features, requests, checklist items, receipts, decisions. Never tokens. */
export async function exportAccount(db: BrainDb, user: SessionUser, now = new Date()) {
  await rateLimit(db, `account:export:${user.id}`, EXPORTS_PER_MINUTE, now);
  const data = await accountRepo.exportData(db, user.id);
  return { format: "codeceipt-export-1", exportedAt: now.toISOString(), ...data };
}

const deleteSchema = z.object({ confirm: z.string().max(200) }).strict();

/** Deletes the account for good, once the user has typed their account name exactly. */
export async function deleteAccount(
  db: BrainDb,
  user: SessionUser,
  raw: unknown,
  now = new Date(),
) {
  await rateLimit(db, `account:delete:${user.id}`, DELETES_PER_MINUTE, now);
  const parsed = deleteSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(400, "invalid_input", "send { confirm: <account name> }");
  const input = parsed.data;
  const row = await usersRepo.getById(db, user.id);
  if (!row) throw new AppError(404, "not_found");
  // Compared with the name exactly as the account page shows it.
  if (input.confirm.trim() !== safeDisplay(row.name, 100).trim()) {
    throw new AppError(400, "confirm_mismatch", "Type your account name exactly as shown.", {
      confirm: "does not match your account name",
    });
  }
  return accountRepo.deleteAccount(db, user.id);
}
