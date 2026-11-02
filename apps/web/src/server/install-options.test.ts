import QuickstartPage from "@/app/docs/quickstart/page";
import { InstallOptions } from "@/components/install-options";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
afterEach(() => setSessionResolver(null));

// D-027 (owner, 2026-11-02): the landing page and the quickstart list the one-line native installers first, Homebrew
// and winget as "coming soon", and npx as the alternative. Before the first native release the installer lines say
// so and npx is the command to copy (the site's installers refuse to run without a pinned release).
const SH = "curl -fsSL https://codeceipts.vercel.app/install.sh | sh";
const PS1 = "irm https://codeceipts.vercel.app/install.ps1 | iex";
const copies = (html: string) => [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("install options", () => {
  it("with a native release: the two installers come first, then Homebrew and winget coming soon, then npx", () => {
    const html = renderToStaticMarkup(createElement(InstallOptions, { released: true }));
    expect(copies(html)).toEqual([SH, PS1, "npx codeceipt"]);
    const t = text(html);
    const order = [
      "macOS, Linux, WSL",
      "Windows (PowerShell)",
      "Homebrew",
      "winget",
      "Node.js",
    ].map((s) => t.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toMatch(/Homebrew and winget: coming soon/);
    expect(t).toMatch(/then run codeceipt in your app's folder/i);
  });

  it("before the first native release: the installers are listed first but marked not yet released; npx is the copy box", () => {
    const html = renderToStaticMarkup(createElement(InstallOptions, { released: false }));
    expect(copies(html)).toEqual(["npx codeceipt"]);
    const t = text(html);
    expect(t.indexOf("macOS, Linux, WSL")).toBeLessThan(t.indexOf("npx codeceipt"));
    expect(t).toMatch(/with the first native release/);
  });

  it("the quickstart shows the install options in step 2, before the approval step", async () => {
    setSessionResolver(async () => null);
    const html = renderToStaticMarkup((await QuickstartPage()) as ReactElement);
    const t = text(html);
    const at = t.indexOf("macOS, Linux, WSL");
    expect(at).toBeGreaterThan(t.indexOf("2. Install and run codeceipt in your project"));
    expect(at).toBeLessThan(t.indexOf("3. Approve in the browser"));
    expect(t).toContain("Homebrew and winget: coming soon");
  });
});
