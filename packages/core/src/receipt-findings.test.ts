import { describe, expect, it } from "vitest";
import { type StoredTable, rlsFindings, secretFinding } from "./receipt-findings";

const table = (name: string, over: Partial<StoredTable> = {}): StoredTable => ({
  schema: "public",
  name,
  path: "supabase/migrations/0001_init.sql",
  rlsEnabled: true,
  rlsUnknown: false,
  policies: [],
  ...over,
});
const p = (command: string, allowsAll: boolean, permissive = true) => ({
  command,
  permissive,
  allowsAll,
});

describe("receipt findings (FEAT-015)", () => {
  it("AC-015-04 RLS off and policies that let everyone write are flagged with file and a fix hint; owner-only and public read are not", () => {
    const findings = rlsFindings([
      table("profiles", { rlsEnabled: false }),
      table("posts", { policies: [p("UPDATE", true), p("INSERT", true), p("SELECT", true)] }),
      table("comments", { policies: [p("SELECT", true), p("UPDATE", false)] }),
    ]);
    expect(findings.map((f) => [f.type, f.table, f.file, f.line])).toEqual([
      ["rls_disabled", "public.profiles", "supabase/migrations/0001_init.sql", null],
      [
        "policy_allows_everyone_to_write",
        "public.posts",
        "supabase/migrations/0001_init.sql",
        null,
      ],
    ]);
    expect(findings[1]?.hint).toContain("UPDATE/INSERT");
    expect(findings[0]?.hint).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("AC-015-06 a table whose RLS state is unknown is reported as 'RLS cannot be confirmed', even if its stored flags say enabled", () => {
    const findings = rlsFindings([
      table("orders", { rlsUnknown: true, rlsEnabled: false }),
      table("invoices", { rlsUnknown: true, rlsEnabled: true }),
    ]);
    expect(findings.map((f) => [f.type, f.table])).toEqual([
      ["rls_cannot_be_confirmed", "public.orders"],
      ["rls_cannot_be_confirmed", "public.invoices"],
    ]);
    expect(findings[0]?.hint).toMatch(/^RLS cannot be confirmed/);
  });

  it("AC-015-07 a restrictive policy is never counted as allowing everyone, even if stored with allowsAll", () => {
    expect(
      rlsFindings([
        table("posts", { policies: [p("UPDATE", true, false), p("ALL", true, false)] }),
      ]),
    ).toEqual([]);
  });

  it("AC-015-03 attack: control characters and secret-shaped text in table names and paths are cleaned and masked", () => {
    const key = ["sk", "_live_", "aB3dE5gH7j", "aB3dE5gH7j"].join("");
    const [f] = rlsFindings([
      table(`evil‮\nname_${key}`, { rlsEnabled: false, path: `supabase/migrations/${key}.sql` }),
    ]);
    expect(JSON.stringify(f)).not.toContain(key);
    expect(f?.table).not.toMatch(/[\n‮]/);
    const s = secretFinding({
      file: "src/a.ts",
      line: 3,
      type: "openai_api_key",
      masked_value: "sk-p***",
    });
    expect(s).toMatchObject({ file: "src/a.ts", line: 3, masked_value: "sk-p***" });
    expect(s.hint).toContain("Rotate");
  });
});
