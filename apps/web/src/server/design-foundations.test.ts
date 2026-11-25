// FEAT-028: shared design foundations: dates people read, one confirm dialog, the account menu (Account on phones,
// Admin only for admins), glossary tooltips and scrolling tab rows.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { GET as adminLinkRoute } from "@/app/api/account/admin-link/route";
import { ShellLayout } from "@/app/shell-layout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TabRow } from "@/components/ui/tab-row";
import { Term, withTerms } from "@/components/ui/term";
import { When } from "@/components/ui/when";
import { GLOSSARY } from "@/lib/glossary";
import { formatDay, formatFull, formatRelative } from "@/lib/when";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGithubLoginResolverForTests } from "./admin";
import { setSessionResolver } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const SRC = join(__dirname, "..");
let world: TestWorld;
let owner: Awaited<ReturnType<TestWorld["createUser"]>>;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "ada" });
  world.signInAs(owner);
});
afterEach(async () => {
  setSessionResolver(null);
  setGithubLoginResolverForTests(null);
  vi.unstubAllEnvs();
  await world.teardown();
});

const shell = async () =>
  renderToStaticMarkup(
    (await ShellLayout({ children: createElement("main", null, "body") })) as ReactElement,
  );
const render = (el: ReactElement) => renderToStaticMarkup(el);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("FEAT-028 shared design foundations", () => {
  it("AC-028-01 dates read as relative words or a day; the dashboard, account and admin never render UTC or a raw ISO date", () => {
    const now = new Date("2026-11-25T15:00:00.000Z");
    expect(formatRelative("2026-11-25T14:59:40.000Z", now)).toBe("just now");
    expect(formatRelative("2026-11-25T14:55:00.000Z", now)).toBe("5 minutes ago");
    expect(formatRelative("2026-11-25T12:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatRelative("2026-11-24T10:00:00.000Z", now)).toBe("yesterday");
    expect(formatRelative("2026-11-22T10:00:00.000Z", now)).toBe("3 days ago");
    expect(formatRelative("2026-11-01T10:00:00.000Z", now)).toBe("1 Nov 2026");
    expect(formatRelative("2026-11-25T20:00:00.000Z", now)).toBe("in 5 hours");
    // In the browser, recent days carry the viewer's own clock time.
    const local = new Date(2026, 10, 25, 14, 19);
    expect(formatRelative(local, new Date(2026, 10, 25, 18, 0), true)).toBe("Today 14:19");
    expect(formatRelative(local, new Date(2026, 10, 26, 9, 0), true)).toBe("Yesterday 14:19");
    expect(formatDay("2026-11-12T08:00:00.000Z")).toBe("12 Nov 2026");
    expect(formatFull(local, true)).toBe("25 Nov 2026, 14:19");
    const html = render(createElement(When, { iso: "2026-11-01T10:00:00.000Z" }));
    expect(html).toMatch(/^<time dateTime="2026-11-01T10:00:00.000Z" title="1 Nov 2026">/);
    expect(html).not.toContain("UTC");
    // No signed-in page prints "UTC", toUTCString or a sliced ISO date any more.
    const pages = [
      ...sourceFiles(join(SRC, "app/projects")),
      ...sourceFiles(join(SRC, "app/account")),
      ...sourceFiles(join(SRC, "app/admin")),
      ...sourceFiles(join(SRC, "components/account")),
      join(SRC, "components/receipt-card.tsx"),
    ];
    for (const file of pages) {
      const code = readFileSync(file, "utf8");
      expect(code, file).not.toMatch(/ UTC\b|toUTCString|toLocaleDateString|\.slice\(0, 1[06]\)/);
    }
  });

  it("AC-028-02 one ConfirmDialog with a consequence and a danger button replaces every window.confirm", () => {
    const html = render(
      createElement(ConfirmDialog, {
        title: "Revoke this key?",
        body: "The computer using it stops sending receipts at once.",
        action: "Revoke key",
        danger: true,
        onClose: () => {},
      }),
    );
    expect(html).toContain('<dialog class="confirm-dialog" aria-labelledby="confirm-title">');
    expect(html).toContain("The computer using it stops sending receipts at once.");
    expect(html).toContain('class="btn btn-danger">Revoke key</button>');
    expect(html).toMatch(/autofocus="">Cancel<\/button>/i);
    const users = sourceFiles(SRC).filter((f) =>
      readFileSync(f, "utf8").includes("window.confirm"),
    );
    expect(users).toEqual([]);
  });

  it("AC-028-03 the header's account menu holds Account, Docs and Sign out at every width; the footer links Account", async () => {
    const html = await shell();
    const menu = html.slice(
      html.indexOf('<details class="user-menu"'),
      html.indexOf("</details>", html.indexOf('<details class="user-menu"')),
    );
    expect(menu).toContain('href="/account"');
    expect(menu).toContain('class="user-menu-docs" href="/docs/quickstart"');
    expect(menu).toContain(">Sign out</button>");
    expect(menu).toContain('aria-label="Menu for ada"');
    expect(html.slice(html.indexOf("<footer"))).toContain('href="/account"');
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/\.user-menu-short\s*\{\s*display: inline;/);
  });

  it("AC-028-04 permission: Admin shows only for logins in ADMIN_GITHUB_LOGINS; others never see it and /admin stays 404", async () => {
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "boss");
    const logins = new Map<string, string>([[owner.id, "ada-gh"]]);
    setGithubLoginResolverForTests(async (u) => logins.get(u.id) ?? null);
    const ask = () => adminLinkRoute(new Request("http://localhost/api/account/admin-link"));
    expect(await (await ask()).json()).toEqual({ admin: false });
    // The server-rendered header never contains an Admin link (it is fetched only when the menu opens).
    expect(await shell()).not.toContain('href="/admin"');
    logins.set(owner.id, "boss");
    expect(await (await ask()).json()).toEqual({ admin: true });
    // No admins configured: false for everyone, without asking GitHub.
    vi.stubEnv("ADMIN_GITHUB_LOGINS", "");
    expect(await (await ask()).json()).toEqual({ admin: false });
    // Signed out: 401, nothing about anyone's admin status.
    world.signInAs(null);
    expect((await ask()).status).toBe(401);
  });

  it("AC-028-05 glossary words have a dotted-underline button whose tooltip is tied to it for hover and keyboard focus; /glossary lists them", async () => {
    const html = render(createElement(Term, { name: "rls" }));
    expect(html).toContain('<button type="button" class="term" aria-describedby="term-rls">');
    expect(html).toContain(
      '<span role="tooltip" id="term-rls" class="term-tip">A lock on a database table',
    );
    const purpose = render(
      createElement("p", null, withTerms("One receipt per agent session.", ["receipt"])),
    );
    expect(purpose).toContain('aria-describedby="term-receipt">receipt</button>');
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/\.term:focus \+ \.term-tip/);
    expect(css).toMatch(/text-decoration: underline dotted/);
    expect(GLOSSARY.map((t) => t.key)).toEqual([
      "receipt",
      "blueprint",
      "checklist item",
      "connection key",
      "rls",
      "mcp",
    ]);
    const page = readFileSync(join(SRC, "app/glossary/page.tsx"), "utf8");
    expect(page).toContain("GLOSSARY.map");
  });

  it("AC-028-06 tab rows shade the scroll edge on phones and know when the row is scrolled to its end", () => {
    const html = render(
      createElement(TabRow, {
        label: "Project",
        children: createElement("a", { href: "#" }, "Overview"),
      }),
    );
    expect(html).toBe(
      '<nav class="project-nav" aria-label="Project" data-end="false"><a href="#">Overview</a></nav>',
    );
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    // No gradients (docs/DESIGN.md): an inset shadow marks the edge until the row is scrolled to its end.
    expect(css).toMatch(
      /\.project-nav\[data-end="false"\] \{\s*box-shadow: inset -16px 0 12px -12px var\(--border-strong\);/,
    );
    for (const file of ["app/projects/[id]/project-nav.tsx", "components/admin/admin-nav.tsx"]) {
      expect(readFileSync(join(SRC, file), "utf8")).toContain("<TabRow");
    }
  });
});
