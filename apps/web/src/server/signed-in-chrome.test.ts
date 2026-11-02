import QuickstartPage from "@/app/docs/quickstart/page";
import NotFound from "@/app/not-found";
import PrivacyPage from "@/app/privacy/page";
import { ShellLayout } from "@/app/shell-layout";
import TermsPage from "@/app/terms/page";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Owner, 2026-11-02: once a user is signed in, no header, footer or page shows "Sign in" (or a way to start
// signing in) anywhere. The reading pages (docs, privacy, terms) used the public header and footer for everyone.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/projects",
}));

let world: TestWorld;
beforeEach(async () => {
  world = await createTestWorld();
});
afterEach(async () => {
  setSessionResolver(null);
  await world.teardown();
});

const render = async (page: unknown) => renderToStaticMarkup((await page) as ReactElement);
// Rendered one at a time (each may read the session from the test database).
const pages = [
  ["docs/quickstart", () => QuickstartPage()],
  ["privacy", () => PrivacyPage()],
  ["terms", () => TermsPage()],
  ["404", () => NotFound()],
  ["app shell", () => ShellLayout({ children: createElement("main", null, "body") })],
] as const;
// The words and links that start signing in. The quickstart's own step "1. Sign in with GitHub" is instructions, not a
// control: only links and buttons are checked, and in-page links (its table of contents, href="#...") are skipped.
const signInControls = (html: string) =>
  [...html.matchAll(/<(a|button)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .filter(([el]) => !/href="#/.test(el))
    .filter(
      ([el, , inner]) =>
        /href="\/sign-in/.test(el) ||
        /sign in|get started/i.test((inner ?? "").replace(/<[^>]+>/g, "")),
    )
    .map(([el]) => el);

describe("signed in: no Sign in anywhere", () => {
  it("docs, privacy, terms, 404 and the app shell show no Sign in or Get started link or button", async () => {
    world.signInAs(await world.createUser({ name: "ada" }));
    for (const [name, page] of pages) {
      const html = await render(page());
      expect(signInControls(html), name).toEqual([]);
    }
  });

  it("the reading pages point a signed-in user to their projects instead", async () => {
    world.signInAs(await world.createUser({ name: "ada" }));
    for (const page of [QuickstartPage(), PrivacyPage(), TermsPage()]) {
      const header = (await render(page)).split("</header>")[0] ?? "";
      expect(header).toContain('href="/projects"');
    }
  });

  it("signed out, the reading pages still offer Sign in in the header and the footer", async () => {
    setSessionResolver(async () => null);
    for (const page of [QuickstartPage(), PrivacyPage(), TermsPage()]) {
      const html = await render(page);
      const header = html.split("</header>")[0] ?? "";
      const footer = html.slice(html.indexOf("<footer"));
      expect(header).toContain('href="/sign-in"');
      expect(footer).toContain('href="/sign-in"');
    }
  });
});
