import { describe, expect, it } from "vitest";
import { policyAllowsAll, rlsFlags } from "./flags";

const policy = (over: Partial<Parameters<typeof policyAllowsAll>[0]>) => ({
  command: "UPDATE" as const,
  roles: ["public"],
  permissive: true,
  using: null,
  withCheck: null,
  ...over,
});

describe("RLS flags (FEAT-015)", () => {
  it("AC-015-04 USING (true) on UPDATE/DELETE and WITH CHECK (true) on INSERT/UPDATE allow everyone", () => {
    expect(policyAllowsAll(policy({ command: "UPDATE", using: "true" }))).toBe(true);
    expect(policyAllowsAll(policy({ command: "DELETE", using: "( TRUE )" }))).toBe(true);
    expect(policyAllowsAll(policy({ command: "INSERT", withCheck: "(true)" }))).toBe(true);
    expect(
      policyAllowsAll(
        policy({ command: "UPDATE", using: "auth.uid() = owner", withCheck: "true" }),
      ),
    ).toBe(true);
    expect(policyAllowsAll(policy({ command: "ALL", roles: ["anon"], using: "1 = 1" }))).toBe(true);
    expect(policyAllowsAll(policy({ command: "UPDATE", using: "auth.uid() = owner" }))).toBe(false);
    expect(policyAllowsAll(policy({ command: "DELETE", withCheck: "true" }))).toBe(false);
    expect(policyAllowsAll(policy({ command: "INSERT", using: "true" }))).toBe(false);
    expect(
      policyAllowsAll(policy({ command: "UPDATE", roles: ["service_role"], using: "true" })),
    ).toBe(false);
  });

  it("AC-015-07 a restrictive policy never allows everyone, even with USING (true) or WITH CHECK (true)", () => {
    for (const command of ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
      expect(
        policyAllowsAll(policy({ command, permissive: false, using: "true", withCheck: "true" })),
      ).toBe(false);
    }
  });

  it("AC-015-06 a table whose RLS state is unknown is never stored as enabled, and no SQL text is in the flags", () => {
    const flags = rlsFlags({
      root: "/x",
      tables: [
        {
          schema: "public",
          name: "posts",
          file: "0001.sql",
          columns: [],
          rlsEnabled: true,
          rlsUnknown: true,
        },
      ],
      policies: [
        {
          name: "p",
          schema: "public",
          table: "posts",
          file: "0001.sql",
          command: "SELECT",
          roles: ["authenticated"],
          permissive: true,
          using: "auth.uid() = user_id",
          withCheck: null,
        },
      ],
      errors: [],
    });
    expect(flags.tables[0]).toMatchObject({ rlsEnabled: false, rlsUnknown: true });
    expect(flags.policies[0]).toEqual({
      schema: "public",
      table: "posts",
      command: "SELECT",
      permissive: true,
      allowsAll: false,
      checksOwnership: true,
    });
    expect(JSON.stringify(flags)).not.toContain("auth.uid");
  });
});
