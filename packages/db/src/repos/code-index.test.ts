import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromPglite } from "../pglite";
import { createTestDb } from "../testing";
import { codeIndexRepo, filesRepo, projectsRepo, symbolsRepo, usersRepo } from "./index";

const component = (name: string, hash: string) => ({
  kind: "component",
  name,
  signature: "() => JSX",
  summary: null,
  hash,
  summaryStatus: null,
  summaryAttempts: 0,
  summaryAttemptedAt: null,
});

describe("FEAT-008 codeIndexRepo", () => {
  let pg: Awaited<ReturnType<typeof createTestDb>>;
  let db: ReturnType<typeof fromPglite>;
  let mine: string;
  let other: string;
  beforeEach(async () => {
    pg = await createTestDb();
    db = fromPglite(pg);
    await usersRepo.upsertById(db, { id: "u1", name: "u1", email: "u1@example.com" });
    mine = (await projectsRepo.create(db, "u1", { name: "mine" })).id;
    other = (await projectsRepo.create(db, "u1", { name: "other" })).id;
  });
  afterEach(async () => {
    await pg.close();
  });

  it("AC-008-06 saveFiles replaces a file's symbols and hashes() returns only this project's stored hashes", async () => {
    await codeIndexRepo.saveFiles(db, mine, [
      { path: "src/A.tsx", hash: "a1", symbols: [component("A", "ha"), component("A2", "ha2")] },
      { path: "src/B.tsx", hash: "b1", symbols: [component("B", "hb")] },
    ]);
    await codeIndexRepo.saveFiles(db, other, [
      { path: "src/A.tsx", hash: "x1", symbols: [component("X", "hx")] },
    ]);
    await codeIndexRepo.saveFiles(db, mine, [
      { path: "src/A.tsx", hash: "a2", symbols: [component("A", "ha")] },
    ]);

    const hashes = await codeIndexRepo.hashes(db, mine, ["src/A.tsx", "src/B.tsx", "src/C.tsx"]);
    expect(Object.fromEntries(hashes)).toEqual({ "src/A.tsx": "a2", "src/B.tsx": "b1" });
    const names = async (projectId: string) =>
      (await symbolsRepo.listComponents(db, projectId)).map((c) => `${c.path}#${c.name}`).sort();
    expect(await names(mine)).toEqual(["src/A.tsx#A", "src/B.tsx#B"]);
    expect(await names(other)).toEqual(["src/A.tsx#X"]);
  });

  it("listComponents({ paths }) reads only the components of those files", async () => {
    await codeIndexRepo.saveFiles(db, mine, [
      { path: "src/A.tsx", hash: "a1", symbols: [component("A", "ha")] },
      { path: "src/B.tsx", hash: "b1", symbols: [component("B", "hb")] },
    ]);
    const rows = await symbolsRepo.listComponents(db, mine, { paths: ["src/B.tsx"] });
    expect(rows.map((r) => r.name)).toEqual(["B"]);
    expect(await symbolsRepo.listComponents(db, mine, { paths: [] })).toEqual([]);
  });

  it("saveSummaries updates only this project's rows", async () => {
    await codeIndexRepo.saveFiles(db, mine, [
      { path: "src/A.tsx", hash: "a1", symbols: [component("A", "ha")] },
    ]);
    await codeIndexRepo.saveFiles(db, other, [
      { path: "src/X.tsx", hash: "x1", symbols: [component("X", "hx")] },
    ]);
    const [a] = await symbolsRepo.listComponents(db, mine);
    const [x] = await symbolsRepo.listComponents(db, other);
    const at = new Date("2026-10-28T10:00:00Z");
    const update = (id: string) => ({
      id,
      summary: "Shows A.",
      summaryStatus: "ok" as const,
      summaryAttempts: 1,
      summaryAttemptedAt: at,
    });
    await codeIndexRepo.saveSummaries(db, mine, [update(a?.id ?? ""), update(x?.id ?? "")]);
    expect(await symbolsRepo.listComponents(db, mine)).toMatchObject([
      {
        name: "A",
        summary: "Shows A.",
        summaryStatus: "ok",
        summaryAttempts: 1,
        summaryAttemptedAt: at,
      },
    ]);
    expect(await symbolsRepo.listComponents(db, other)).toMatchObject([
      { name: "X", summary: null, summaryStatus: null, summaryAttempts: 0 },
    ]);
  });
  it("KI-024 removeMissing deletes this project's files in the range that the client no longer has, with their symbols", async () => {
    const save = (projectId: string, paths: string[]) =>
      codeIndexRepo.saveFiles(
        db,
        projectId,
        paths.map((path) => ({ path, hash: "h", symbols: [component(path, `h-${path}`)] })),
      );
    await save(mine, ["src/A.tsx", "src/B.tsx", "src/C.tsx", "src/D.tsx", "src/\u00c9.tsx"]);
    await save(other, ["src/B.tsx", "src/C.tsx"]);

    // Range (src/A.tsx, src/C.tsx]: B is gone locally, C is kept; A and D are outside the range.
    expect(
      await codeIndexRepo.removeMissing(db, mine, {
        after: "src/A.tsx",
        through: "src/C.tsx",
        keep: ["src/C.tsx"],
      }),
    ).toEqual({ deleted: ["src/B.tsx"], held: [] });
    const paths = async (projectId: string) =>
      (await filesRepo.list(db, projectId)).map((f) => f.path).sort();
    expect(await paths(mine)).toEqual(["src/A.tsx", "src/C.tsx", "src/D.tsx", "src/\u00c9.tsx"]);
    expect((await symbolsRepo.listComponents(db, mine)).map((c) => c.path).sort()).toEqual([
      "src/A.tsx",
      "src/C.tsx",
      "src/D.tsx",
      "src/\u00c9.tsx",
    ]);
    // Open-ended range after src/D.tsx: byte order, so 'src/\u00c9.tsx' (UTF-8 0xC3) sorts after 'src/D.tsx'.
    expect(
      await codeIndexRepo.removeMissing(db, mine, { after: "src/D.tsx", through: null, keep: [] }),
    ).toEqual({ deleted: ["src/\u00c9.tsx"], held: [] });
    // The other project is untouched.
    expect(await paths(other)).toEqual(["src/B.tsx", "src/C.tsx"]);
  });
});
