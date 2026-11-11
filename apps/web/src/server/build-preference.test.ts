import { userPreferencesRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "./auth";
import { buildPreference } from "./build-preference";
import { type TestWorld, createTestWorld } from "./test-helpers";

let world: TestWorld;
let ada: SessionUser;
let bob: SessionUser;
beforeEach(async () => {
  world = await createTestWorld();
  ada = await world.createUser({ name: "ada" });
  bob = await world.createUser({ name: "bob" });
});
afterEach(async () => {
  await world.teardown();
});

describe("How do you build? per account (backlog)", () => {
  it("BL-38 a pick is saved to the account and comes back in another browser; other accounts are untouched", async () => {
    expect(await buildPreference(world.db, ada, "cursor", undefined)).toBe("cursor");
    // Another browser: no ?build= and no cookie.
    expect(await buildPreference(world.db, ada, undefined, undefined)).toBe("cursor");
    // This browser's remembered answer comes first (as before); a new pick replaces the account's.
    expect(await buildPreference(world.db, ada, undefined, "codex")).toBe("codex");
    expect(await buildPreference(world.db, ada, "spec", undefined)).toBe("spec");
    expect(await buildPreference(world.db, bob, undefined, undefined)).toBeNull();
  });

  it("BL-39 attack: an unknown answer is neither shown nor stored", async () => {
    expect(await buildPreference(world.db, ada, "<script>", "evil")).toBeNull();
    expect(await userPreferencesRepo.buildStyle(world.db, ada.id)).toBeNull();
  });
});
