import DevicePage from "@/app/device/page";
import { projectsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startDevice } from "./device";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
const render = async (code?: string) =>
  renderToStaticMarkup(
    (await DevicePage({ searchParams: Promise.resolve(code ? { code } : {}) })) as ReactElement,
  );

beforeEach(async () => {
  world = await createTestWorld();
});
afterEach(async () => {
  await world.teardown();
});

describe("/device page", () => {
  it("signed out: shows the code and a sign-in that comes back to it", async () => {
    world.signInAs(null);
    const html = await render("BCDF-GHJK");
    expect(html).toContain("Connect your terminal");
    expect(html).toContain("BCDF-GHJK");
    expect(html).toContain("Sign in with GitHub");
  });

  it("signed in: shows the pending code, the user's projects and a new-project option named after the repo", async () => {
    const user = await world.createUser({ name: "owner" });
    world.signInAs(user);
    await projectsRepo.create(world.db, user.id, { name: "Shop" });
    const s = await startDevice(
      world.db,
      new Request("http://x/api/device/start", { method: "POST" }),
      { name: "salon-booking" },
    );
    const html = await render(s.user_code.toLowerCase());
    expect(html).toContain(`value="${s.user_code}"`);
    expect(html).toContain(">Shop</option>");
    expect(html).toContain(">A new project</option>");
    expect(html).toContain("Only approve a code you started yourself");
  });

  it("attack: a code with markup or other characters is reduced to letters and dashes before it is shown", async () => {
    world.signInAs(null);
    const html = await render('"><script>alert(1)</script>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });
});
