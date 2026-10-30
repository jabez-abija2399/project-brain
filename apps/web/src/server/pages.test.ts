import QuickstartPage, { metadata as quickstartMeta } from "@/app/docs/quickstart/page";
import Home from "@/app/page";
import PrivacyPage, { metadata as privacyMeta } from "@/app/privacy/page";
import TermsPage, { metadata as termsMeta } from "@/app/terms/page";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Launch part 6: plain-language privacy and terms, a one-command quickstart, linked from the footer.
const render = (el: unknown) => renderToStaticMarkup(el as ReactElement);
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
  it("/privacy says what is stored, what never is, which services are used and how to delete an account", () => {
    const html = render(PrivacyPage());
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

  it("/terms is plain language and marks the questions for a lawyer", () => {
    const html = render(TermsPage());
    expect(termsMeta.title).toBe("Terms | Codeceipt");
    expect(html).toMatch(/<h1[^>]*>Terms of use<\/h1>/);
    expect(text(html)).toContain("[REVIEW]");
  });

  it("/docs/quickstart shows just `npx codeceipt`, plus troubleshooting", () => {
    const html = render(QuickstartPage());
    expect(quickstartMeta.title).toBe("Quickstart | Codeceipt");
    expect(copies(html)).toEqual(["npx codeceipt"]);
    expect(html).toMatch(/<h2[^>]*>Troubleshooting<\/h2>/);
    const t = text(html);
    expect(t).toContain("Open this address in your browser");
    expect(t).toContain("This repo is not linked to a Codeceipt project");
    expect(t).not.toContain("CODECEIPT_TOKEN");
  });

  it("the landing page: one `npx codeceipt` step, no session-end command, and footer links to the new pages", async () => {
    const html = render(await Home());
    expect(copies(html)).toEqual(["npx codeceipt"]);
    expect(html).not.toContain("hook session-end");
    const footer = html.slice(html.indexOf("<footer"));
    for (const href of ["/privacy", "/terms", "/docs/quickstart"]) {
      expect(footer).toContain(`href="${href}"`);
    }
  });

  it("every page's footer has the same links", () => {
    for (const html of [render(PrivacyPage()), render(TermsPage()), render(QuickstartPage())]) {
      const footer = html.slice(html.indexOf("<footer"));
      for (const href of ["/privacy", "/terms", "/docs/quickstart"]) {
        expect(footer).toContain(`href="${href}"`);
      }
    }
  });
});
