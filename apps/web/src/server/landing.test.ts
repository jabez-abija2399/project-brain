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

afterEach(() => setSessionResolver(null));

describe("landing page", () => {
  it("renders for a signed-out visitor with the hero, the receipt and every section", async () => {
    setSessionResolver(async () => null);
    const html = await render();
    expect(html).toContain("Your AI agent says it&#x27;s done. Get the receipt.");
    expect(html).toContain('href="#join">Join the beta</a>');
    expect(html).toContain('href="#receipt">See a sample receipt</a>');
    for (const id of ["receipt", "how", "privacy", "faq", "join"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // The receipt: status is an icon and a word, never colour alone.
    expect(html).toMatch(/data-status="done"><span aria-hidden="true">.<\/span><span>Done<\/span>/);
    expect(html).toMatch(
      /data-status="missed"><span aria-hidden="true">.<\/span><span>Missed<\/span>/,
    );
    expect(html).toContain("Outside scope");
    expect(html).toContain("Secret found: sb_s*** in");
    expect(html).toContain("Send fix to agent");
    expect(html).toContain("Your source code never leaves your machine.");
    // D-019: the product is Codeceipt everywhere on the page; the old name is gone.
    expect(html).toContain('class="lp-wordmark" href="#top">Codeceipt</a>');
    expect(html).toContain("A receipt for every AI change.");
    expect(html).not.toMatch(/Project Brain|projectbrain/);
    expect(html.match(/<details>/g)).toHaveLength(5);
    // Decorative icons are hidden from screen readers.
    expect(html.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(5);
  });

  it("makes no invented claims: no statistics, percentages, logos or testimonials", async () => {
    setSessionResolver(async () => null);
    const text = (await render()).replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\d+\s*%|\d+[kKmM]\+|trusted by|testimonial|customers/i);
    expect(await render()).not.toMatch(/<img/);
  });

  it("keeps signed-in users on their current flow (redirect to /projects)", async () => {
    setSessionResolver(async () => ({ id: "u1", email: "a@example.com", name: "a" }));
    const err = await render().catch((e: unknown) => e);
    expect(String((err as { digest?: string }).digest)).toContain("/projects");
  });

  it("sets the page title, description and Open Graph tags", () => {
    expect(metadata.title).toBe("Codeceipt: A receipt for every AI change");
    expect(metadata.description).toMatch(/receipt/);
    expect(metadata.openGraph).toMatchObject({
      title: "Codeceipt: A receipt for every AI change",
      type: "website",
    });
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

  it("each terminal snippet has a copy button, and copying says Copied (or what to do when it fails)", async () => {
    setSessionResolver(async () => null);
    const html = await render();
    const commands = [...html.matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
    expect(commands).toEqual(["codeceipt index", "codeceipt init", "codeceipt hook session-end"]);
    const written: string[] = [];
    const clipboard = { writeText: async (t: string) => void written.push(t) };
    expect(await copyText("codeceipt index", clipboard)).toBe("copied");
    expect(written).toEqual(["codeceipt index"]);
    const refusing = { writeText: async () => Promise.reject(new Error("denied")) };
    expect(await copyText("x", refusing)).toBe("failed");
    expect(await copyText("x", undefined)).toBe("failed");
  });

  it("the receipt prints once on load and not at all with reduced motion", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.lp-paper \{[^}]*animation: lp-print[^}]*both;/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.lp-paper \{\s*animation: none;/,
    );
  });
});
