import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readFixture } from "./sandbox.testing";

// T7 attacker tests: migrations run as a superuser in the sandbox (as the non-superuser "postgres" in Supabase), so
// each fixture tries to get past the catalog guard and fake "RLS enabled" or a safe policy. Every one must end with
// the table unknown, never enabled.
const here = dirname(fileURLToPath(import.meta.url));
const SANDBOX = resolve(here, "../../../../tests/fixtures/supabase/sandbox");
const read = (fixture: string) => readFixture(resolve(SANDBOX, fixture));
const exposed = async (fixture: string) => {
  const t = (await read(fixture)).tables.find((x) => x.schema === "public" && x.name === "exposed");
  return t && [t.rlsEnabled, t.rlsUnknown];
};
const UNKNOWN = [false, true];

describe("@brain/core supabase sandbox: superuser attacks on the catalog guard (T7)", () => {
  it.each([
    ["guard_replica", "SET session_replication_role = replica, then catalog DML"],
    ["guard_replica_caught", "replica mode and catalog DML with the refusal swallowed"],
    ["guard_disable_all", "ALTER TABLE pg_class DISABLE TRIGGER ALL, then re-enabled"],
    ["guard_disable_user", "ALTER TABLE pg_class DISABLE TRIGGER USER, then re-enabled"],
    ["guard_enable_origin", "guard demoted from ALWAYS to ORIGIN, replica write, restored"],
    ["guard_drop_trigger", "DROP TRIGGER, catalog DML, trigger recreated"],
    ["guard_replace_function", "CREATE OR REPLACE of the guard function, then put back"],
    ["guard_pg_trigger", "direct UPDATE of pg_trigger.tgenabled, refusals swallowed"],
    ["guard_pg_proc", "direct UPDATE of the guard's pg_proc.prosrc, refusals swallowed"],
    ["guard_security_definer", "SECURITY DEFINER function with replica mode, called as anon"],
    ["guard_roles", "SET/RESET ROLE and SET SESSION AUTHORIZATION, session left as anon"],
  ])("%s: %s leaves the table unknown, never enabled", async (fixture) => {
    expect(await exposed(fixture)).toEqual(UNKNOWN);
  });

  it("TRUNCATE pg_policy (no row triggers) cannot hide a USING (true) policy behind RLS enabled", async () => {
    expect(await exposed("guard_truncate")).toEqual(UNKNOWN);
  });

  it("temp relations named pg_class / pg_policy / pg_roles do not shadow the final catalog read", async () => {
    const result = await read("guard_temp_shadow");
    expect(await exposed("guard_temp_shadow")).toEqual([false, false]);
    expect(result.policies.map((p) => [p.table, p.name, p.roles, p.using])).toEqual([
      ["open", "everyone", ["anon"], "true"],
    ]);
  });

  it("renaming anon to service_role cannot make an anon policy look like a service_role one", async () => {
    expect(await exposed("guard_role_rename")).toEqual(UNKNOWN);
  });
});
