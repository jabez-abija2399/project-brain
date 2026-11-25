// FEAT-040: design v3 "Clearance" (docs/design-plan-v3.md). A sidebar shell with the project's sections and the counts
// that wait on the owner, a bottom bar on phones, the cool palette with Geist served from this site, the verdict
// seal on Home, shapes for every status, four-stage feature tracks, Always/Never columns and "Why we're asking".
import { readFileSync } from "node:fs";
import { join } from "node:path";
import BlueprintPage from "@/app/projects/[id]/blueprint/page";
import DecidePage from "@/app/projects/[id]/decide/page";
import FeatureBoardPage from "@/app/projects/[id]/features/page";
import OverviewPage from "@/app/projects/[id]/overview/page";
import { ShellLayout } from "@/app/shell-layout";
import { ProjectLinks } from "@/components/shell/sidebar";
import { featureStage } from "@/components/ui/feature-track";
import { featuresRepo, projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agentAsk } from "./approvals";
import type { SessionUser } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

let path = "/";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-codeceipt-path": path }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
  usePathname: () => path,
}));

const SRC = join(__dirname, "..");
const css = () => readFileSync(join(SRC, "app/globals.css"), "utf8");
let world: TestWorld;
let owner: SessionUser;
let pid: string;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "Maya" });
  world.signInAs(owner);
  pid = (await projectsRepo.create(world.db, owner.id, { name: "salon" })).id;
});
afterEach(async () => {
  path = "/";
  await world.teardown();
});

const props = (id = pid) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve({}),
});
const html = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
const shell = async (at: string) => {
  path = at;
  return html(ShellLayout({ children: createElement("main", null, "page") }));
};
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
const themeTokens = (scope: string) => {
  const map = new Map<string, string>();
  for (const m of scope.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/g)) {
    if (!map.has(m[1] as string)) map.set(m[1] as string, m[2] as string);
  }
  return map;
};

describe("FEAT-040 design v3", () => {
  it("AC-040-01 a sidebar with the wordmark, switcher, the five sections (current marked, To decide counted) and settings, docs and account at the bottom", async () => {
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "Remove the old cart" });
    const page = await shell(`/projects/${pid}/decide`);
    const side = page.slice(page.indexOf('<aside class="sidebar"'), page.indexOf("</aside>"));
    expect(side).toContain("Codeceipt</a>");
    expect(side).toContain('class="switcher"');
    const links = [
      ...side.matchAll(
        /href="\/projects\/[^"/]+\/(\w+)"[^>]*>[\s\S]*?<span class="nav-label">([^<]+)/g,
      ),
    ].map((m) => `${m[1]}:${m[2]}`);
    expect(links).toEqual([
      "overview:Home",
      "receipts:Receipts",
      "decide:To decide",
      "features:Features",
      "blueprint:Blueprint",
      "settings:Project settings",
    ]);
    expect(side).toMatch(
      /(aria-current="page" href="\/projects\/[^"]+\/decide"|href="\/projects\/[^"]+\/decide" aria-current="page")/,
    );
    expect(side).toContain('<span class="tab-badge" aria-label="1 waiting for you"');
    expect(side).toContain('href="/account"');
    expect(side).toContain('href="/docs/quickstart"');
    expect(side).toContain('class="user-menu"');
  });

  it("AC-040-02 on a phone: a top bar with the switcher and a floating bottom bar (Home, Receipts, Decide, Features, More)", async () => {
    const page = await shell(`/projects/${pid}/overview`);
    expect(page).toContain('<header class="app-header">');
    const bar = page.slice(page.indexOf('<nav class="tabbar"'));
    const labels = [...bar.matchAll(/<span class="nav-label">([^<]+)/g)].map((m) => m[1]);
    expect(labels).toEqual(["Home", "Receipts", "Decide", "Features", "More"]);
    const sheet = css();
    expect(sheet).toMatch(/@media \(max-width: 860px\) \{[\s\S]*?\.sidebar \{\s*display: none;/);
    expect(sheet).toMatch(/\.tabbar \{\s*position: fixed;/);
  });

  it("AC-040-03 the Clearance palette with Geist served from this site; text and badge pairs reach 4.5:1 in light and dark", () => {
    const layout = readFileSync(join(SRC, "app/layout.tsx"), "utf8");
    expect(layout).toContain('import { Geist, Geist_Mono } from "next/font/google";');
    // next/font self-hosts the files at build time: no runtime link to another site.
    expect(layout).not.toMatch(/fonts\.googleapis|<link/);
    const sheet = css();
    expect(sheet).toContain("--font-ui: var(--font-geist)");
    expect(sheet).not.toMatch(/gradient\(/);
    const light = themeTokens(sheet.slice(0, sheet.indexOf("@media (prefers-color-scheme: dark)")));
    const dark = themeTokens(sheet.slice(sheet.indexOf("@media (prefers-color-scheme: dark)")));
    expect(light.get("bg")).toBe("#f5f6f8");
    expect(light.get("accent")).toBe("#2747d6");
    for (const t of [light, dark]) {
      for (const [fg, bg] of [
        ["text", "bg"],
        ["muted", "bg"],
        ["muted", "surface-2"],
        ["accent", "surface"],
        ["on-accent", "accent"],
        ["success", "success-soft"],
        ["warning", "warning-soft"],
        ["danger", "danger-soft"],
      ] as const) {
        expect(
          contrast(t.get(fg) as string, t.get(bg) as string),
          `${fg} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("AC-040-04 Home opens with the seal and one verdict: Needs you with the count, Clear, or Unsafe", async () => {
    const { request } = await requestsRepo.createWithItems(
      world.db,
      pid,
      { featureId: null, text: "Add reviews" },
      [{ text: "Empty state", needsClarification: false }],
    );
    await receiptsRepo.insert(world.db, pid, {
      requestId: request.id,
      commitSha: null,
      summaryJson: { items: [{ id: "m", text: "Empty state", status: "missed", evidence: [] }] },
    });
    const needs = await html(OverviewPage(props() as never));
    expect(needs).toMatch(
      /<span class="seal seal-needs" role="img" aria-label="Needs you" data-seal="needs"><b>1<\/b>/,
    );
    expect(needs).toContain("1 receipt needs your attention this week");
    // A security problem outranks everything else.
    const r2 = await requestsRepo.insert(world.db, pid, { text: "Add payments" });
    await receiptsRepo.insert(world.db, pid, {
      requestId: r2.id,
      commitSha: null,
      summaryJson: {
        items: [{ id: "p", text: "Pay", status: "done", evidence: [] }],
        findings: [{ type: "stripe_secret_key", file: "src/pay.ts", line: 3, hint: "Move it" }],
      },
    });
    expect(await html(OverviewPage(props() as never))).toContain('data-seal="unsafe"');
    const calm = (await projectsRepo.create(world.db, owner.id, { name: "calm" })).id;
    const r3 = await requestsRepo.insert(world.db, calm, { text: "Footer" });
    await receiptsRepo.insert(world.db, calm, {
      requestId: r3.id,
      commitSha: null,
      summaryJson: { items: [{ id: "f", text: "Footer", status: "done", evidence: [] }] },
    });
    expect(await html(OverviewPage(props(calm) as never))).toContain(
      'aria-label="All clear" data-seal="clear"',
    );
  });

  it("AC-040-05 every main status is a shape and a word: circle, half circle, triangle, dashed circle", () => {
    const sheet = css();
    const block = sheet.slice(sheet.indexOf("/* Status shapes"));
    expect(block).toMatch(
      /\[data-status="done"\][^{]*> span\[aria-hidden="true"\]:first-child \{\s*border-radius: 50%;\s*background: currentColor;/,
    );
    expect(block).toMatch(
      /\[data-status="partial"\][^{]*\{\s*border-radius: 50%;\s*border: 2px solid currentColor;\s*box-shadow: inset 3px 0 0 currentColor;/,
    );
    expect(block).toMatch(
      /\.badge\[data-status="missed"\] > span\[aria-hidden="true"\]:first-child \{[^}]*border-bottom: 9px solid currentColor;/,
    );
    expect(block).toMatch(
      /\[data-status="not_verified"\][^{]*\{\s*border-radius: 50%;\s*border: 1\.5px dashed currentColor;/,
    );
    // The word is always there next to the shape.
    const badge = readFileSync(join(SRC, "components/ui/status-badge.tsx"), "utf8");
    expect(badge).toContain("<span>{label ?? look.label}</span>");
  });

  it("AC-040-06 features show four stages with the current one named", async () => {
    const f = await featuresRepo.insert(world.db, pid, { name: "Reviews", key: "reviews" });
    await requestsRepo.createWithItems(world.db, pid, { featureId: f.id, text: "Add reviews" }, [
      { text: "Show the list", needsClarification: false },
    ]);
    const page = await html(FeatureBoardPage(props()));
    expect(page).toMatch(
      /<span class="feature-track" data-stage="1"><span class="track-bars" role="img" aria-label="Reviews: Planned">(<span class="on"><\/span>)(<span><\/span>){3}<\/span><span class="track-now">Planned<\/span>/,
    );
    expect(featureStage({ totalItems: 0, doneItems: 0, openItems: 0 })).toBe(0);
    expect(featureStage({ totalItems: 3, doneItems: 1, openItems: 2 })).toBe(2);
    expect(featureStage({ totalItems: 3, doneItems: 3, openItems: 1 })).toBe(3);
    expect(featureStage({ totalItems: 3, doneItems: 3, openItems: 0 })).toBe(4);
  });

  it("AC-040-07 Blueprint has Always and Never columns; a request shows its risk and why it waits for you", async () => {
    const source = readFileSync(join(SRC, "app/projects/[id]/blueprint/page.tsx"), "utf8");
    expect(source.indexOf(">Always</h3>")).toBeLessThan(source.indexOf(">Never</h3>"));
    expect(source).toContain('<div className="rule-columns">');
    expect(await html(BlueprintPage(props() as never))).toBeTruthy();
    await agentAsk(world.db, pid, { action: "delete_feature", summary: "Remove the old cart" });
    const page = await html(DecidePage(props()));
    expect(page).toMatch(
      /data-status="missed"><span aria-hidden="true">✕<\/span><span>High risk<\/span>/,
    );
    expect(page).toContain('data-testid="why-asking"');
    expect(page).toContain("It can remove work or data that is hard to get back.");
  });

  it("AC-040-08 boundary: the shell styles never push a 375 px phone sideways", () => {
    const sheet = css();
    const v3 = sheet.slice(sheet.indexOf("FEAT-040: design v3"));
    for (const m of v3.matchAll(/(?:^|[\s;{])(min-width|width):\s*(\d+)px/g)) {
      expect(Number(m[2]), m[0]).toBeLessThanOrEqual(375);
    }
    expect(v3).toMatch(/\.app-v3 \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(v3).toMatch(/\.tabbar \{\s*position: fixed;\s*left: 12px;\s*right: 12px;/);
  });

  it("AC-040-09 permission: another user's or a made-up project in the address gets no sections and no counts", async () => {
    const stranger = await world.createUser({ name: "stranger" });
    const theirs = (await projectsRepo.create(world.db, stranger.id, { name: "theirs" })).id;
    await agentAsk(world.db, theirs, { action: "delete_feature", summary: "Their secret ask" });
    for (const at of [`/projects/${theirs}/decide`, "/projects/not-a-real-id/decide"]) {
      const page = await shell(at);
      expect(page).not.toContain("tab-badge");
      expect(page).not.toContain(`/projects/${theirs}/`);
      expect(page).not.toContain("Their secret ask");
      expect(page).not.toContain('href="/projects/not-a-real-id/');
    }
    // The sidebar itself refuses a project that is not in the user's own list, whatever counts it is handed.
    path = `/projects/${theirs}/decide`;
    const forged = renderToStaticMarkup(
      createElement(ProjectLinks, {
        projects: [{ id: pid, name: "salon" }],
        counts: { projectId: theirs, receipts: 5, decide: 7 },
        variant: "sidebar",
      }),
    );
    expect(forged).not.toContain("tab-badge");
    expect(forged).not.toContain(`/projects/${theirs}/`);
  });
});
