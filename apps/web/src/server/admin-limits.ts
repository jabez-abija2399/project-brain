import { safeDisplay } from "@brain/core";
import { type BrainDb, type Limits, adminAuditRepo, usageLimitsRepo, usersRepo } from "@brain/db";
import { z } from "zod";
import type { Admin } from "./admin";
import { AppError } from "./errors";
import { BUILT_IN, defaultLimits, limitsReady } from "./limits";
import { rateLimit } from "./rate-limit";

// FEAT-041 (owner, 2026-11-25): an admin changes the default beta limits and gives specific users their own. Every
// entry point is admin-only (requireAdmin / pageAdmin: 404 for anyone else), every value is checked here, and each
// accepted change writes one audit row (old and new numbers) in the same transaction as the change.

const projectsLimit = z.number().int().min(0).max(100_000).nullable();
const judgedLimit = z.number().int().min(0).max(1_000_000).nullable();
const userRef = {
  userId: z
    .string()
    .regex(/^[\w-]{1,100}$/)
    .optional(),
  email: z.string().trim().email().max(320).optional(),
};

export const limitsSchema = z.discriminatedUnion("scope", [
  z
    .object({ scope: z.literal("default"), projects: projectsLimit, judgedPerMonth: judgedLimit })
    .strict(),
  z
    .object({
      scope: z.literal("user"),
      ...userRef,
      projects: projectsLimit,
      judgedPerMonth: judgedLimit,
    })
    .strict(),
  z.object({ scope: z.literal("clear"), ...userRef }).strict(),
]);

const words = (l: Limits | null) =>
  l === null
    ? "default"
    : `projects ${l.projects ?? "no limit"}, AI checks ${l.judgedPerMonth ?? "no limit"}`;

async function resolveUser(db: BrainDb, ref: { userId?: string; email?: string }): Promise<string> {
  if (ref.userId) {
    if (!(await usersRepo.getById(db, ref.userId))) throw new AppError(404, "not_found");
    return ref.userId;
  }
  if (ref.email) {
    const id = await usageLimitsRepo.userIdByEmail(db, ref.email);
    if (!id) throw new AppError(404, "not_found", "No user has that email.");
    return id;
  }
  throw new AppError(400, "invalid_input", "send a userId or an email");
}

/** Applies one limits change for an admin. */
export async function setLimits(admin: Admin, db: BrainDb, raw: unknown, now = new Date()) {
  await rateLimit(db, `admin:limits:${admin.user.id}`, 60, now);
  const parsed = limitsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(
      400,
      "invalid_input",
      "Limits are whole numbers from 0 (projects up to 100000, AI checks up to 1000000), or empty for no limit.",
    );
  }
  if (!(await limitsReady(db))) {
    throw new AppError(409, "not_set_up", "Limits are not set up yet: apply migration 0058.");
  }
  const input = parsed.data;
  const audit = { adminUserId: admin.user.id, adminLogin: admin.login };
  if (input.scope === "default") {
    const before = await defaultLimits(db);
    const next = { projects: input.projects, judgedPerMonth: input.judgedPerMonth };
    await db.transaction(async (tx) => {
      const t = tx as unknown as BrainDb;
      await usageLimitsRepo.setDefault(t, next, admin.login);
      await adminAuditRepo.record(t, {
        ...audit,
        action: "set_default_limits",
        targetType: "limits",
        targetId: "default",
        detail: `${words(before)} -> ${words(next)}`,
      });
    });
    return { scope: "default" as const, ...next };
  }
  const userId = await resolveUser(db, input);
  const before = await usageLimitsRepo.getForUser(db, userId);
  if (input.scope === "clear") {
    await db.transaction(async (tx) => {
      const t = tx as unknown as BrainDb;
      if (await usageLimitsRepo.clearForUser(t, userId)) {
        await adminAuditRepo.record(t, {
          ...audit,
          action: "clear_user_limits",
          targetType: "user",
          targetId: userId,
          detail: `${words(before)} -> default`,
        });
      }
    });
    return { scope: "clear" as const, userId };
  }
  const next = { projects: input.projects, judgedPerMonth: input.judgedPerMonth };
  await db.transaction(async (tx) => {
    const t = tx as unknown as BrainDb;
    await usageLimitsRepo.setForUser(t, userId, next, admin.login);
    await adminAuditRepo.record(t, {
      ...audit,
      action: "set_user_limits",
      targetType: "user",
      targetId: userId,
      detail: `${words(before)} -> ${words(next)}`,
    });
  });
  return { scope: "user" as const, userId, ...next };
}

/** The limits page: whether it is set up, the defaults, and the users with their own limits. */
export async function limitsView(_admin: Admin, db: BrainDb) {
  if (!(await limitsReady(db))) return { ready: false as const, defaults: BUILT_IN, users: [] };
  const [defaults, users] = await Promise.all([
    defaultLimits(db),
    usageLimitsRepo.listUserLimits(db),
  ]);
  return {
    ready: true as const,
    defaults,
    users: users.map((u) => ({
      userId: u.userId,
      name: safeDisplay(u.name || u.email, 60),
      email: safeDisplay(u.email, 200),
      projects: u.projects,
      judgedPerMonth: u.judgedPerMonth,
      updatedBy: safeDisplay(u.updatedBy, 60),
      updatedAt: u.updatedAt.toISOString(),
    })),
  };
}
