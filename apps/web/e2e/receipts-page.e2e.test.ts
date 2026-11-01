import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  fromPostgres,
  projectsRepo,
  receipts,
  receiptsRepo,
  requestsRepo,
  sessions,
  usersRepo,
} from "@brain/db";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The production bug of 2026-11-01, end to end: the receipts page, with real receipts on several days, served by
// `next build` + `next start` and read over HTTP as a signed-in user. The page must render its day headings and no
// server error may reach the log. Needs E2E_DATABASE_URL: a disposable Postgres database (the test writes rows into it;
// migrations are applied to it first). Run with `pnpm --filter @brain/web test:e2e`.

const web = fileURLToPath(new URL("..", import.meta.url));
const dbPackage = fileURLToPath(new URL("../../../packages/db", import.meta.url));
const PORT = 3917;
// The production start refuses an http:// BETTER_AUTH_URL, so the app is addressed as https (never fetched here).
const BASE = `http://localhost:${PORT}`;
const APP_URL = "https://e2e.codeceipt.test";
const COOKIE = "__Secure-better-auth.session_token";
const DAY = 86_400_000;
// Receipts on three past days, so each gets its own heading (no "Today"/"Yesterday", which move with the clock).
const DAYS_AGO = [3, 6, 9];

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

describe("production build: the receipts page renders with receipts on several days", () => {
  let server: ChildProcess | null = null;
  let serverLog = "";
  let client: ReturnType<typeof postgres> | null = null;
  let projectId = "";
  let cookie = "";
  const expectedDays = DAYS_AGO.map((d) => isoDay(Date.now() - d * DAY));

  beforeAll(async () => {
    const url = process.env.E2E_DATABASE_URL;
    if (!url) {
      throw new Error(
        "E2E_DATABASE_URL is not set: point it at a disposable Postgres database (this test writes rows into it).",
      );
    }
    const secret = randomBytes(32).toString("hex");
    // Production start checks that every service is configured. This page calls none of them, so their values are
    // placeholders (the GitHub App key is a real PEM so the check passes). Nothing from the caller's environment leaks in.
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs1", format: "pem" })
      .toString();
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
      DATABASE_URL: url,
      BETTER_AUTH_SECRET: secret,
      BETTER_AUTH_URL: APP_URL,
      GITHUB_CLIENT_ID: "e2e",
      GITHUB_CLIENT_SECRET: "e2e",
      GITHUB_APP_ID: "0",
      GITHUB_APP_PRIVATE_KEY: privateKey,
      GITHUB_WEBHOOK_SECRET: "e2e",
      ANTHROPIC_API_KEY: "e2e",
      INNGEST_EVENT_KEY: "e2e",
      INNGEST_SIGNING_KEY: "e2e",
    };

    execFileSync(process.execPath, ["src/migrate.mjs"], { cwd: dbPackage, env, stdio: "inherit" });
    execFileSync("pnpm", ["exec", "next", "build"], {
      cwd: web,
      env,
      stdio: "inherit",
      timeout: 900_000,
    });

    client = postgres(url, { max: 2, prepare: false, onnotice: () => {} });
    const db = fromPostgres(client);
    const userId = randomUUID();
    await usersRepo.upsertById(db, {
      id: userId,
      name: "e2e",
      email: `${userId.slice(0, 8)}@example.com`,
    });
    projectId = (await projectsRepo.create(db, userId, { name: "e2e receipts" })).id;
    for (const [n, daysAgo] of DAYS_AGO.entries()) {
      const { request } = await requestsRepo.createWithItems(
        db,
        projectId,
        { featureId: null, text: `Change ${n + 1}` },
        [],
      );
      const receipt = await receiptsRepo.insert(db, projectId, {
        requestId: request.id,
        summaryJson: { items: [] },
      });
      await db
        .update(receipts)
        .set({ createdAt: new Date(Date.now() - daysAgo * DAY) })
        .where(eq(receipts.id, receipt.id));
    }

    // A real session row, signed the way better-auth signs its session cookie (HMAC-SHA256 of the token).
    const token = randomBytes(24).toString("base64url");
    await db.insert(sessions).values({
      id: randomUUID(),
      userId,
      token,
      expiresAt: new Date(Date.now() + DAY),
    });
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    cookie = `${COOKIE}=${encodeURIComponent(`${token}.${signature}`)}`;

    server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
      cwd: web,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => {
      serverLog += chunk;
    });
    server.stderr?.on("data", (chunk) => {
      serverLog += chunk;
    });
    await waitForServer(
      () => serverLog.includes("Ready in"),
      () => server?.exitCode !== null,
      120_000,
    );
  }, 1_200_000);

  afterAll(async () => {
    if (server && server.exitCode === null) {
      const exited = new Promise((resolve) => server?.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
    }
    await client?.end();
  });

  it("shows a heading for each day with receipts, newest first, and one card per receipt", async () => {
    const res = await fetch(`${BASE}/projects/${projectId}/receipts`, { headers: { cookie } });
    const html = await res.text();
    expect(res.status).toBe(200);
    const headings = [...html.matchAll(/<li class="day-heading"[^>]*><h2[^>]*>([^<]*)<\/h2>/g)].map(
      (m) => m[1],
    );
    expect(headings).toEqual(expectedDays);
    expect(html.match(/data-search="/g)?.length).toBe(DAYS_AGO.length);
    expect(html).toContain("Needs attention");
  });

  it("the server logs no client-boundary error (dayLabel called from the server)", () => {
    expect(serverLog).not.toMatch(/Attempted to call/);
    expect(serverLog).not.toMatch(/is on the client/);
  });
});

// Waits for Next.js to report it is ready. A server that exits first is a failure, with its log in the message.
async function waitForServer(ready: () => boolean, exited: () => boolean, budgetMs: number) {
  const until = Date.now() + budgetMs;
  while (!ready()) {
    if (exited()) throw new Error("the production server exited before it was ready");
    if (Date.now() > until) throw new Error("the production server did not become ready in time");
    await new Promise((r) => setTimeout(r, 500));
  }
}
