import { filesRepo, projectsRepo, symbolsRepo } from "@brain/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSimilarComponents } from "./components";
import { type TestWorld, createTestWorld } from "./test-helpers";

const COMPONENTS = 2_000;
const RUNS = 40;
const WORDS = [
  "User",
  "Profile",
  "Order",
  "Invoice",
  "Chart",
  "Table",
  "Modal",
  "Menu",
  "Nav",
  "Search",
];
const KINDS = ["Card", "List", "Form", "Header", "Panel", "Dialog", "Row", "Badge"];

describe("FEAT-007 findSimilarComponents", () => {
  let world: TestWorld;
  let projectId: string;
  let otherProjectId: string;

  beforeAll(async () => {
    world = await createTestWorld();
    const user = await world.createUser();
    projectId = (await projectsRepo.create(world.db, user.id, { name: "big" })).id;
    otherProjectId = (await projectsRepo.create(world.db, user.id, { name: "other" })).id;
    const rows = [];
    for (let i = 0; i < COMPONENTS; i++) {
      const name = `${WORDS[i % WORDS.length]}${KINDS[i % KINDS.length]}V${i}`;
      const file = await filesRepo.insert(world.db, projectId, {
        path: `src/components/f${i % 50}/${name}.tsx`,
        hash: `h${i}`,
      });
      rows.push({
        fileId: file.id,
        kind: "component",
        name,
        signature: "({ id, title }) => JSX",
        summary: null,
        hash: `c${i}`,
      });
    }
    const star = await filesRepo.insert(world.db, projectId, {
      path: "src/components/reviews/StarRating.tsx",
      hash: "star",
    });
    rows.push({
      fileId: star.id,
      kind: "component",
      name: "StarRating",
      signature: null,
      summary: null,
      hash: "s",
    });
    await symbolsRepo.insertMany(world.db, projectId, rows);
    const otherFile = await filesRepo.insert(world.db, otherProjectId, {
      path: "src/StarRatingInput.tsx",
      hash: "o",
    });
    await symbolsRepo.insertMany(world.db, otherProjectId, [
      {
        fileId: otherFile.id,
        kind: "component",
        name: "StarRatingInput",
        signature: null,
        summary: null,
        hash: "o",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await world.teardown();
  });

  it("AC-007-05 answers in under 200 ms p95 for a project with 2,000 components", async () => {
    const ms: number[] = [];
    const tops = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      // Alternate a rare query with a common one ("User", "Card" each match hundreds of names).
      const query = i % 2 === 0 ? "StarRatingInput" : "UserCardEditor";
      const started = performance.now();
      const matches = await findSimilarComponents(world.db, projectId, query);
      ms.push(performance.now() - started);
      tops.add(`${query}->${matches[0]?.name ?? ""}`);
    }
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.ceil(RUNS * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    console.log(
      `AC-007-05 findSimilarComponents p95 ${p95.toFixed(1)} ms over ${RUNS} runs, ${COMPONENTS + 1} components`,
    );
    expect([...tops].sort()).toEqual(["StarRatingInput->StarRating", "UserCardEditor->UserCardV0"]);
    expect(p95).toBeLessThan(200);
  });

  it("AC-007-05 only searches the given project's components", async () => {
    const matches = await findSimilarComponents(world.db, otherProjectId, "StarRating");
    expect(matches.map((m) => m.name)).toEqual(["StarRatingInput"]);
  });
});
