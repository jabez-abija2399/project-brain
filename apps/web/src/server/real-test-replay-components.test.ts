import { filesRepo, projectsRepo, symbolsRepo } from "@brain/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSimilarComponents } from "./components";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Real-test replay Q (2026-11-01): find_similar_component for "PrimaryButton" returned only PrimaryButton and missed
// src/components/ui/button.tsx, a Button with a primary variant, in a project with many other Buttons.
// Fake key built at runtime (no secret-shaped literal in the source).
const FAKE_GITHUB_TOKEN = ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "0123"].join("");

describe("Q real-test replay: find_similar_component finds the primary button", () => {
  let world: TestWorld;
  let projectId: string;

  beforeAll(async () => {
    world = await createTestWorld();
    const user = await world.createUser();
    projectId = (await projectsRepo.create(world.db, user.id, { name: "shop" })).id;
    const entries: { path: string; name: string; signature: string | null }[] = [
      { path: "src/components/PrimaryButton.tsx", name: "PrimaryButton", signature: null },
      {
        path: "src/components/ui/button.tsx",
        name: "Button",
        signature: `({ variant = "primary", children }) => JSX`,
      },
      {
        path: "src/components/ui/secret-button.tsx",
        name: "SecretButton",
        signature: `({ variant = "primary", token = "${FAKE_GITHUB_TOKEN}" }) => JSX`,
      },
    ];
    for (let i = 0; i < 30; i++) {
      entries.push({
        path: `src/components/actions/Action${i}Button.tsx`,
        name: `Action${i}Button`,
        signature: "({ label }) => JSX",
      });
    }
    const rows = [];
    for (const [i, e] of entries.entries()) {
      const file = await filesRepo.insert(world.db, projectId, { path: e.path, hash: `h${i}` });
      rows.push({
        fileId: file.id,
        kind: "component",
        name: e.name,
        signature: e.signature,
        summary: null,
        hash: `c${i}`,
      });
    }
    await symbolsRepo.insertMany(world.db, projectId, rows);
  }, 120_000);

  afterAll(async () => {
    await world.teardown();
  });

  it("the exact case: 'PrimaryButton' returns ui/button.tsx with the reason, at most 3 matches", async () => {
    const matches = await findSimilarComponents(world.db, projectId, "PrimaryButton");
    expect(matches.length).toBeLessThanOrEqual(3);
    const button = matches.find((m) => m.path === "src/components/ui/button.tsx");
    expect(button).toBeDefined();
    expect(button?.reason).toBe("name shares 'button'; props include 'primary'");
    expect(button?.score).toBeGreaterThan(0.15);
  });

  it("every match carries a reason and secrets in the stored props are masked before they leave", async () => {
    const matches = await findSimilarComponents(world.db, projectId, "PrimaryButton");
    expect(matches.every((m) => m.reason.length > 0)).toBe(true);
    const secret = matches.find((m) => m.name === "SecretButton");
    expect(secret?.signature).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(JSON.stringify(matches)).not.toContain(FAKE_GITHUB_TOKEN);
  });

  it("nothing similar returns []", async () => {
    expect(await findSimilarComponents(world.db, projectId, "ZzzUnknownThing")).toEqual([]);
  });
});
