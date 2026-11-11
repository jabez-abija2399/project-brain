import { featuresRepo, projectsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getContextPack } from "./context-pack";
import { resolveFeature } from "./feature-ref";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Backlog wave D (D-023 review): which feature a ref means.
let world: TestWorld;
let projectId: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "Ada" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "salon" })).id;
});
afterEach(async () => {
  await world.teardown();
});

describe("feature refs", () => {
  it("BL-41a attack: a feature named like an automatic key never takes that key's place", async () => {
    const auto = await featuresRepo.insert(world.db, projectId, { name: "home", key: "@home" });
    const named = await featuresRepo.insert(world.db, projectId, { name: "@home" });
    expect((await resolveFeature(world.db, projectId, "@home")).id).toBe(auto.id);
    // Names, keys and ids still all work.
    expect((await resolveFeature(world.db, projectId, "home")).id).toBe(auto.id);
    expect((await resolveFeature(world.db, projectId, named.id)).id).toBe(named.id);
  });

  it("BL-41b a name that is not a key still resolves by name, and an unknown @ref is not found", async () => {
    const f = await featuresRepo.insert(world.db, projectId, { name: "@mentions" });
    expect((await resolveFeature(world.db, projectId, "@mentions")).id).toBe(f.id);
    await expect(resolveFeature(world.db, projectId, "@nothing")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("BL-41c the context pack is about the resolved feature; another project's feature is not found", async () => {
    await featuresRepo.insert(world.db, projectId, { name: "@pricing" });
    const auto = await featuresRepo.insert(world.db, projectId, {
      name: "Pricing",
      key: "@pricing",
    });
    const pack = await getContextPack(
      world.db,
      projectId,
      await resolveFeature(world.db, projectId, "@pricing"),
    );
    expect(pack).toContain(`CONTEXT PACK for feature "${auto.name}"`);
    const owner2 = await world.createUser({ name: "eve" });
    const otherProject = await projectsRepo.create(world.db, owner2.id, { name: "theirs" });
    const theirs = await featuresRepo.insert(world.db, otherProject.id, { name: "Secret" });
    await expect(getContextPack(world.db, projectId, theirs)).rejects.toMatchObject({
      status: 404,
    });
  });
});
