// Roadmap Phase 4c: every receipt is checked against the Blueprint's active boundaries (protected paths, disallowed
// packages, the allowed list). Deterministic; never fails a receipt; only this project's owner-approved boundaries.
import type { Llm } from "@brain/core";
import { receiptView, reviewFirst } from "@brain/core";
import { boundariesRepo, projectTokensRepo, projectsRepo } from "@brain/db";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLlmForTests } from "./llm";
import { resetMigrationCheckForTests } from "./migration-check";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let pid: string;
let other: string;
let token: { id: string; projectId: string };

const boundary = (
  projectId: string,
  kind: "protected_path" | "disallowed_dependency",
  pattern: string,
  status = "active",
) =>
  boundariesRepo.insert(world.db, projectId, {
    kind,
    pattern,
    note: null,
    createdBy: status === "active" ? "owner" : "agent",
    status: status as "active" | "proposal",
  });
const receipt = (changedFiles: string[]) =>
  generateReceipt(world.db, token, { projectId: pid, changedFiles });

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  other = (await projectsRepo.create(world.db, owner.id, { name: "other" })).id;
  token = (await projectTokensRepo.create(world.db, pid)).row;
  setLlmForTests({ complete: async () => "" } satisfies Llm);
});
afterEach(async () => {
  setLlmForTests(null);
  resetMigrationCheckForTests();
  await world.teardown();
});

describe("Phase 4c: receipts checked against the Blueprint", () => {
  it("PH4C-04 a changed file under a protected path is on the receipt and first in Review here first", async () => {
    await boundary(pid, "protected_path", "supabase/migrations/**");
    const r = await receipt(["supabase/migrations/02_rls.sql", "src/app/page.tsx"]);
    expect(r.boundary_hits).toEqual([
      {
        kind: "protected_path",
        subject: "supabase/migrations/02_rls.sql",
        pattern: "supabase/migrations/**",
      },
    ]);
    const view = receiptView(r);
    expect(reviewFirst(view)[0]).toEqual({
      where: "supabase/migrations/02_rls.sql",
      why: "changed a path the owner protected",
    });
  });

  it("PH4C-05 attack: proposals and another project's boundaries are never used; no boundaries, no field", async () => {
    await boundary(pid, "protected_path", "src/**", "proposal");
    await boundary(other, "protected_path", "src/**");
    const r = await receipt(["src/app/page.tsx"]);
    expect(r).not.toHaveProperty("boundary_hits");
  });

  it("PH4C-06 before migration 0054, receipts are made exactly as before", async () => {
    await boundary(pid, "protected_path", "src/**");
    await world.db.execute(sql`DELETE FROM "_brain_migrations" WHERE id = '0054_blueprint'`);
    resetMigrationCheckForTests();
    const r = await receipt(["src/app/page.tsx"]);
    expect(r.receipt_id).toBeTruthy();
    expect(r).not.toHaveProperty("boundary_hits");
  });
});
