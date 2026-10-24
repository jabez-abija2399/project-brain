import { describe, expect, it } from "vitest";
import { resolveAuthSecret } from "./auth";

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
