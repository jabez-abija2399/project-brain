import QuickstartPage from "@/app/docs/quickstart/page";
import NotFound from "@/app/not-found";
import { PURPOSE, ProjectNav } from "@/app/projects/[id]/project-nav";
import ProjectsPage from "@/app/projects/page";
import { ShellLayout } from "@/app/shell-layout";
import { slug } from "@/components/landing/doc-page";
import { currentProjectId } from "@/components/shell/project-switcher";
import { projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";
import { projectsList } from "./projects-list";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The shared app shell, the 404 page and the projects list (2026-11-01 page redesign).
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// The create-project form refreshes the page through the router; the static render only needs it to exist.
vi.mock("next/navigation", async (actual) => ({
  ...(await actual<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => "/projects",
}));

let world: TestWorld;
let owner: Awaited<ReturnType<TestWorld["createUser"]>>;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "ada" });
  world.signInAs(owner);
});
afterEach(async () => {
  setSessionResolver(null);
  await world.teardown();
});

const shell = async (child = "page body") =>
  renderToStaticMarkup(
    (await ShellLayout({ children: createElement("main", null, child) })) as ReactElement,
  );
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const footerLinks = (h: string) =>
  [...h.slice(h.indexOf("<footer")).matchAll(/<a[^>]*href="([^"]+)"/g)].map((m) => m[1]);

describe("app shell", () => {
  it("signed in: skip link, wordmark, project switcher, sign out, the page, and the landing page's footer", async () => {
    const a = await projectsRepo.create(world.db, owner.id, { name: "edutech" });
    await projectsRepo.create(world.db, owner.id, { name: "salon" });
    const html = await shell();
    expect(html).toContain('<a class="skip-link" href="#content">Skip to content</a>');
    expect(html).toContain('<header class="app-header">');
    expect(html).toContain(">Codeceipt</a>");
    expect(html).toContain(`href="/projects/${a.id}/overview"`);
    expect(text(html)).toContain("All projects");
    expect(html).toMatch(/<button type="button" class="btn btn-ghost">Sign out<\/button>/);
    expect(html).toContain('<div id="content" class="shell-body"><main>page body</main></div>');
    expect(footerLinks(html)).toEqual([
      "/docs/quickstart",
      "/privacy",
      "/terms",
      "https://www.npmjs.com/package/codeceipt",
    ]);
    // Signed in, the footer offers no Sign in.
    expect(html.slice(html.indexOf("<footer"))).not.toContain("Sign in");
  });

  it("the footer is the same as the landing page's (same links, same order)", async () => {
    const { Landing } = await import("@/components/landing/landing");
    const landing = renderToStaticMarkup(createElement(Landing));
    // Signed in, the footer is the landing page's without its Sign in link.
    expect(footerLinks(await shell())).toEqual(
      footerLinks(landing).filter((h) => h !== "/sign-in"),
    );
  });

  it("attack: the switcher lists only the signed-in user's own projects", async () => {
    const stranger = await world.createUser({ name: "eve" });
    const theirs = await projectsRepo.create(world.db, stranger.id, { name: "secret-app" });
    await projectsRepo.create(world.db, owner.id, { name: "mine" });
    const html = await shell();
    expect(html).not.toContain(theirs.id);
    expect(html).not.toContain("secret-app");
  });

  it("signed out: the public header with Sign in, and no project switcher", async () => {
    setSessionResolver(async () => null);
    const html = await shell();
    expect(html).toContain('class="lp-header"');
    expect(html).not.toContain("switcher");
    expect(html).toContain('href="/sign-in">Sign in</a>');
  });

  it("the switcher knows the current project from the address", () => {
    expect(currentProjectId("/projects/abc-123/receipts")).toBe("abc-123");
    expect(currentProjectId("/projects/abc-123")).toBe("abc-123");
    expect(currentProjectId("/projects")).toBeNull();
    expect(currentProjectId("/start")).toBeNull();
    expect(currentProjectId(null)).toBeNull();
  });

  it("every project page starts with breadcrumbs, the name, one sentence on its purpose and the tabs", () => {
    for (const current of [
      "overview",
      "features",
      "receipts",
      "proposals",
      "plan",
      "connect",
      "",
    ]) {
      const html = renderToStaticMarkup(
        createElement(ProjectNav, { projectId: "p1", current, name: "edutech" }),
      );
      expect(html).toContain('<nav aria-label="Breadcrumb" class="crumbs">');
      expect(html).toContain('href="/projects?all=1">Projects</a>');
      expect(html).toMatch(/<span aria-current="page">[A-Z][a-z]+<\/span>/);
      expect(html).toContain('<h1 class="wrap">edutech</h1>');
      const purpose = PURPOSE[current as keyof typeof PURPOSE];
      expect(purpose).toMatch(/^[A-Z].*\.$/);
      expect(html).toContain(`<p class="purpose">${purpose.replaceAll("'", "&#x27;")}</p>`);
      expect(html.match(/aria-current="page"/g)).toHaveLength(2);
    }
  });
});

describe("404 page", () => {
  it("says what happened in the shared shell, with one primary way back", async () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html).toContain("<h1>Page not found</h1>");
    expect(text(html)).toContain("does not exist, or you do not have access to it");
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toContain(
      'class="btn btn-primary" href="/projects?all=1">Go to your projects</a>',
    );
    expect(html).toContain('<header class="app-header">');
    expect(html).toContain("<footer");
    // Nothing personal: no project switcher or account on a page anyone can reach.
    expect(html).not.toContain("switcher");
    // Never "forbidden": another user's page looks exactly like a missing one.
    expect(text(html)).not.toMatch(/forbidden|not allowed|belongs to/i);
  });
});

describe("projects list", () => {
  it("each project shows its newest receipt and whether it needs attention; a new one says what to do", async () => {
    const shop = await projectsRepo.create(world.db, owner.id, { name: "shop" });
    const fresh = await projectsRepo.create(world.db, owner.id, { name: "fresh" });
    const { request } = await requestsRepo.createWithItems(
      world.db,
      shop.id,
      { featureId: null, text: "Add a cart" },
      [{ text: "Cart page", needsClarification: false }],
    );
    await receiptsRepo.insert(world.db, shop.id, {
      requestId: request.id,
      summaryJson: { items: [{ id: "a", text: "Cart page", status: "done", evidence: [] }] },
    });
    await receiptsRepo.insert(world.db, shop.id, {
      requestId: request.id,
      summaryJson: { items: [{ id: "b", text: "Cart page", status: "missed", evidence: [] }] },
    });
    const list = await projectsList(world.db, owner);
    const byName = Object.fromEntries(list.map((p) => [p.name, p]));
    expect(byName.shop?.last?.asked).toBe("Add a cart");
    expect(byName.shop?.last?.reasons).toEqual(["1 missed"]);
    expect(byName.fresh?.last).toBeNull();

    const html = renderToStaticMarkup(
      (await ProjectsPage({ searchParams: Promise.resolve({ all: "1" }) })) as ReactElement,
    );
    const t = text(html);
    expect(t).toContain("Add a cart");
    expect(t).toContain("1 missed");
    expect(t).toContain("No receipts yet: end an agent session in this repository.");
    expect(html).toContain(`href="/projects/${fresh.id}/overview"`);
  });

  it("no projects: the empty state teaches npx codeceipt with a copy button", async () => {
    const html = renderToStaticMarkup(
      (await ProjectsPage({ searchParams: Promise.resolve({ all: "1" }) })) as ReactElement,
    );
    expect(html).toContain('data-testid="empty-state"');
    expect(html).toContain('data-copy="npx codeceipt"');
  });

  it("attack: another user's receipts never appear, even for a project id passed in", async () => {
    const stranger = await world.createUser({ name: "eve" });
    const theirs = await projectsRepo.create(world.db, stranger.id, { name: "theirs" });
    await receiptsRepo.insert(world.db, theirs.id, { requestId: null, summaryJson: { items: [] } });
    const { dashboardRepo } = await import("@brain/db");
    expect(await dashboardRepo.latestReceipts(world.db, owner.id, [theirs.id])).toEqual([]);
    expect(await projectsList(world.db, owner)).toEqual([]);
  });
});

describe("docs layout", () => {
  it("the quickstart has a table of contents linking to each section heading", () => {
    const html = renderToStaticMarkup(createElement(QuickstartPage));
    expect(html).toContain('<nav class="doc-toc" aria-label="On this page">');
    const links = [...html.matchAll(/<li><a href="#([\w-]+)">/g)].map((m) => m[1]);
    const ids = [...html.matchAll(/<h2 id="([\w-]+)">/g)].map((m) => m[1]);
    expect(links).toEqual(ids);
    expect(ids).toContain("troubleshooting");
    expect(slug("1. Sign in with GitHub")).toBe("sign-in-with-github");
  });
});
