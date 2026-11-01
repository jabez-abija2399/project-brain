import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitDirOf, readRepoLink, writeRepoLink } from "./repo-link";
import { runGit } from "./scan-secrets";

// Claude Code Desktop (and `claude --worktree`) run sessions in a git worktree, whose own git folder is
// .git/worktrees/<name>. The repo link is written once in the main .git, so every worktree must find it there.
let base: string;
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "cc-wt-")));
  const main = join(base, "main");
  execFileSync("git", ["init", "-q", main]);
  git(
    main,
    "-c",
    "user.email=a@b.c",
    "-c",
    "user.name=a",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  );
  git(main, "worktree", "add", "-q", join(base, "wt"));
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("repo link in a git worktree", () => {
  it("a worktree finds the link written in the main repo (and writes to the same place)", async () => {
    const main = join(base, "main");
    const wt = join(base, "wt");
    const mainGit = await gitDirOf(runGit, main);
    expect(mainGit).toBe(join(main, ".git"));
    expect(
      writeRepoLink(mainGit as string, { apiUrl: "https://codeceipt.example", projectId: "p1" }),
    ).toBe(true);
    // From inside the worktree: the same, main .git folder, so the same link.
    expect(await gitDirOf(runGit, wt)).toBe(join(main, ".git"));
    expect(readRepoLink((await gitDirOf(runGit, wt)) as string)).toEqual({
      apiUrl: "https://codeceipt.example",
      projectId: "p1",
    });
  });

  it("outside any git repo there is no git folder", async () => {
    expect(await gitDirOf(runGit, base)).toBeNull();
  });
});
