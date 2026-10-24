import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth, resolveAuthSecret } from "./auth";
import { type TestWorld, createTestWorld } from "./test-helpers";

describe("resolveAuthSecret", () => {
  it("uses BETTER_AUTH_SECRET when it is set", () => {
    expect(resolveAuthSecret({ BETTER_AUTH_SECRET: "s3cret", NODE_ENV: "production" })).toBe(
      "s3cret",
    );
  });

  it("refuses to start in production when BETTER_AUTH_SECRET is missing or empty", () => {
    expect(() => resolveAuthSecret({ NODE_ENV: "production" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => resolveAuthSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: "" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("falls back to a dev secret outside production", () => {
    expect(resolveAuthSecret({ NODE_ENV: "development" })).toBe("dev-secret-change-me");
    expect(resolveAuthSecret({ NODE_ENV: "test" })).toBe("dev-secret-change-me");
  });
});

describe("GitHub OAuth account settings", () => {
  let world: TestWorld;

  beforeEach(async () => {
    // getAuth() is built once per module, so the client id must be set first.
    vi.stubEnv("GITHUB_CLIENT_ID", "test-client-id");
    world = await createTestWorld();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await world.teardown();
  });

  it("encrypts stored OAuth tokens", () => {
    expect(getAuth().options.account?.encryptOAuthTokens).toBe(true);
  });

  it("requests only the read:user and user:email scopes", async () => {
    const ctx = await getAuth().$context;
    const github = ctx.socialProviders.find((p) => p.id === "github");
    if (!github) throw new Error("github provider missing");
    const url = await github.createAuthorizationURL({
      state: "s",
      codeVerifier: "v".repeat(43),
      redirectURI: "http://localhost:3000/api/auth/callback/github",
    });
    expect(url.searchParams.get("scope")).toBe("read:user user:email");
  });
});
