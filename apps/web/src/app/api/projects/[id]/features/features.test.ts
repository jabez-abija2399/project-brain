import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PATCH as patchFeature } from "@/app/api/projects/[id]/features/[fid]/route";
import { POST as createProject } from "@/app/api/projects/route";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { groupFeatures, indexRepo } from "@brain/core";
import { featureFilesRepo, featuresRepo, filesRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../../../..",
  "tests/fixtures/feature-app",
);

function req(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
function paramsOf(id: string, fid: string) {
  return { params: Promise.resolve({ id, fid }) };
}

describe("FEAT-006 PATCH /api/projects/:id/features/:fid", () => {
  let world: TestWorld;

  beforeEach(async () => {
    world = await createTestWorld();
  });
  afterEach(async () => {
    await world.teardown();
  });

  // Creates a project for a fresh user and stores the fixture app's grouped feature map in it.
  async function seedProject(name = "demo") {
    const user = await world.createUser();
    world.signInAs(user);
    const res = await createProject(req("POST", "http://x/api/projects", { name }));
    const { project } = (await res.json()) as { project: { id: string } };
    const index = await indexRepo(fixtureRoot);
    const fileIds = new Map<string, string>();
    for (const f of index.files) {
      const row = await filesRepo.insert(world.db, project.id, { path: f.path, hash: f.hash });
      fileIds.set(f.path, row.id);
    }
    const map = groupFeatures(index.files);
    await featuresRepo.saveMap(world.db, project.id, map);
    const feature = async (n: string) => {
      const row = await featuresRepo.byName(world.db, project.id, n);
      if (!row) throw new Error(`feature ${n} missing`);
      return row;
    };
    const fileId = (path: string) => fileIds.get(path) as string;
    return { user, projectId: project.id, feature, fileId, fileIds, map };
  }

  async function linksOf(projectId: string, fileId: string) {
    const rows = await featureFilesRepo.listForFile(world.db, projectId, fileId);
    return rows.map((r) => ({ featureId: r.featureId, role: r.role }));
  }

  function patch(projectId: string, featureId: string, body: unknown) {
    return patchFeature(
      req("PATCH", `http://x/api/projects/${projectId}/features/${featureId}`, body),
      paramsOf(projectId, featureId),
    );
  }

  it("AC-006-03 renames a feature and the new name persists", async () => {
    const { projectId, feature } = await seedProject();
    const reviews = await feature("reviews");

    const res = await patch(projectId, reviews.id, { name: "customer reviews" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; feature: { id: string; name: string } };
    expect(body.ok).toBe(true);
    expect(body.feature).toMatchObject({ id: reviews.id, name: "customer reviews" });
    expect((await featuresRepo.byId(world.db, projectId, reviews.id))?.name).toBe(
      "customer reviews",
    );
    expect(await featuresRepo.byName(world.db, projectId, "reviews")).toBeNull();
  });

  it("AC-006-03 moving a file between features persists with exactly one primary feature", async () => {
    const { projectId, feature, fileId } = await seedProject();
    const reviews = await feature("reviews");
    const billing = await feature("billing");
    const format = fileId("src/lib/format.ts");
    expect(await linksOf(projectId, format)).toEqual([{ featureId: reviews.id, role: "primary" }]);

    const res = await patch(projectId, billing.id, { moveFiles: [format] });
    expect(res.status).toBe(200);
    expect(await linksOf(projectId, format)).toEqual([{ featureId: billing.id, role: "primary" }]);
    const reviewFiles = await featureFilesRepo.listForFeature(world.db, projectId, reviews.id);
    expect(reviewFiles.map((r) => r.fileId)).not.toContain(format);
  });

  it("AC-006-03 a shared file moved into a feature becomes that feature's primary file only", async () => {
    const { projectId, feature, fileId } = await seedProject();
    const auth = await feature("auth");
    const button = fileId("src/components/ui/Button.tsx");
    const before = await linksOf(projectId, button);
    expect(before).toHaveLength(4);
    expect(before.every((l) => l.role === "shared")).toBe(true);

    const res = await patch(projectId, auth.id, { name: "sign-in", moveFiles: [button] });
    expect(res.status).toBe(200);
    expect(await linksOf(projectId, button)).toEqual([{ featureId: auth.id, role: "primary" }]);
    expect((await featuresRepo.byId(world.db, projectId, auth.id))?.name).toBe("sign-in");
  });

  it("AC-006-03 rejects an empty body, unknown keys and a blank name with 400", async () => {
    const { projectId, feature } = await seedProject();
    const reviews = await feature("reviews");
    expect((await patch(projectId, reviews.id, {})).status).toBe(400);
    expect((await patch(projectId, reviews.id, { name: "x", projectId: "other" })).status).toBe(
      400,
    );
    expect((await patch(projectId, reviews.id, { name: "   " })).status).toBe(400);
    expect((await featuresRepo.byId(world.db, projectId, reviews.id))?.name).toBe("reviews");
  });

  it("AC-006-04 renaming a feature of another user's project returns 404 and changes nothing", async () => {
    const victim = await seedProject("victim");
    const reviews = await victim.feature("reviews");
    const attacker = await seedProject("attacker");

    world.signInAs(attacker.user);
    const res = await patch(victim.projectId, reviews.id, { name: "pwned" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, code: "not_found" });
    expect((await featuresRepo.byId(world.db, victim.projectId, reviews.id))?.name).toBe("reviews");
  });

  it("AC-006-04 another project's feature or file through the attacker's own project id returns 404", async () => {
    const victim = await seedProject("victim");
    const victimReviews = await victim.feature("reviews");
    const victimFormat = victim.fileId("src/lib/format.ts");
    const attacker = await seedProject("attacker");
    const attackerBilling = await attacker.feature("billing");

    world.signInAs(attacker.user);
    const viaOwnProject = await patch(attacker.projectId, victimReviews.id, { name: "pwned" });
    expect(viaOwnProject.status).toBe(404);
    const stealFile = await patch(attacker.projectId, attackerBilling.id, {
      moveFiles: [victimFormat],
    });
    expect(stealFile.status).toBe(404);

    expect((await featuresRepo.byId(world.db, victim.projectId, victimReviews.id))?.name).toBe(
      "reviews",
    );
    expect(await linksOf(victim.projectId, victimFormat)).toEqual([
      { featureId: victimReviews.id, role: "primary" },
    ]);
    expect(await linksOf(attacker.projectId, victimFormat)).toEqual([]);
  });

  it("AC-006-04 a signed-out request returns 401", async () => {
    const { projectId, feature } = await seedProject();
    const reviews = await feature("reviews");
    world.signInAs(null);
    expect((await patch(projectId, reviews.id, { name: "anon" })).status).toBe(401);
    expect((await featuresRepo.byId(world.db, projectId, reviews.id))?.name).toBe("reviews");
  });

  it("AC-006-05 renaming to a name another feature of the project has returns 409", async () => {
    const { projectId, feature } = await seedProject();
    const reviews = await feature("reviews");

    const res = await patch(projectId, reviews.id, { name: "billing" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: "feature_name_taken" });
    expect((await featuresRepo.byId(world.db, projectId, reviews.id))?.name).toBe("reviews");
  });

  it("AC-006-05 a failed rename also rolls back the files moved in the same request", async () => {
    const { projectId, feature, fileId } = await seedProject();
    const reviews = await feature("reviews");
    const stripe = fileId("src/lib/stripe.ts");
    const billing = await feature("billing");

    const res = await patch(projectId, reviews.id, { name: "auth", moveFiles: [stripe] });
    expect(res.status).toBe(409);
    expect(await linksOf(projectId, stripe)).toEqual([{ featureId: billing.id, role: "primary" }]);
  });

  it("AC-006-05 the same name in another project is allowed", async () => {
    const first = await seedProject("first");
    world.signInAs(first.user);
    expect(
      (await patch(first.projectId, (await first.feature("reviews")).id, { name: "orders" }))
        .status,
    ).toBe(200);

    const second = await seedProject("second");
    const res = await patch(second.projectId, (await second.feature("auth")).id, {
      name: "orders",
    });
    expect(res.status).toBe(200);
    expect((await second.feature("orders")).name).toBe("orders");
  });

  // A re-index stores a fresh map from the same paths; features are matched by their path-derived key.
  it("AC-006-06 a renamed feature keeps its name after a re-index and no duplicate is created", async () => {
    const { projectId, feature, fileIds, map } = await seedProject();
    const reviews = await feature("reviews");
    const before = (await featuresRepo.list(world.db, projectId)).length;
    expect((await patch(projectId, reviews.id, { name: "customer reviews" })).status).toBe(200);

    const stars = await filesRepo.insert(world.db, projectId, {
      path: "src/components/reviews/ReviewStars.tsx",
      hash: "h",
    });
    fileIds.set(stars.path, stars.id);
    const next = structuredClone(map);
    next.features.find((f) => f.name === "reviews")?.files.push(stars.path);
    await featuresRepo.saveMap(world.db, projectId, next);

    const after = await featuresRepo.list(world.db, projectId);
    expect(after).toHaveLength(before);
    expect(after.map((f) => f.name)).not.toContain("reviews");
    expect((await featuresRepo.byId(world.db, projectId, reviews.id))?.name).toBe(
      "customer reviews",
    );
    expect(await linksOf(projectId, stars.id)).toEqual([
      { featureId: reviews.id, role: "primary" },
    ]);
  });

  it("AC-006-06 a shared file the user moved stays where the user put it after a re-index", async () => {
    const { projectId, feature, fileId, map } = await seedProject();
    const auth = await feature("auth");
    const button = fileId("src/components/ui/Button.tsx");
    expect((await patch(projectId, auth.id, { moveFiles: [button] })).status).toBe(200);

    await featuresRepo.saveMap(world.db, projectId, map);
    expect(await linksOf(projectId, button)).toEqual([{ featureId: auth.id, role: "primary" }]);
  });

  it("AC-006-06 an automatic placement follows the new map after the files change", async () => {
    const { projectId, feature, fileId, map } = await seedProject();
    const reviews = await feature("reviews");
    const billing = await feature("billing");
    const format = fileId("src/lib/format.ts");
    expect(await linksOf(projectId, format)).toEqual([{ featureId: reviews.id, role: "primary" }]);

    // format.ts is now imported by billing instead of reviews.
    const moved = structuredClone(map);
    for (const f of moved.features) f.files = f.files.filter((p) => p !== "src/lib/format.ts");
    moved.features.find((f) => f.name === "billing")?.files.push("src/lib/format.ts");
    await featuresRepo.saveMap(world.db, projectId, moved);
    expect(await linksOf(projectId, format)).toEqual([{ featureId: billing.id, role: "primary" }]);

    // Later it is used by three features: shared only, no primary left behind.
    const shared = structuredClone(moved);
    for (const f of shared.features) f.files = f.files.filter((p) => p !== "src/lib/format.ts");
    shared.shared.push({ path: "src/lib/format.ts", usedBy: ["auth", "billing", "reviews"] });
    await featuresRepo.saveMap(world.db, projectId, shared);
    const links = await linksOf(projectId, format);
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.role === "shared")).toBe(true);
  });
});
