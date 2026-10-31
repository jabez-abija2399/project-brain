import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as lastReceipt } from "@/app/api/hooks/[projectId]/last-receipt/route";
import { GET as openItems } from "@/app/api/hooks/[projectId]/open-items/route";
import { POST as captureRequest } from "@/app/api/hooks/[projectId]/requests/route";
import { POST as mcpPost } from "@/app/mcp/route";
import { type CliDeps, main } from "@brain/cli";
import type { CompleteRequest, Llm } from "@brain/core";
import { featuresRepo, projectTokensRepo, projectsRepo, receiptsRepo } from "@brain/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkRepo } from "../../../../packages/cli/src/test-support";
import { setLlmForTests } from "./llm";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The edutech case after PR #22, end to end through the real session hooks and routes: 8 comment-only lines added at
// the top of src/app/page.tsx for "Add a comment at the top of the main page explaining what it shows." must come out
// "Done, no test proves it", and `codeceipt last --evidence` shows exactly what the judge was given.
const APP = "https://codeceipts.test";
const ASK = "Add a comment at the top of the main page explaining what it shows.";
const PAGE = [
  '"use client";',
  "",
  'import Link from "next/link";',
  'import { useCourses } from "@/lib/offline/sync";',
  "",
  "export default function Home() {",
  "  const courses = useCourses();",
  "  return (",
  "    <main>",
  "      {courses.map((c) => (",
  "        <Link key={c.id} href={`/courses/${c.id}`}>{c.title}</Link>",
  "      ))}",
  "    </main>",
  "  );",
  "}",
  "",
].join("\n");
const COMMENT = [
  "/**",
  " * Main page (/): the student's home screen.",
  " *",
  " * Shows every course the student is enrolled in, as links to the course",
  " * pages. Courses come from the offline sync store (useCourses), so the list",
  " * also works without a network connection.",
  " */",
  "",
  "",
].join("\n");

let world: TestWorld;
let judgePrompts: string[];
const llm: Llm = {
  async complete(req: CompleteRequest) {
    if (req.purpose === "request-capture") {
      return "FEATURE: home\n- The main page has a comment at the top explaining what it shows";
    }
    if (req.purpose === "receipt-judge") {
      judgePrompts.push(req.prompt);
      // A careful judge: done only when it can see a comment-only change at the top of the page.
      return /src\/app\/page\.tsx \(in the request's feature[^)]*\): \+8 -0, comment only, top of file/.test(
        req.prompt,
      )
        ? "1 | done | src/app/page.tsx"
        : "1 | unclear |";
    }
    return "";
  },
};

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const routes: [RegExp, Handler][] = [
  [/^\/api\/hooks\/([^/]+)\/open-items$/, openItems],
  [/^\/api\/hooks\/([^/]+)\/requests$/, captureRequest],
  [/^\/api\/hooks\/([^/]+)\/last-receipt$/, lastReceipt],
];
const appFetch: CliDeps["fetch"] = async (url, init) => {
  const req = new Request(url, init);
  const u = new URL(req.url);
  if (u.origin !== APP) throw new Error(`unexpected host ${req.url}`);
  if (u.pathname === "/mcp") return mcpPost(req);
  for (const [re, handler] of routes) {
    const m = u.pathname.match(re);
    if (m?.[1]) return handler(req, { params: Promise.resolve({ projectId: m[1] }) });
  }
  return new Response("not found", { status: 404 });
};

beforeEach(async () => {
  world = await createTestWorld();
  judgePrompts = [];
  setLlmForTests(llm);
});
afterEach(async () => {
  setLlmForTests(undefined);
  await world.teardown();
});

async function edutech() {
  const owner = await world.createUser({ name: "owner" });
  const project = await projectsRepo.create(world.db, owner.id, { name: "edutech" });
  await featuresRepo.insert(world.db, project.id, { name: "home", key: "@home" });
  const { token } = await projectTokensRepo.create(world.db, project.id);
  const home = mkdtempSync(join(tmpdir(), "cc-ev-home-"));
  const repo = mkdtempSync(join(tmpdir(), "cc-ev-repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=a@example.com", "-c", "user.name=a", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  mkdirSync(join(repo, "src", "app"), { recursive: true });
  writeFileSync(join(repo, "src", "app", "page.tsx"), PAGE);
  git("add", ".");
  git("commit", "-q", "-m", "base");
  linkRepo(repo, join(home, ".config", "codeceipt", "config.json"), {
    apiUrl: APP,
    projectId: project.id,
    token,
  });
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[], stdin: object = {}) => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: appFetch,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => JSON.stringify(stdin),
    });
  };
  return { project, repo, out, err, run };
}

describe("edutech evidence, end to end through the session hooks", () => {
  it("8 comment-only lines at the top of the main page come out Done, no test proves it", async () => {
    const t = await edutech();
    const session = { session_id: "s1", cwd: t.repo };
    expect(await t.run(["hook", "session-start", "--agent", "claude"], session)).toBe(0);
    expect(
      await t.run(["hook", "prompt", "--agent", "claude", "--worker"], { ...session, prompt: ASK }),
    ).toBe(0);
    const page = join(t.repo, "src", "app", "page.tsx");
    writeFileSync(page, COMMENT + readFileSync(page, "utf8"));
    expect(await t.run(["hook", "session-end", "--agent", "claude"], session)).toBe(0);

    expect(judgePrompts).toHaveLength(1);
    expect(judgePrompts[0]).toContain(
      "- src/app/page.tsx (in the request's feature): +8 -0, comment only, top of file",
    );
    const [stored] = await receiptsRepo.list(world.db, t.project.id, 5);
    const items = (stored?.summaryJson as { items: { status: string }[] }).items;
    expect(items.map((i) => i.status)).toEqual(["done_untested"]);
    expect(t.err[0]).toBe("Codeceipt receipt: 1 file changed; 1 done, 0 missed.");
  });

  it("codeceipt last --evidence prints exactly the code-free evidence the judge was given, per file", async () => {
    const t = await edutech();
    const session = { session_id: "s1", cwd: t.repo };
    await t.run(["hook", "session-start", "--agent", "claude"], session);
    await t.run(["hook", "prompt", "--agent", "claude", "--worker"], { ...session, prompt: ASK });
    const page = join(t.repo, "src", "app", "page.tsx");
    writeFileSync(page, COMMENT + readFileSync(page, "utf8"));
    await t.run(["hook", "session-end", "--agent", "claude"], session);

    expect(await t.run(["last", "--evidence"])).toBe(0);
    expect(t.out).toContain("Evidence sent to the judge (no source code):");
    expect(t.out).toContain(
      "  src/app/page.tsx: +8 -0, comment only, top of file (in the request's feature)",
    );
    const printed = t.out.join("\n");
    expect(printed).not.toContain("student");
    expect(printed).not.toContain("useCourses()");
  });

  it.each([
    ["page.tsx was already modified before the session", "dirty"],
    ["the agent commits its change", "commit"],
    ["CRLF line endings", "crlf"],
    ["the comment goes below a 'use client' line", "below"],
  ])("variant: %s; the judge still sees the session's own change", async (_name, variant) => {
    const t = await edutech();
    const session = { session_id: "s1", cwd: t.repo };
    const page = join(t.repo, "src", "app", "page.tsx");
    if (variant === "dirty") {
      writeFileSync(page, readFileSync(page, "utf8").replace("useCourses();", "useCourses(true);"));
    }
    if (variant === "crlf") {
      writeFileSync(page, PAGE.replace(/\n/g, "\r\n"));
      execFileSync("git", ["-c", "user.email=a@e", "-c", "user.name=a", "commit", "-qam", "crlf"], {
        cwd: t.repo,
      });
    }
    await t.run(["hook", "session-start", "--agent", "claude"], session);
    await t.run(["hook", "prompt", "--agent", "claude", "--worker"], { ...session, prompt: ASK });
    const now = readFileSync(page, "utf8");
    const text = variant === "crlf" ? COMMENT.replace(/\n/g, "\r\n") : COMMENT;
    writeFileSync(
      page,
      variant === "below" ? now.replace('"use client";\n', `"use client";\n${text}`) : text + now,
    );
    if (variant === "commit") {
      execFileSync("git", ["-c", "user.email=a@e", "-c", "user.name=a", "commit", "-qam", "c"], {
        cwd: t.repo,
      });
    }
    await t.run(["hook", "session-end", "--agent", "claude"], session);
    expect(judgePrompts[0]).toMatch(
      /- src\/app\/page\.tsx \(in the request's feature[^)]*\): \+8 -0, comment only, top of file\n/,
    );
    if (variant === "dirty") {
      expect(judgePrompts[0]).toContain(
        "already modified before the session, the summary covers this session's edits only",
      );
    }
    const [stored] = await receiptsRepo.list(world.db, t.project.id, 5);
    expect((stored?.summaryJson as { items: { status: string }[] }).items[0]?.status).toBe(
      "done_untested",
    );
  });

  it("a receipt from a CLI that sent no change summaries says so, and --evidence shows paths only", async () => {
    const t = await edutech();
    const session = { session_id: "s1", cwd: t.repo };
    await t.run(["hook", "session-start", "--agent", "claude"], session);
    // An older CLI: paths only, no change summaries.
    const { row } = await projectTokensRepo.create(world.db, t.project.id);
    await generateReceipt(world.db, row, { changedFiles: ["src/app/page.tsx"] });
    const [stored] = await receiptsRepo.list(world.db, t.project.id, 5);
    expect(stored?.summaryJson).toMatchObject({ no_change_summaries: true });
    expect(await t.run(["last", "--evidence"])).toBe(0);
    expect(t.out).toContain("  src/app/page.tsx: no change summary (paths only)");
    expect(t.out).toContain(
      "The CLI sent no change summaries for this receipt (an older codeceipt?), so the judge saw paths only.",
    );
  });
});
