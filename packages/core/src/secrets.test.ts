import { describe, expect, it } from "vitest";
import { scanSecrets } from "./secrets";

// Fake secrets are built at runtime from chunks under 10 characters (never secret-shaped literals).
const chunk = "aB3dE5gH7j";
const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const supabaseJwt = (role: string, iss = "supabase") =>
  [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ iss, ref: "abcdefghijklmnop", role, iat: 1700000000, exp: 2000000000 }),
    chunk.repeat(4),
  ].join(".");
const stripeLive = () => ["sk", "_live_", chunk, chunk, chunk].join("");
const anthropic = () => ["sk", "-ant-", "api03-", chunk, chunk, chunk].join("");
const pem = () => ["-----BEGIN ", "PRIVATE", " KEY-----"].join("");

describe("secret detector (FEAT-015)", () => {
  it("AC-015-01 flags a service-role key and secret API keys in a client-side file with file and line, masked", () => {
    const role = supabaseJwt("service_role");
    const text = [
      '"use client";',
      'import { createClient } from "@supabase/supabase-js";',
      `const admin = createClient(url, "${role}");`,
      `const stripe = "${stripeLive()}"; const ai = '${anthropic()}';`,
      `const key = \`${pem()}\nMIIEvQIBADANBg${chunk}${chunk}\`;`,
    ].join("\n");
    const findings = scanSecrets("src/components/Admin.tsx", text);
    expect(findings).toEqual([
      {
        file: "src/components/Admin.tsx",
        line: 3,
        type: "supabase_service_role_key",
        masked_value: "eyJh***",
      },
      {
        file: "src/components/Admin.tsx",
        line: 4,
        type: "stripe_secret_key",
        masked_value: "sk_l***",
      },
      {
        file: "src/components/Admin.tsx",
        line: 4,
        type: "anthropic_api_key",
        masked_value: "sk-a***",
      },
      { file: "src/components/Admin.tsx", line: 5, type: "private_key", masked_value: "----***" },
    ]);
  });

  it("AC-015-02 the Supabase anon key, the publishable key and the local CLI demo keys are not flagged", () => {
    const text = [
      `const supabase = createClient(url, "${supabaseJwt("anon")}");`,
      `const pub = "sb_publishable_${chunk}${chunk}";`,
      `const local = "${supabaseJwt("service_role", "supabase-demo")}";`,
    ].join("\n");
    expect(scanSecrets("src/lib/supabase.ts", text)).toEqual([]);
  });

  it("AC-015-05 empty and placeholder values in .env.example are not flagged; a real value there is; .env itself is not scanned", () => {
    const example = [
      "NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co",
      "SUPABASE_SERVICE_ROLE_KEY=",
      "STRIPE_SECRET_KEY=your-key-here",
      `STRIPE_SECRET_KEY_2=sk_live_your_key_here_${chunk}`,
      "OPENAI_API_KEY=<your openai key>",
      `ANTHROPIC_API_KEY=${["sk", "-ant-"].join("")}${"x".repeat(26)}`,
    ].join("\n");
    expect(scanSecrets(".env.example", example)).toEqual([]);
    const leaked = `SUPABASE_SERVICE_ROLE_KEY=${supabaseJwt("service_role")}`;
    expect(scanSecrets(".env.example", leaked)).toEqual([
      { file: ".env.example", line: 1, type: "supabase_service_role_key", masked_value: "eyJh***" },
    ]);
    for (const local of [".env", ".env.local", "apps/web/.env.production.local"]) {
      expect(scanSecrets(local, leaked)).toEqual([]);
    }
  });

  it("AC-015-03 attack: a finding carries no part of the secret beyond 4 characters and no part of the source line", () => {
    const secret = stripeLive();
    const line = `export const PAYMENTS_SECRET_CONFIG = { live: "${secret}" };`;
    const out = JSON.stringify(scanSecrets("src/pay.ts", `// header\r\n${line}`));
    expect(out).toContain('"line":2');
    expect(out).not.toContain(secret.slice(0, 8));
    expect(out).not.toContain("PAYMENTS_SECRET_CONFIG");
  });
});
