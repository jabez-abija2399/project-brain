// FEAT-038: the public pages say what to do first. The landing hero starts with the command (sign-in is for people
// already set up) and keeps the details after the FAQ; the quickstart uses the same three steps with numbered
// troubleshooting; a shared receipt explains itself to a stranger; a 404 gives a signed-out visitor Home; a dead
// share link says to ask for a new one and never reveals what it pointed to.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import QuickstartPage from "@/app/docs/quickstart/page";
import NotFound from "@/app/not-found";
import DeadShareLink from "@/app/r/[token]/not-found";
import SharedReceiptPage from "@/app/r/[token]/page";
import { STEPS } from "@/components/landing/content";
import { Landing } from "@/components/landing/landing";
import { projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SessionUser, setSessionResolver } from "./auth";
import { createShareLink } from "./share-links";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const SRC = join(__dirname, "..");
let world: TestWorld;
let owner: SessionUser;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  setSessionResolver(async () => null);
});
afterEach(async () => {
  setSessionResolver(null);
  await world.teardown();
});

const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

describe("FEAT-038 public pages", () => {
  it("AC-038-01 the hero shows the first step in order, then 'Already set up? Sign in'; at most 6 sections come before the FAQ", () => {
    const html = renderToStaticMarkup(createElement(Landing));
    const t = text(html);
    const step = t.indexOf("1. Run this in your app's folder");
    expect(step).toBeGreaterThan(-1);
    // The command box follows the label, and signing in comes after both.
    expect(html.indexOf('data-copy="', html.indexOf("1. Run this in your"))).toBeGreaterThan(-1);
    expect(t.indexOf("Already set up? Sign in")).toBeGreaterThan(step);
    const hero = html.slice(0, html.indexOf('id="agents"'));
    expect(hero).toContain('href="/sign-in">Sign in</a>');
    // Sections of the page body, in order: no more than 6 before the FAQ.
    const ids = [...html.matchAll(/<section[^>]*\sid="([\w-]+)"/g)].map((m) => m[1]);
    const faq = ids.indexOf("faq");
    expect(faq).toBeGreaterThan(0);
    expect(faq).toBeLessThanOrEqual(6);
  });

  it("AC-038-02 the quickstart uses the landing page's 3 steps, the working command first, and numbered troubleshooting", async () => {
    const html = renderToStaticMarkup((await QuickstartPage()) as ReactElement);
    const headings = [...html.matchAll(/<h2 id="[\w-]+">([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual([...STEPS.map((s, i) => `${i + 1}. ${s.title}`), "Troubleshooting"]);
    expect(STEPS).toHaveLength(3);
    // The first thing in step 1 to act on is the command to copy.
    const step1 = html.slice(html.indexOf("1. Set up"), html.indexOf("2. Work as usual"));
    expect(step1.indexOf("data-copy=")).toBeGreaterThan(-1);
    expect(step1.indexOf("data-copy=")).toBeLessThan(step1.indexOf("sign in with GitHub"));
    const trouble = html.slice(html.indexOf('id="troubleshooting"'));
    expect(trouble).toMatch(/<ol class="faq faq-numbered"><li><details>/);
  });

  it("AC-038-03 a shared receipt has the public header and footer, a title, a purpose sentence and a state legend", async () => {
    const pid = (await projectsRepo.create(world.db, owner.id, { name: "salon" })).id;
    const request = await requestsRepo.insert(world.db, pid, { text: "Add reviews" });
    const receipt = await receiptsRepo.insert(world.db, pid, {
      requestId: request.id,
      commitSha: null,
      summaryJson: { items: [{ id: "a", text: "Reviews list", status: "done", evidence: [] }] },
    });
    const { url } = await createShareLink(world.db, owner, pid, receipt.id, "https://x.test");
    const token = url.slice(url.lastIndexOf("/") + 1);
    const html = renderToStaticMarkup(
      (await SharedReceiptPage({ params: Promise.resolve({ token }) })) as ReactElement,
    );
    expect(html).toContain('<header class="lp-header">');
    expect(html).toContain("<footer");
    expect(html).toContain("<h1");
    expect(text(html)).toContain("A receipt for an AI coding session");
    expect(html).toContain('data-testid="share-purpose"');
    expect(text(html)).toContain("Someone shared this with you.");
    expect(html).toContain('class="state-guide"');
    expect(text(html)).toContain("What the states on a receipt mean");
    // A stranger is never offered their own projects.
    expect(html).not.toContain('href="/projects');
  });

  it("AC-038-04 negative: a signed-out 404 has Home as its one primary action; a dead share link says to ask for a new one and reveals nothing", async () => {
    const html = renderToStaticMarkup((await NotFound()) as ReactElement);
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(html).toMatch(
      /class="btn btn-primary" (data-testid="not-found-home" href="\/"|href="\/" data-testid="not-found-home")>Home<\/a>/,
    );
    expect(html).not.toContain("Go to your projects");
    // A revoked or made-up token ends on the share link's own 404, which names no project or receipt.
    const pid = (await projectsRepo.create(world.db, owner.id, { name: "secret-shop" })).id;
    const err = await SharedReceiptPage({ params: Promise.resolve({ token: "x".repeat(32) }) })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(String((err as { digest?: string })?.digest ?? err)).toContain("404");
    const dead = renderToStaticMarkup(createElement(DeadShareLink));
    expect(dead).toContain('data-testid="dead-share-link"');
    expect(text(dead)).toContain("Ask them to send you a new link.");
    expect(dead).not.toContain("secret-shop");
    expect(dead).not.toContain(pid);
    expect(text(dead)).not.toMatch(/revoked|expired on|belongs to/i);
  });

  it("AC-038-05 boundary: nothing on a public page can push the page wider than a 375 px phone, in light or dark", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    const landing = readFileSync(join(SRC, "app/landing.css"), "utf8");
    const all = `${css}\n${landing}`;
    // No fixed width or min-width wider than a phone, outside a wide-screen media query.
    const outsideWide = all.replace(/@media \(min-width: \d+px\) \{[\s\S]*?\n\}/g, "");
    for (const m of outsideWide.matchAll(/(?:^|[\s;{])(min-width|width):\s*(\d+)px/g)) {
      expect(Number(m[2])).toBeLessThanOrEqual(375);
    }
    // Terminal blocks wrap instead of widening the page.
    expect(landing).toMatch(
      /\.lp-doc-terminal \{[^}]*white-space: pre-wrap;\s*overflow-wrap: anywhere;/,
    );
    // Long words and addresses wrap.
    expect(all).toMatch(/overflow-wrap: (anywhere|break-word)/);
    // Both colour schemes are defined, so dark mode is the same layout with other tokens.
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });
});
