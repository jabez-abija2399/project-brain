import QuickstartPage, { metadata as quickstartMeta } from "@/app/docs/quickstart/page";
import Home from "@/app/page";
import PrivacyPage, { metadata as privacyMeta } from "@/app/privacy/page";
import TermsPage, { metadata as termsMeta } from "@/app/terms/page";
import { INSTALL_PS1, INSTALL_SH, nativeReleased } from "@/components/install-options";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Launch part 6: plain-language privacy and terms, a one-command quickstart, linked from the footer.
// The reading pages are async (they check the session for their header and footer, owner 2026-11-02).
const render = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const copies = (html: string) => [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => setSessionResolver(async () => null));
afterEach(() => setSessionResolver(null));

describe("public pages", () => {
  it("/privacy says what is stored, what never is, which services are used and how to delete an account", async () => {
    const html = await render(PrivacyPage());
    const t = text(html);
    expect(privacyMeta.title).toBe("Privacy | Codeceipt");
    for (const heading of [
      "What we store",
      "What we never store",
      "Services we use",
      "Deleting your data",
    ]) {
      expect([...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1])).toContain(heading);
    }
    expect(t).toContain("Your source code never leaves your machine");
    for (const service of ["Vercel", "Neon", "GitHub", "Inngest", "Anthropic"]) {
      expect(t).toContain(service);
    }
    expect(t).toContain("[REVIEW]");
  });

  it("/terms is plain language and marks the questions for a lawyer", async () => {
    const html = await render(TermsPage());
    expect(termsMeta.title).toBe("Terms | Codeceipt");
    expect(html).toMatch(/<h1[^>]*>Terms of use<\/h1>/);
    expect(text(html)).toContain("[REVIEW]");
  });

  it("/docs/quickstart shows just `npx codeceipt`, plus troubleshooting", async () => {
    const html = await render(QuickstartPage());
    expect(quickstartMeta.title).toBe("Quickstart | Codeceipt");
    // D-027 (owner, 2026-11-02): the one-line installers come first once a native release is pinned.
    expect(copies(html)).toEqual(
      nativeReleased() ? [INSTALL_SH, INSTALL_PS1, "npx codeceipt"] : ["npx codeceipt"],
    );
    expect(html).toMatch(/<h2[^>]*>Troubleshooting<\/h2>/);
    const t = text(html);
    expect(t).toContain("Open this address in your browser");
    expect(t).toContain("This repo is not linked to a Codeceipt project");
    expect(t).not.toContain("CODECEIPT_TOKEN");
  });

  it("/docs/quickstart follows the first-time journey step by step, with screenshot placeholders", async () => {
    const html = await render(QuickstartPage());
    const t = text(html);
    const order = [
      "Sign in with GitHub",
      "Install and run codeceipt in your project",
      "Approve in the browser",
      "What happens next",
      "Open Claude Code or Cursor and make a change",
      "Codeceipt receipt:",
      "Your first receipt",
    ].map((phrase) => t.indexOf(phrase));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect((t.match(/\[SCREENSHOT/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(t).toContain("codeceipt receipt");
  });

  it("the landing page: only `npx codeceipt` to copy (hero and final band), no session-end command, and footer links to the new pages", async () => {
    const html = await render(Home());
    expect(copies(html)).toEqual(["npx codeceipt", "npx codeceipt"]);
    expect(html).not.toContain("hook session-end");
    const footer = html.slice(html.indexOf("<footer"));
    for (const href of ["/privacy", "/terms", "/docs/quickstart"]) {
      expect(footer).toContain(`href="${href}"`);
    }
  });

  it("every page's footer has the same links", async () => {
    for (const html of await Promise.all([
      render(PrivacyPage()),
      render(TermsPage()),
      render(QuickstartPage()),
    ])) {
      const footer = html.slice(html.indexOf("<footer"));
      for (const href of ["/privacy", "/terms", "/docs/quickstart"]) {
        expect(footer).toContain(`href="${href}"`);
      }
    }
  });
});
