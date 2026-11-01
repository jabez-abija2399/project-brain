import { readFileSync } from "node:fs";
import HomePage, { metadata } from "@/app/page";
import { WAITLIST_THANKS, WaitlistForm, joinWaitlist } from "@/components/landing/waitlist-form";
import { copyText } from "@/components/ui/copy-button";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const render = async () => renderToStaticMarkup((await HomePage()) as ReactElement);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

afterEach(() => setSessionResolver(null));

// The landing page redesign (2026-11-01): Codeceipt checks whether your AI agent did what you asked.
describe("landing page", () => {
  it("renders for a signed-out visitor with the hero, the receipt and every section in order", async () => {
    setSessionResolver(async () => null);
    const html = await render();
    const t = text(html);
    expect(t).toContain("Your AI agent says it's done. Codeceipt checks.");
    expect(t).toContain(
      "Every session with Claude Code, Cursor, Codex or OpenCode ends with a receipt: what you asked, what changed, what's missing. Built from git, not the agent's word. Your code never leaves your machine.",
    );
    expect(t).toContain("Sign in with GitHub");
    const ids = [
      "agents",
      "problem",
      "how",
      "read",
      "privacy",
      "checks",
      "fit",
      "faq",
      "get-started",
    ];
    const at = ids.map((id) => html.indexOf(`id="${id}"`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // D-019: the product is Codeceipt everywhere; memory is not the headline; the old name is gone.
    expect(html).toContain('class="lp-wordmark" href="#top">Codeceipt</a>');
    expect(html).not.toMatch(/Project Brain|projectbrain/);
    expect(t).not.toMatch(/remembers your app/i);
    // The checker of claims against actual changes is not built, so it is never mentioned.
    expect(t).not.toMatch(/claimed vs|claimed versus/i);
    expect(t).toContain("Build with AI. Keep the receipts.");
  });

  it("the header: Docs, Privacy, Sign in and one primary Get started button; the footer: Docs, Privacy, Terms, npm and the year", async () => {
    setSessionResolver(async () => null);
    const html = await render();
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain('href="/docs/quickstart">Docs</a>');
    expect(header).toContain('href="/privacy">Privacy</a>');
    expect(header).toContain(">Sign in</button>");
    expect(header.match(/btn-primary/g)).toHaveLength(1);
    expect(header).toContain('href="#get-started">Get started</a>');
    expect(header).toContain('aria-expanded="false"');
    const footer = html.slice(html.indexOf("<footer"));
    for (const href of [
      "/docs/quickstart",
      "/privacy",
      "/terms",
      "https://www.npmjs.com/package/codeceipt",
    ]) {
      expect(footer).toContain(`href="${href}"`);
    }
    expect(footer).toContain(String(new Date().getFullYear()));
  });

  it("the hero receipt: the real example, every status an icon and a word, and every line explains itself", async () => {
    setSessionResolver(async () => null);
    const html = await render();
    const hero = html.slice(html.indexOf('class="hero-receipt"'), html.indexOf('id="agents"'));
    const t = text(hero);
    for (const phrase of [
      "Add reviews to the salon page, sorted newest first",
      "Reviews list on the salon page src/pages/Salon.tsx",
      "Done, no test proves it Newest first",
      "Missed Empty state when there are no reviews",
      "Outside the request src/lib/payments.ts",
      "sb_s*** in src/lib/supabase.ts",
      "Table reviews: RLS is off",
      "1 test was skipped",
      "Evidence (no source code)",
      "Salon.tsx: +42 -3, component and query changed",
    ]) {
      expect(t).toContain(phrase);
    }
    expect(hero).toMatch(/data-status="done"><span aria-hidden="true">.<\/span><span>Done<\/span>/);
    expect(hero).toMatch(
      /data-status="missed"><span aria-hidden="true">.<\/span><span>Missed<\/span>/,
    );
    // Each line is a button described by its own tooltip (hover or focus shows it).
    const described = [...hero.matchAll(/<button[^>]*aria-describedby="(tip-[\w-]+)"/g)].map(
      (m) => m[1],
    );
    expect(described).toHaveLength(9);
    for (const id of described) expect(hero).toContain(`role="tooltip" id="${id}"`);
    // The printer is decoration.
    expect(hero).toContain('class="printer" aria-hidden="true"');
  });

  it("makes no invented claims: no logos, testimonials or numbers, except the one cited study", async () => {
    setSessionResolver(async () => null);
    const html = await render();
    // The cited study is the only place with percentages, and it links to its source.
    const cited = html.match(/<p class="research"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(cited).toContain('href="https://arxiv.org/abs/2604.20779"');
    expect(text(cited)).toContain(
      "agents wrote over 99% of the committed code in 41% of cases but asked a clarifying question in only 3% of turns",
    );
    const rest = text(html.replace(/<p class="research"[\s\S]*?<\/p>/, ""));
    expect(rest).not.toMatch(/\d+\s*%|\d+[kKmM]\+|trusted by|testimonial|customers/i);
    expect(html).not.toMatch(/<img/);
    expect(text(html)).toContain("free during the beta");
  });

  it("keeps signed-in users on their current flow (redirect to /projects)", async () => {
    setSessionResolver(async () => ({ id: "u1", email: "a@example.com", name: "a" }));
    const err = await render().catch((e: unknown) => e);
    expect(String((err as { digest?: string }).digest)).toContain("/projects");
  });

  it("sets the page title, description, Open Graph tags and an Open Graph image of the hero receipt", async () => {
    expect(metadata.title).toBe("Codeceipt: a receipt for every AI change");
    expect(metadata.description).toMatch(/did what you asked/);
    expect(metadata.openGraph).toMatchObject({
      title: "Codeceipt: a receipt for every AI change",
      type: "website",
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
    const og = await import("@/app/opengraph-image");
    expect(og.size).toEqual({ width: 1200, height: 630 });
    expect(og.contentType).toBe("image/png");
    expect(og.alt).toMatch(/receipt/i);
  });

  it("the waitlist form has a visible Email label and shows its confirmation once the server saved the email", async () => {
    const html = renderToStaticMarkup(createElement(WaitlistForm));
    const id = html.match(/<label for="([^"]+)">Email<\/label>/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('type="email"');
    // Launch part 5: the form now posts to /api/waitlist (stored there; see waitlist.test.ts).
    const saved = async () => Response.json({ ok: true });
    expect(await joinWaitlist(" you@example.com ", saved)).toEqual({
      ok: true,
      message: WAITLIST_THANKS,
    });
    expect(WAITLIST_THANKS).toBe("You're on the list. We'll email you when your invite is ready.");
    for (const bad of ["", "you", "you@example", "a b@example.com", `${"x".repeat(250)}@e.com`]) {
      expect((await joinWaitlist(bad, saved)).ok).toBe(false);
    }
  });

  it("the hero and the final band each have the `npx codeceipt` box, and copying says Copied (or what to do when it fails)", async () => {
    setSessionResolver(async () => null);
    const html = await render();
    const commands = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
    expect(commands).toEqual(["npx codeceipt", "npx codeceipt"]);
    const written: string[] = [];
    const clipboard = { writeText: async (t: string) => void written.push(t) };
    expect(await copyText("codeceipt index", clipboard)).toBe("copied");
    expect(written).toEqual(["codeceipt index"]);
    const refusing = { writeText: async () => Promise.reject(new Error("denied")) };
    expect(await copyText("x", refusing)).toBe("failed");
    expect(await copyText("x", undefined)).toBe("failed");
  });

  it("the receipt prints once on load and not at all with reduced motion; the landing has no gradients, glows or all-caps labels", () => {
    const css = readFileSync(new URL("../app/landing.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.print-paper \{\s*animation: print [^;]* both;/);
    expect(css).not.toMatch(/animation: print[^;]*infinite/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.print-paper \{\s*animation: none;/,
    );
    const all = css + readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(all).not.toMatch(/gradient\(/);
    expect(all).not.toMatch(/text-transform:\s*uppercase/);
  });
});
