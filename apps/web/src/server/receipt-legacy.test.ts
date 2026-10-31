import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import { projectsRepo, receiptsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Edutech after PR #22: receipts stored before the latest changes rendered empty bullet points. A stored receipt in
// an older or partial shape renders every entry with its text, and never an entry without one.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let projectId: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  setSessionResolver(async () => owner);
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "edutech" })).id;
});
afterEach(async () => {
  setSessionResolver(null);
  vi.restoreAllMocks();
  await world.teardown();
});

const render = async () =>
  renderToStaticMarkup(
    (await ReceiptsPage({
      params: Promise.resolve({ id: projectId }),
      searchParams: Promise.resolve({}),
    })) as ReactElement,
  );
// The visible text of every list entry on the page.
const entries = (html: string) =>
  [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
    (m[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ")
      .trim(),
  );

describe("older receipt shapes", () => {
  it("a stored receipt in the old format renders its files, items and checks, with no empty entries", async () => {
    // As stored before the latest changes: string entries in lists, camelCase keys from an early build, a group
    // without a feature name, items and findings with missing fields.
    await receiptsRepo.insert(world.db, projectId, {
      summaryJson: {
        items: [
          { id: "a", text: "Show the course list", status: "done", evidence: ["src/app/page.tsx"] },
          { id: "b", status: "missed", evidence: [] },
          "Add a comment at the top of the main page",
          { id: "c", text: "\u200b", status: "partial" },
        ],
        filesByFeature: [{ files: ["src/app/page.tsx"] }, { feature: "home", files: [] }],
        outsideScope: ["prisma/schema.prisma", ""],
        notVerified: ["Add a star rating", { reason: "no file evidence" }],
        findings: [{ file: "db_dump.json" }, { type: "rls_disabled", hint: "Enable RLS" }],
        test_integrity: { flags: [{ kind: "deleted_tests", names: [], count: 1 }] },
      },
    });
    const html = await render();
    const list = entries(html);
    expect(
      list.filter((e) => e === "" || (/^(✓|✕|◐|\?|!|•)?\s*\S*\s*$/.test(e) && !/\w{3,}/.test(e))),
    ).toEqual([]);
    expect(list.some((e) => e.includes("(no feature): src/app/page.tsx"))).toBe(true);
    expect(list.some((e) => e.includes("Done Show the course list"))).toBe(true);
    // A plain-text item has no stored verdict: not verified, never called missed or done.
    expect(
      list.some((e) => e.includes("Not verified Add a comment at the top of the main page")),
    ).toBe(true);
    expect(list.some((e) => e.includes("Not verified Add a star rating"))).toBe(true);
    expect(html).toContain("prisma/schema.prisma");
    // Entries with no text at all are left out, never shown as an empty bullet.
    expect(html).not.toContain('<code class="wrap"></code>');
  });
});
