// The consent page (/oauth/authorize): signed-out visitors go to sign-in and come back; signed-in owners see the
// project picker or the consent screen, which names the project and the client.
import AuthorizePage from "@/app/oauth/authorize/page";
import { type TestWorld, createTestWorld } from "@/server/test-helpers";
import { projectsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerClient } from "./mcp-oauth";
import {
  ORIGIN,
  REDIRECT,
  RESOURCE,
  jsonRequest,
  pkce,
  useLocalOrigin,
} from "./mcp-oauth-test-helpers";

class RedirectSignal extends Error {
  constructor(readonly target: string) {
    super("NEXT_REDIRECT");
  }
}
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectSignal(target);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

let world: TestWorld;
let clientId: string;

useLocalOrigin();

beforeEach(async () => {
  world = await createTestWorld();
  const reg = await registerClient(
    world.db,
    jsonRequest(`${ORIGIN}/oauth/register`, {
      client_name: "Claude Desktop",
      redirect_uris: [REDIRECT],
    }),
    new Date("2026-11-02T10:00:00Z"),
  );
  clientId = (reg.body as { client_id: string }).client_id;
});
afterEach(async () => {
  await world.teardown();
});

function params(over: Record<string, string | undefined> = {}) {
  const { challenge } = pkce();
  const base: Record<string, string | undefined> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: "st",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  };
  return Object.fromEntries(
    Object.entries({ ...base, ...over }).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;
}

async function render(query: Record<string, string>) {
  const el = await AuthorizePage({ searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(el as ReactElement);
}

describe("GET /oauth/authorize (page)", () => {
  it("signed out: redirects to sign-in, and the return path is the same authorization request", async () => {
    world.signInAs(null);
    const q = params({ project_id: "p1" });
    let caught: unknown;
    try {
      await render(q);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RedirectSignal);
    const target = (caught as RedirectSignal).target;
    expect(target.startsWith("/sign-in?next=")).toBe(true);
    const next = new URL(target, ORIGIN).searchParams.get("next") ?? "";
    expect(next.startsWith("/oauth/authorize?")).toBe(true);
    expect(new URLSearchParams(next.split("?")[1]).get("client_id")).toBe(clientId);
  });

  it("signed out with a very long request: no redirect loop, a sign-in button and a plain instruction instead", async () => {
    world.signInAs(null);
    const longUri = `https://claude.ai/${"a".repeat(280)}`;
    const reg = await registerClient(
      world.db,
      jsonRequest(`${ORIGIN}/oauth/register`, { client_name: "Long", redirect_uris: [longUri] }),
      new Date("2026-11-02T10:00:00Z"),
    );
    const id = (reg.body as { client_id: string }).client_id;
    const html = await render(params({ client_id: id, redirect_uri: longUri }));
    expect(html).toContain("Sign in to Codeceipt");
    expect(html).toContain("open this link again");
  });

  it("signed in with no project: the project picker lists only this user's projects", async () => {
    const owner = await world.createUser({ name: "Owner" });
    const stranger = await world.createUser({ name: "Stranger" });
    await projectsRepo.create(world.db, owner.id, { name: "Shop" });
    await projectsRepo.create(world.db, stranger.id, { name: "Their vault" });
    world.signInAs(owner);
    const html = await render(params());
    expect(html).toContain("Shop");
    expect(html).not.toContain("Their vault");
    expect(html).toContain("project_id=");
  });

  it("signed in with a project: names the project and the client, says what it can do, and offers Allow and Deny", async () => {
    const owner = await world.createUser({ name: "Owner" });
    const p = await projectsRepo.create(world.db, owner.id, { name: "Shop" });
    world.signInAs(owner);
    const html = await render(params({ project_id: p.id }));
    expect(html).toContain("Shop");
    expect(html).toContain("Claude Desktop");
    expect(html).toContain("localhost:33418");
    expect(html).toMatch(/receipts/i);
    expect(html).toMatch(/checklist/i);
    expect(html).toContain("Allow");
    expect(html).toContain("Deny");
  });
});

describe("GET /oauth/authorize: the consent heading names where the client sends the owner", () => {
  async function consentFor(opts: { clientName: string; redirect: string; projectName?: string }) {
    const owner = await world.createUser({ name: "Owner" });
    const p = await projectsRepo.create(world.db, owner.id, { name: opts.projectName ?? "Shop" });
    const reg = await registerClient(
      world.db,
      jsonRequest(`${ORIGIN}/oauth/register`, {
        client_name: opts.clientName,
        redirect_uris: [opts.redirect],
      }),
      new Date("2026-11-02T10:00:00Z"),
    );
    const id = (reg.body as { client_id: string }).client_id;
    world.signInAs(owner);
    return render(params({ client_id: id, redirect_uri: opts.redirect, project_id: p.id }));
  }
  const headingOf = (html: string) =>
    html.match(/<h2[^>]*id="consent"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "";

  it("attack: a client that redirects to evil.test shows evil.test in the heading, not only in the small print", async () => {
    const html = await consentFor({
      clientName: "Claude Desktop",
      redirect: "https://evil.test/cb",
    });
    const heading = headingOf(html);
    expect(heading).toContain("evil.test");
    expect(heading).toContain("Claude Desktop");
    expect(heading).toContain("Shop");
  });

  it("attack: a client name with markup is shown as escaped text, never as a tag", async () => {
    const html = await consentFor({
      clientName: "<script>alert(1)</script>",
      redirect: "https://evil.test/cb",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("attack: a very long redirect host is capped in the heading", async () => {
    const host = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.test`;
    const html = await consentFor({ clientName: "Client", redirect: `https://${host}/cb` });
    const heading = headingOf(html);
    expect(heading).not.toContain("c".repeat(60));
    expect(heading).toContain("...");
  });

  it("the Allow button names the project", async () => {
    const html = await consentFor({
      clientName: "Claude Desktop",
      redirect: "https://claude.ai/cb",
    });
    expect(html).toContain("Allow access to Shop");
  });
});
