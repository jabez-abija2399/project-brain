// FEAT-015 security pass (independent review): attacker and realistic-input tests for the secret detector and the
// RLS flags. Fake secrets are built at runtime from chunks under 10 characters (never secret-shaped literals).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { maskSecretsIn } from "./mask";
import { rlsFindings, secretFinding } from "./receipt-findings";
import { scanSecrets } from "./secrets";
import { policyAllowsAll, rlsFlags } from "./supabase/flags";
import { readSupabaseMigrations } from "./supabase/reader";
import { testSandbox } from "./supabase/sandbox.testing";

const chunk = "aB3dE5gH7j";
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sig = () => [chunk, chunk, chunk, chunk].join("");
const jwt = (payload: object, header: object = { alg: "HS256", typ: "JWT" }) =>
  [b64url(header), b64url(payload), sig()].join(".");
const serviceRole = (extra: object = {}) =>
  jwt({ iss: "supabase", ref: "abcdefghijklmnop", role: "service_role", ...extra });
const anonKey = () => jwt({ iss: "supabase", ref: "abcdefghijklmnop", role: "anon" });
const sbSecret = () => ["sb_", "secret_", chunk, chunk, "_x9Kq2"].join("");
const sbPublishable = () => ["sb_", "publish", "able_", chunk, chunk, "_x9Kq2"].join("");
const stripeLive = () => ["sk", "_live_", chunk, chunk].join("");
const stripePk = () => ["pk", "_live_", chunk, chunk].join("");
const pemHead = () => ["-----", "BEGIN ", "PRIVATE", " KEY-----"].join("");
const pemTail = () => ["-----", "END ", "PRIVATE", " KEY-----"].join("");

describe("FEAT-015 secret detector: realistic formats (security pass)", () => {
  it("AC-015-01 attack: keys inside URLs, JSON, CRLF files with a BOM and other JWT header orders are flagged on the right line", () => {
    const role = serviceRole();
    const reordered = jwt(
      { role: "service_role", iss: "supabase", ref: "zyxwvutsrqponmlk" },
      { typ: "JWT", alg: "HS256", kid: "k1" },
    );
    const text = [
      "﻿// config",
      `fetch(\`https://abc.supabase.co/rest/v1/todos?apikey=${role}\`);`,
      `{"serviceRoleKey":"${reordered}"}`,
      `const k = '${sbSecret()}';`,
      `headers: { Authorization: "Bearer ${role}" }`,
    ].join("\r\n");
    const found = scanSecrets("src/lib/client.ts", text);
    expect(found.map((f) => [f.line, f.type, f.masked_value])).toEqual([
      [2, "supabase_service_role_key", "eyJh***"],
      [3, "supabase_service_role_key", "eyJ0***"],
      [4, "supabase_secret_key", "sb_s***"],
      [5, "supabase_service_role_key", "eyJh***"],
    ]);
    expect(JSON.stringify(found)).not.toContain(sig());
  });

  it("AC-015-02 attack: the anon key, publishable keys, env references and template variables are never flagged", () => {
    const text = [
      `const supabase = createClient(url, "${anonKey()}");`,
      `const pub = "${sbPublishable()}";`,
      `const stripe = loadStripe("${stripePk()}");`,
      "const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);",
      "const k = '${SUPABASE_SERVICE_ROLE_KEY}';",
      "const s = import.meta.env.VITE_STRIPE_SECRET_KEY;",
    ].join("\n");
    expect(scanSecrets("src/app/page.tsx", text)).toEqual([]);
  });

  it("AC-015-05 attack: placeholder values in .env.example are not flagged ('your-key-here', xxxx, <key>, empty)", () => {
    const text = [
      "SUPABASE_SERVICE_ROLE_KEY=",
      "SUPABASE_SERVICE_ROLE_KEY=your-key-here",
      `STRIPE_SECRET_KEY=${["sk", "_live_", "x".repeat(24)].join("")}`,
      `STRIPE_SECRET_KEY=${["sk", "_live_", "your", "_key_here_", "abcdefgh"].join("")}`,
      `OPENAI_API_KEY=${["sk", "-proj-", "<your-key>"].join("")}`,
      `ANTHROPIC_API_KEY=${["sk", "-ant-", "X".repeat(30)].join("")}`,
    ].join("\n");
    expect(scanSecrets(".env.example", text)).toEqual([]);
  });

  it("AC-015-05 attack: a private-key placeholder in .env.example (BEGIN line + 'your-key-here' / '...') is not flagged", () => {
    // The usual Firebase/Google service-account placeholder: the PEM header with a placeholder body.
    const text = [
      `FIREBASE_PRIVATE_KEY="${pemHead()}\\nyour-key-here\\n${pemTail()}\\n"`,
      `GOOGLE_PRIVATE_KEY="${pemHead()}\\n...\\n${pemTail()}"`,
    ].join("\n");
    expect(scanSecrets(".env.example", text)).toEqual([]);
  });

  it("AC-015-01 attack: a real private key in .env.example is still flagged (the placeholder rule must not hide it)", () => {
    const body = ["MIIEvQIBA", "DANBgkqhk", "iG9w0BAQE", "FAASCBKcw"].join("");
    const text = `FIREBASE_PRIVATE_KEY="${pemHead()}\\n${body}\\n${pemTail()}\\n"`;
    expect(scanSecrets(".env.example", text).map((f) => f.type)).toEqual(["private_key"]);
  });

  it("AC-015-03 attack: the masked value never carries more than the first 4 characters of the secret", () => {
    const text = [serviceRole(), sbSecret(), stripeLive()].map((k) => `x("${k}")`).join("\n");
    for (const f of scanSecrets("src/a.ts", text)) {
      expect(f.masked_value).toMatch(/^.{1,4}\*\*\*$/);
    }
  });

  it("AC-015-03 attack: a Supabase secret key the detector flags is masked when it shows up in a finding's path or a logged text (sb_secret_ has no mask pattern)", () => {
    // The shortest sb_secret_ value the detector flags: prefix + 20 characters (30 in all, below LONG_RANDOM's 32).
    const short = ["sb_", "secret_", chunk, chunk].join("");
    expect(scanSecrets("src/a.ts", `k("${short}")`)).toHaveLength(1);
    const finding = secretFinding({
      file: `src/${short}.ts`,
      line: 1,
      type: "supabase_secret_key",
      masked_value: "sb_s***",
    });
    expect(finding.file).not.toContain(short.slice(0, 12));
    expect(maskSecretsIn(`key ${short} leaked`)).not.toContain(short.slice(0, 12));
  });
});

describe("FEAT-015 RLS flags (security pass)", () => {
  const p = (over: Partial<Parameters<typeof policyAllowsAll>[0]>) => ({
    command: "UPDATE" as const,
    roles: ["anon"],
    permissive: true,
    using: "true",
    withCheck: null,
    ...over,
  });

  it("AC-015-07 attack: restrictive policies never allow everyone, for any command, role or clause", () => {
    for (const command of ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
      for (const roles of [["public"], ["anon"], ["authenticated"], ["PUBLIC"]]) {
        expect(
          policyAllowsAll(
            p({ command, roles, permissive: false, using: "true", withCheck: "true" }),
          ),
        ).toBe(false);
      }
    }
  });

  it("AC-015-04 attack: anon, authenticated and public (any case) count as everyone; service_role and custom roles do not", () => {
    expect(policyAllowsAll(p({ roles: ["Authenticated"] }))).toBe(true);
    expect(policyAllowsAll(p({ roles: ["service_role", "public"] }))).toBe(true);
    expect(policyAllowsAll(p({ roles: ["service_role"] }))).toBe(false);
    expect(policyAllowsAll(p({ roles: ["admin_role"] }))).toBe(false);
    expect(policyAllowsAll(p({ command: "INSERT", using: null, withCheck: "(true)" }))).toBe(true);
    expect(policyAllowsAll(p({ command: "DELETE", using: " ( TRUE ) " }))).toBe(true);
  });

  it("AC-015-04 attack: USING (true) written with an SQL comment inside the clause still allows everyone", () => {
    // The reader keeps the clause as written in the migration (comments included) when it can.
    expect(policyAllowsAll(p({ using: "true -- TODO: lock this down\n" }))).toBe(true);
    expect(policyAllowsAll(p({ using: "/* anyone */ true" }))).toBe(true);
    expect(
      policyAllowsAll(p({ command: "INSERT", using: null, withCheck: "true -- open for now\n" })),
    ).toBe(true);
  });

  it("AC-015-04 attack: end to end, a migration whose USING (true) carries a comment is flagged as open to everyone", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pb-sec-rls-")), "migrations");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "0001_init.sql"),
      [
        "create table public.todos (id uuid primary key, owner uuid);",
        "alter table public.todos enable row level security;",
        'create policy "anyone updates" on public.todos for update to anon using (',
        "  true -- TODO: restrict to the owner",
        ");",
        "create table public.notes (id uuid primary key);",
        "alter table public.notes enable row level security;",
        'create policy "anyone inserts" on public.notes for insert to authenticated with check (/* open */ true);',
        "",
      ].join("\n"),
    );
    const result = await readSupabaseMigrations(dir, testSandbox);
    const flags = rlsFlags(result);
    const stored = flags.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      path: t.file,
      rlsEnabled: t.rlsEnabled,
      rlsUnknown: t.rlsUnknown,
      policies: flags.policies.filter((x) => x.table === t.name && x.schema === t.schema),
    }));
    expect(rlsFindings(stored).map((f) => [f.type, f.table])).toEqual([
      ["policy_allows_everyone_to_write", "public.notes"],
      ["policy_allows_everyone_to_write", "public.todos"],
    ]);
  });

  it("AC-015-06 attack: a table flagged unknown is reported as 'RLS cannot be confirmed' even if its stored flags also claim RLS on", () => {
    const findings = rlsFindings([
      {
        schema: "public",
        name: "orders",
        path: "supabase/migrations/0001.sql",
        rlsEnabled: true,
        rlsUnknown: true,
        policies: [],
      },
      {
        schema: "public",
        name: "items",
        path: "supabase/migrations/0001.sql",
        rlsEnabled: false,
        rlsUnknown: true,
        policies: [{ command: "SELECT", permissive: true, allowsAll: false }],
      },
    ]);
    expect(findings.map((f) => [f.type, f.table])).toEqual([
      ["rls_cannot_be_confirmed", "public.orders"],
      ["rls_cannot_be_confirmed", "public.items"],
    ]);
  });
});
