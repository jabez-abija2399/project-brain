import { describe, expect, it } from "vitest";
import {
  fingerprintOf,
  fingerprintToken,
  mergeFingerprints,
  normalizeRemote,
  parseFingerprintToken,
  sameRepo,
} from "./repo-fingerprint";

// Real-test bug J (2026-11-01): a second repository ("stock") was taken for the first one. A fingerprint tells repos
// apart: root commit and normalized remote.
const A = "a".repeat(40);
const B = "b".repeat(40);

describe("repo fingerprint", () => {
  it("normalizes the same remote written five ways to one form, and keeps different repos apart", () => {
    for (const url of [
      "git@github.com:Acme/App.git",
      "https://github.com/acme/app",
      "https://user:secret@github.com/acme/app.git",
      "ssh://git@github.com/acme/app/",
      "https://github.com:443/acme/app.git",
    ]) {
      expect([url, normalizeRemote(url)]).toEqual([url, "github.com/acme/app"]);
    }
    expect(normalizeRemote("git@github.com:acme/stock.git")).toBe("github.com/acme/stock");
    expect(normalizeRemote("")).toBeNull();
    expect(normalizeRemote(null)).toBeNull();
    expect(normalizeRemote("https://user:secret@github.com/acme/app")).not.toContain("secret");
  });

  it("the root commit is the first of git's root commits; junk is ignored", () => {
    expect(fingerprintOf(`${B}\n${A}\n`, "git@github.com:acme/app.git")).toEqual({
      root: A,
      remote: "github.com/acme/app",
    });
    expect(fingerprintOf("", null)).toEqual({ root: null, remote: null });
    expect(fingerprintOf("not-a-sha", null).root).toBeNull();
  });

  it("attack: a different root commit or remote is a different repo; unknown parts never decide", () => {
    const app = { root: A, remote: "github.com/acme/app" };
    expect(sameRepo(app, { root: A, remote: "github.com/acme/app" })).toBe(true);
    // "stock": its own history and remote.
    expect(sameRepo(app, { root: B, remote: "github.com/acme/stock" })).toBe(false);
    // A copied .git whose remote was changed to the new repo.
    expect(sameRepo(app, { root: A, remote: "github.com/acme/stock" })).toBe(false);
    // Same remote, re-initialized history: still not the same repo.
    expect(sameRepo(app, { root: B, remote: "github.com/acme/app" })).toBe(false);
    // A remote added later, or no commit yet: cannot tell, so it is not a mismatch.
    expect(sameRepo({ root: A, remote: null }, app)).toBe(true);
    expect(sameRepo({ root: null, remote: null }, app)).toBe(true);
  });

  it("the server only sees hashes, in a strict token shape that round-trips", () => {
    const token = fingerprintToken({ root: A, remote: "github.com/acme/app" });
    expect(token).toMatch(/^r=[0-9a-f]{32};o=[0-9a-f]{32}$/);
    expect(token).not.toContain("github");
    const parsed = parseFingerprintToken(token);
    expect(parsed?.root).toHaveLength(32);
    expect(parseFingerprintToken(fingerprintToken({ root: null, remote: null }))).toEqual({
      root: null,
      remote: null,
    });
    for (const bad of ["", "r=x;o=y", "r=;o=;evil", null])
      expect(parseFingerprintToken(bad)).toBeNull();
    expect(mergeFingerprints({ root: "r1", remote: null }, { root: "r2", remote: "o2" })).toEqual({
      root: "r1",
      remote: "o2",
    });
  });
});
