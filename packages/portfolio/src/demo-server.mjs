// Portfolio demo server: the real Codeceipt web app (production build) on an in-memory PGlite database, seeded with
// one invented demo project, "salon-booking". Never real user data. Writes the demo session cookie and project token
// to a local JSON file (outside the repo) for the screenshot and CLI steps; neither ever appears in an image.
import { execFile, spawn } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import postgres from "postgres";

const DB_PORT = Number(process.env.PORTFOLIO_DB_PORT ?? 54329);
export const APP_PORT = Number(process.env.PORTFOLIO_APP_PORT ?? 3919);
const STATE_FILE = process.env.PORTFOLIO_STATE ?? "/tmp/codeceipt-portfolio-state.json";
const DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/postgres`;
const APP_URL = "https://demo.codeceipt.test";
const web = fileURLToPath(new URL("../../../apps/web", import.meta.url));
const dbPackage = fileURLToPath(new URL("../../db", import.meta.url));
const DAY = 86_400_000;

const run = (cmd, args, opts) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 64 << 20, ...opts }, (err, stdout, stderr) =>
      err
        ? reject(new Error(`${cmd} ${args.join(" ")} failed:\n${stdout}\n${stderr}`))
        : resolve(stdout),
    ),
  );

const pg = await PGlite.create();
const dbServer = new PGLiteSocketServer({
  db: pg,
  port: DB_PORT,
  host: "127.0.0.1",
  maxConnections: 20,
});
// PGlite has one session; the socket server's queue keeps a client's messages together only inside a transaction.
// postgres.js sends Parse/Bind/Execute ... Sync outside one too, so a client keeps the database until its Sync (or a
// simple Query), or two connections' statements would interleave.
const queue = dbServer.queryQueue;
const ENDS = new Set([0x53, 0x51, 0x58]); // Sync, Query, Terminate
const OPENS = new Set([0x50, 0x42, 0x44, 0x45, 0x43, 0x48]); // Parse, Bind, Describe, Execute, Close, Flush
queue.owner = null;
queue.processQueue = async function processQueue() {
  if (this.processing || this.queue.length === 0) return;
  this.processing = true;
  while (this.queue.length > 0) {
    const owner = this.db.isInTransaction() ? this.lastHandlerId : this.owner;
    const at = owner == null ? 0 : this.queue.findIndex((j) => j.handlerId === owner);
    if (at === -1) break;
    const job = this.queue.splice(at, 1)[0];
    try {
      await this.db.runExclusive(() =>
        this.db.execProtocolRawStream(job.message, { onRawData: (d) => job.onData(d) }),
      );
    } catch (err) {
      this.owner = null;
      job.reject(err);
      continue;
    }
    const type = job.message[0];
    if (ENDS.has(type)) this.owner = null;
    else if (OPENS.has(type)) this.owner = job.handlerId;
    this.lastHandlerId = job.handlerId;
    job.resolve(0);
  }
  this.processing = false;
};
const clearFor = queue.clearQueueForHandler.bind(queue);
queue.clearQueueForHandler = (handlerId) => {
  if (queue.owner === handlerId) queue.owner = null;
  clearFor(handlerId);
  setImmediate(() => queue.processQueue());
};
await dbServer.start();
await run(process.execPath, ["src/migrate.mjs"], {
  cwd: dbPackage,
  env: { ...process.env, DATABASE_URL },
});

const sql = postgres(DATABASE_URL, { max: 2, prepare: false, onnotice: () => {} });
const id = () => randomUUID();
const ago = (days, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 12, 0, 0);
  return d;
};

// The demo person and their session (signed the way better-auth signs its session cookie, as the e2e test does).
const secret = randomBytes(32).toString("hex");
const userId = id();
await sql`insert into "user" (id, name, email, "emailVerified") values (${userId}, ${"Maya Demo"}, ${"maya@example.com"}, true)`;
const sessionToken = randomBytes(24).toString("base64url");
await sql`insert into "session" (id, "userId", token, "expiresAt") values (${id()}, ${userId}, ${sessionToken}, ${new Date(Date.now() + DAY)})`;
const signature = createHmac("sha256", secret).update(sessionToken).digest("base64");
const cookieValue = `${sessionToken}.${signature}`;

const projectId = id();
await sql`insert into projects (id, owner_id, name, created_at) values (${projectId}, ${userId}, ${"salon-booking"}, ${ago(9)})`;
const projectToken = `pb_${randomBytes(24).toString("base64url")}`;
await sql`insert into project_tokens (id, project_id, hash, label) values (${id()}, ${projectId}, ${createHash("sha256").update(projectToken).digest("hex")}, ${"demo laptop"})`;

// Features and the files the index placed in them.
const FEATURES = [
  [
    "Booking calendar",
    "@booking",
    "Clients pick a stylist and a free slot.",
    "done",
    [
      "app/booking/page.tsx",
      "app/booking/slot-picker.tsx",
      "lib/availability.ts",
      "tests/booking.test.ts",
    ],
  ],
  [
    "Appointment reminders",
    "@reminders",
    "Email the client the day before.",
    "in_progress",
    ["app/api/reminders/route.ts", "lib/email.ts", "tests/reminders.test.ts"],
  ],
  [
    "Online cancellation",
    "@cancel",
    "Clients cancel up to 24 hours before.",
    "in_progress",
    ["app/booking/[id]/cancel/page.tsx", "lib/cancel-policy.ts"],
  ],
  [
    "Payments and deposits",
    "@payments",
    "Stripe checkout with a deposit for new clients.",
    "in_progress",
    [
      "app/booking/checkout/page.tsx",
      "app/api/stripe/webhook/route.ts",
      "lib/stripe.ts",
      "tests/checkout.test.ts",
    ],
  ],
  [
    "Staff schedule",
    "@staff",
    "The owner sets each stylist's hours.",
    "todo",
    ["app/admin/staff/page.tsx", "lib/schedule.ts"],
  ],
];
const featureIds = {};
for (const [n, [name, key, description, status, files]] of FEATURES.entries()) {
  const fid = id();
  featureIds[key] = fid;
  await sql`insert into features (id, project_id, name, key, description, status, build_order, created_at) values (${fid}, ${projectId}, ${name}, ${key}, ${description}, ${status}, ${n + 1}, ${ago(9)})`;
  for (const path of files) {
    const fileId = id();
    await sql`insert into files (id, project_id, path, hash, created_at) values (${fileId}, ${projectId}, ${path}, ${createHash("sha256").update(path).digest("hex")}, ${ago(9)})`;
    await sql`insert into feature_files (feature_id, file_id, project_id, role, placed_by) values (${fid}, ${fileId}, ${projectId}, ${"primary"}, ${"auto"})`;
  }
}
for (const path of ["package.json", "supabase/migrations/0001_bookings.sql", "app/layout.tsx"]) {
  await sql`insert into files (id, project_id, path, hash, created_at) values (${id()}, ${projectId}, ${path}, ${createHash("sha256").update(path).digest("hex")}, ${ago(9)})`;
}
// Supabase tables from the migrations reader: one with row level security off.
for (const [name, rls] of [
  ["bookings", true],
  ["stylists", true],
  ["deposits", false],
]) {
  await sql`insert into db_tables (id, project_id, name, schema, rls_enabled, rls_unknown, path) values (${id()}, ${projectId}, ${name}, ${"public"}, ${rls}, false, ${"supabase/migrations/0001_bookings.sql"})`;
}

const ev = (path, added, removed, symbols, where) => ({
  path,
  in_scope: true,
  summary: {
    path,
    added,
    removed,
    comment_only: false,
    imports_changed: true,
    symbols_added: symbols,
    symbols_removed: [],
    symbols_changed: [],
    where,
  },
});

// One receipt: its request, its checklist items (stored statuses) and the summary as the server stores it.
async function receipt({ daysAgo, hour, feature, asked, items, summary, sessionId }) {
  const requestId = id();
  const at = ago(daysAgo, hour);
  await sql`insert into requests (id, project_id, feature_id, text, created_at, session_id) values (${requestId}, ${projectId}, ${featureIds[feature]}, ${asked}, ${at}, ${sessionId ?? null})`;
  const stored = [];
  for (const [n, item] of items.entries()) {
    const itemId = id();
    const status =
      item.status === "question"
        ? "open"
        : item.status === "done_untested"
          ? "done_untested"
          : item.status;
    await sql`insert into checklist_items (id, request_id, project_id, text, status, needs_clarification, position) values (${itemId}, ${requestId}, ${projectId}, ${item.text}, ${status}, ${item.status === "question"}, ${n})`;
    stored.push({
      id: itemId,
      text: item.text,
      status: item.status,
      evidence: item.evidence ?? [],
    });
  }
  await sql`insert into receipts (id, project_id, request_id, commit_sha, summary_json, created_at) values (${id()}, ${projectId}, ${requestId}, ${randomBytes(20).toString("hex")}, ${sql.json({ items: stored, llm_calls: 1, not_verified: [], new_dependencies: [], new_dependencies_omitted: 0, findings: [], findings_omitted: 0, test_integrity: null, ...summary })}, ${at})`;
}

await receipt({
  daysAgo: 6,
  hour: 9,
  feature: "@booking",
  asked: "Add a booking calendar where clients pick a stylist and a free time slot",
  items: [
    {
      text: "Clients pick a stylist and see only that stylist's free slots",
      status: "done",
      evidence: ["app/booking/slot-picker.tsx", "lib/availability.ts"],
    },
    {
      text: "Booked slots disappear for everyone else",
      status: "done",
      evidence: ["lib/availability.ts", "tests/booking.test.ts"],
    },
  ],
  summary: {
    files_by_feature: [
      {
        feature: "Booking calendar",
        files: [
          "app/booking/page.tsx",
          "app/booking/slot-picker.tsx",
          "lib/availability.ts",
          "tests/booking.test.ts",
        ],
      },
    ],
    outside_scope: [],
    test_integrity: { flags: [], passing_before: 31, passing_after: 36 },
  },
});
await receipt({
  daysAgo: 4,
  hour: 14,
  feature: "@reminders",
  asked: "Send clients a reminder email the day before their appointment",
  items: [
    {
      text: "A daily job emails every client booked for tomorrow",
      status: "done",
      evidence: ["app/api/reminders/route.ts", "tests/reminders.test.ts"],
    },
    {
      text: "The email has the time, the stylist and a cancel link",
      status: "partial",
      evidence: ["lib/email.ts"],
    },
    {
      text: "Which email provider should the reminders use: Resend or Postmark?",
      status: "question",
    },
  ],
  summary: {
    files_by_feature: [
      {
        feature: "Appointment reminders",
        files: ["app/api/reminders/route.ts", "lib/email.ts", "tests/reminders.test.ts"],
      },
    ],
    outside_scope: [],
    test_integrity: { flags: [], passing_before: 36, passing_after: 39 },
  },
});
await receipt({
  daysAgo: 2,
  hour: 11,
  feature: "@cancel",
  asked: "Let clients cancel online up to 24 hours before the appointment",
  items: [
    {
      text: "A cancel page for each booking",
      status: "done_untested",
      evidence: ["app/booking/[id]/cancel/page.tsx"],
    },
    {
      text: "Cancelling less than 24 hours before is refused with a clear message",
      status: "missed",
    },
  ],
  summary: {
    files_by_feature: [
      {
        feature: "Online cancellation",
        files: ["app/booking/[id]/cancel/page.tsx", "lib/cancel-policy.ts"],
      },
    ],
    outside_scope: [],
    not_verified: [],
    test_integrity: { flags: [], passing_before: 39, passing_after: 39 },
  },
});
// The newest receipt shows every state: done, done with no test, missed, postponed, a question, a file outside the
// request, a masked secret, a skipped test and a new dependency with its check.
const CHECKOUT_FILES = [
  "app/booking/checkout/page.tsx",
  "app/api/stripe/webhook/route.ts",
  "lib/stripe.ts",
  "tests/checkout.test.ts",
  "tests/booking.test.ts",
  "package.json",
];
await receipt({
  daysAgo: 0,
  hour: 8,
  feature: "@payments",
  sessionId: "demo-session-checkout",
  asked: "Add online payments with Stripe: new clients pay a 20% deposit when they book",
  items: [
    {
      text: "Checkout takes a 20% deposit from new clients",
      status: "done",
      evidence: ["app/booking/checkout/page.tsx", "tests/checkout.test.ts"],
    },
    {
      text: "The Stripe webhook marks the booking as paid",
      status: "done_untested",
      evidence: ["app/api/stripe/webhook/route.ts"],
    },
    { text: "Refund the deposit when the salon cancels", status: "missed" },
    { text: "Show deposits on the owner's dashboard", status: "postponed" },
    { text: "Should returning clients pay a deposit too?", status: "question" },
  ],
  summary: {
    files_by_feature: [
      { feature: "Payments and deposits", files: CHECKOUT_FILES.slice(0, 4) },
      { feature: "Booking calendar", files: ["tests/booking.test.ts"] },
      { feature: "Staff schedule", files: ["app/admin/staff/page.tsx"] },
      { feature: "(no feature)", files: ["package.json"] },
    ],
    outside_scope: ["app/admin/staff/page.tsx"],
    findings: [
      {
        type: "stripe_secret_key",
        file: "lib/stripe.ts",
        line: 4,
        masked_value: "sk_l***",
        hint: "Move the key to an environment variable and rotate it in the Stripe dashboard.",
      },
    ],
    test_integrity: {
      flags: [
        {
          kind: "skipped_tests",
          file: "tests/booking.test.ts",
          names: ["refuses a booking in a slot that is already taken"],
          count: 1,
        },
      ],
      passing_before: 39,
      passing_after: 41,
    },
    new_dependencies: [
      {
        name: "stripe",
        range: "^17.4.0",
        path: "package.json",
        check: { recommendation: "ok_to_install" },
        note: "Official Stripe library, MIT, published since 2011",
      },
    ],
    evidence: [
      ev("app/booking/checkout/page.tsx", 84, 0, ["CheckoutPage", "depositFor"], ["new file"]),
      ev("app/api/stripe/webhook/route.ts", 46, 0, ["POST"], ["new file"]),
      ev("lib/stripe.ts", 12, 0, ["stripe"], ["new file"]),
      ev("tests/checkout.test.ts", 38, 0, [], ["new file"]),
      {
        ...ev("tests/booking.test.ts", 1, 1, [], ['describe "booking"']),
        summary: {
          ...ev("tests/booking.test.ts", 1, 1, [], []).summary,
          imports_changed: false,
          symbols_changed: [],
          where: ['describe "booking"'],
        },
      },
      { ...ev("app/admin/staff/page.tsx", 3, 1, [], ["StaffPage"]), in_scope: false },
      ev("package.json", 1, 0, [], ["dependencies"]),
    ],
  },
});
await sql.end();

// The production app (built beforehand with `next build`), with placeholder service settings: no service is called.
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();
const app = spawn("pnpm", ["exec", "next", "start", "-p", String(APP_PORT)], {
  cwd: web,
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    DATABASE_URL,
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: APP_URL,
    GITHUB_CLIENT_ID: "demo",
    GITHUB_CLIENT_SECRET: "demo",
    GITHUB_APP_ID: "0",
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_WEBHOOK_SECRET: "demo",
    ANTHROPIC_API_KEY: "demo",
    INNGEST_EVENT_KEY: "demo",
    INNGEST_SIGNING_KEY: "demo",
  },
  stdio: ["ignore", "inherit", "inherit"],
});
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${APP_PORT}/api/health`)).status < 500) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
writeFileSync(
  STATE_FILE,
  JSON.stringify({ appPort: APP_PORT, projectId, cookieValue, projectToken }),
  { mode: 0o600 },
);
console.log(`[portfolio] demo app ready on http://localhost:${APP_PORT}`);
const stop = async () => {
  app.kill("SIGTERM");
  await dbServer.stop();
  await pg.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
