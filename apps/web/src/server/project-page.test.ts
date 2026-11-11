import ProjectDetailPage from "@/app/projects/[id]/page";
import { projectsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let owner: SessionUser;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
});
afterEach(async () => {
  await world.teardown();
});

const page = async (id: string) =>
  renderToStaticMarkup(
    (await ProjectDetailPage({ params: Promise.resolve({ id }) })) as ReactElement,
  );

describe("project page (backlog)", () => {
  it("BL-28 has a delete section that asks for the project's name, disabled until it is typed", async () => {
    const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    const html = await page(project.id);
    expect(html).toContain("Delete this project");
    expect(html).toContain("Type the project");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*Delete project/s);
  });
});
