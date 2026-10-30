import { createHash, randomBytes, randomInt } from "node:crypto";
import { type BrainDb, deviceCodesRepo, projectsRepo } from "@brain/db";
import { z } from "zod";
import { type SessionUser, requireProjectAccess } from "./auth";
import { AppError } from "./errors";
import { rateLimit } from "./rate-limit";
import { projectNameSchema } from "./validate";

// `npx codeceipt` device approval (launch part 1, after RFC 8628). The CLI starts a code, shows the short user code
// and opens /device; the signed-in owner approves it for one of their projects (or a new one); the CLI polls and gets
// a new project token for that project, once.
export const DEVICE_CODE_TTL_S = 600;
export const POLL_INTERVAL_S = 5;
const STARTS_PER_MINUTE_PER_IP = 10;
const POLLS_PER_MINUTE_PER_IP = 30;
const APPROVALS_PER_MINUTE_PER_USER = 10;
// No vowels (so no words) and no look-alikes (0/O, 1/I/L are left out): 20 letters, 20^8 codes.
const ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

// The caller's address for rate limits, hashed so no address is stored. Behind Vercel the first x-forwarded-for entry
// is the client.
function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
  return hash(ip).slice(0, 32);
}

/** The public address of the app: BETTER_AUTH_URL in production, else the request's own origin. */
export function appOrigin(req: Request): string {
  try {
    if (process.env.BETTER_AUTH_URL) return new URL(process.env.BETTER_AUTH_URL).origin;
  } catch {}
  return new URL(req.url).origin;
}

function userCode(): string {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${pick()}-${pick()}`;
}

function parse<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) fieldErrors[issue.path.join(".") || "_"] = issue.message;
  throw new AppError(400, "invalid_input", "input validation failed", fieldErrors);
}

const startSchema = z.object({ name: z.string().trim().max(100).optional() }).strict();

export async function startDevice(db: BrainDb, req: Request, raw: unknown, now = new Date()) {
  const input = parse(startSchema, raw ?? {});
  await rateLimit(db, `device:start:${clientKey(req)}`, STARTS_PER_MINUTE_PER_IP, now);
  const deviceCode = randomBytes(32).toString("base64url");
  const suggested = input.name ? projectNameSchema.safeParse(input.name) : null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = userCode();
    const row = await deviceCodesRepo.create(
      db,
      {
        deviceCodeHash: hash(deviceCode),
        userCode: code,
        suggestedName: suggested?.success ? suggested.data : null,
        expiresAt: new Date(now.getTime() + DEVICE_CODE_TTL_S * 1000),
      },
      now,
    );
    if (!row) continue;
    const base = appOrigin(req);
    return {
      device_code: deviceCode,
      user_code: code,
      verification_uri: `${base}/device`,
      verification_uri_complete: `${base}/device?code=${code}`,
      expires_in: DEVICE_CODE_TTL_S,
      interval: POLL_INTERVAL_S,
    };
  }
  throw new AppError(503, "try_again", "could not make a code; try again");
}

const pollSchema = z.object({ device_code: z.string().min(1).max(200) }).strict();

/** The CLI's poll: 200 with the token once approved, else 400 with an RFC 8628 error code. */
export async function pollDevice(db: BrainDb, req: Request, raw: unknown, now = new Date()) {
  const input = parse(pollSchema, raw);
  await rateLimit(db, `device:poll:${clientKey(req)}`, POLLS_PER_MINUTE_PER_IP, now);
  const result = await deviceCodesRepo.poll(
    db,
    hash(input.device_code),
    now,
    POLL_INTERVAL_S * 1000,
  );
  if (result.status === "approved") {
    console.info(
      "[device]",
      JSON.stringify({ event: "token_issued", projectId: result.projectId }),
    );
    return {
      status: 200,
      body: { access_token: result.token, project_id: result.projectId, api_url: appOrigin(req) },
    };
  }
  const error = {
    pending: "authorization_pending",
    slow_down: "slow_down",
    expired: "expired_token",
    denied: "access_denied",
    invalid: "invalid_grant",
  }[result.status];
  return { status: 400, body: { error } };
}

const approveSchema = z.union([
  z
    .object({ user_code: z.string().regex(USER_CODE), project_id: z.string().min(1).max(100) })
    .strict(),
  z
    .object({ user_code: z.string().regex(USER_CODE), new_project_name: projectNameSchema })
    .strict(),
  z.object({ user_code: z.string().regex(USER_CODE), deny: z.literal(true) }).strict(),
]);

const normalizeCode = (raw: unknown) => {
  if (typeof raw !== "object" || raw === null) return raw;
  const r = raw as Record<string, unknown>;
  return typeof r.user_code === "string"
    ? {
        ...r,
        user_code: r.user_code
          .trim()
          .toUpperCase()
          .replace(/^([A-Z]{4})([A-Z]{4})$/, "$1-$2"),
      }
    : r;
};

/**
 * The signed-in owner approves (or denies) a code shown by their CLI, for one of their projects or a new one. Wrong,
 * used or expired codes are 404, and attempts are limited per user so codes cannot be guessed.
 */
export async function approveDevice(
  db: BrainDb,
  user: SessionUser,
  raw: unknown,
  now = new Date(),
): Promise<{ ok: true; project_id: string } | { ok: true; denied: true }> {
  await rateLimit(db, `device:approve:${user.id}`, APPROVALS_PER_MINUTE_PER_USER, now);
  const input = parse(approveSchema, normalizeCode(raw));
  const pending = await deviceCodesRepo.pendingByUserCode(db, input.user_code, now);
  if (!pending) throw new AppError(404, "not_found");
  if ("deny" in input) {
    await deviceCodesRepo.decide(db, input.user_code, { userId: user.id, deny: true }, now);
    return { ok: true, denied: true };
  }
  const projectId =
    "project_id" in input
      ? (await requireProjectAccess(db, input.project_id, user)).id
      : (await projectsRepo.create(db, user.id, { name: input.new_project_name })).id;
  if (!(await deviceCodesRepo.decide(db, input.user_code, { userId: user.id, projectId }, now))) {
    throw new AppError(404, "not_found");
  }
  console.info("[device]", JSON.stringify({ event: "approved", projectId, actor: "session" }));
  return { ok: true, project_id: projectId };
}

/** The /device page: the pending code (if any) and the user's projects to pick from. */
export async function deviceView(
  db: BrainDb,
  user: SessionUser,
  rawCode: string,
  now = new Date(),
) {
  const code = rawCode.trim().toUpperCase();
  const pending = USER_CODE.test(code)
    ? await deviceCodesRepo.pendingByUserCode(db, code, now)
    : null;
  const { items } = await projectsRepo.listByOwner(db, user.id, { limit: 100, offset: 0 });
  return {
    code: pending ? code : null,
    suggestedName: pending?.suggestedName ?? null,
    projects: items.map((p) => ({ id: p.id, name: p.name })),
  };
}
