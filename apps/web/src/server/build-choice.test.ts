import StartPage from "@/app/start/page";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 9: "How do you build?" on the start page.
let cookie: string | undefined;
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (n: string) => (n === "codeceipt_build" && cookie ? { value: cookie } : undefined),
  }),
}));

let world: TestWorld;
let owner: SessionUser;
beforeEach(async () => {
  cookie = undefined;
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
});
afterEach(async () => {
  await world.teardown();
});

const render = async (build?: string) =>
  renderToStaticMarkup(
    (await StartPage({ searchParams: Promise.resolve(build ? { build } : {}) })) as ReactElement,
  );

describe("Phase 9: how do you build", () => {
  it("PH9-14 the start page asks how you build, with one link per way, and no steps until you pick one", async () => {
    const html = await render();
    expect(html).toContain("How do you build?");
    expect(html).toContain('href="/start?build=claude"');
    expect(html).toContain('href="/start?build=spec"');
    expect(html).toContain("Pick one and we show the first steps for it.");
  });

  it("PH9-15 a choice (from the link or the remembered cookie) shows its first steps, commands as code", async () => {
    const html = await render("spec");
    expect(html).toContain("I already have a spec or a build kit: your first steps");
    expect(html).toContain("<code>codeceipt import</code>");
    expect(html).toContain('aria-current="true"');
    cookie = "cursor";
    expect(await render()).toContain("With Cursor: your first steps");
  });

  it("PH9-16 attack: an unknown answer shows no steps and is never echoed into the page", async () => {
    const html = await render('"><script>alert(1)</script>');
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("Pick one and we show the first steps for it.");
  });
});
