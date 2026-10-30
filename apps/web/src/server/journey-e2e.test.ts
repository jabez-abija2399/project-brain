import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GET as authGet, POST as authPost } from "@/app/api/auth/[...all]/route";
import { POST as approveRoute } from "@/app/api/device/approve/route";
import { POST as startRoute } from "@/app/api/device/start/route";
import { POST as tokenRoute } from "@/app/api/device/token/route";
import { GET as openItems } from "@/app/api/hooks/[projectId]/open-items/route";
import { POST as diff } from "@/app/api/index/[projectId]/diff/route";
import { POST as group } from "@/app/api/index/[projectId]/features/route";
import { POST as upload } from "@/app/api/index/[projectId]/route";
import { POST as summarize } from "@/app/api/index/[projectId]/summarize/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { POST as mcpPost } from "@/app/mcp/route";
import ReceiptsPage from "@/app/projects/[id]/receipts/page";
import ProjectsPage from "@/app/projects/page";
import StartPage from "@/app/start/page";
import { type CliDeps, main } from "@brain/cli";
import { type CompleteRequest, type Llm, featureFromPath } from "@brain/core";
import { featuresRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionResolver } from "./auth";
import { setLlmForTests } from "./llm";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Journey part 5: the whole first-time journey of a brand-new user, end to end, against the real route handlers,
// the real better-auth sign-in (only GitHub itself is mocked), the real CLI and PGlite behind them.
const APP = "https://codeceipts.test";
const fixture = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures/component-app",
);

// The browser's cookies for the app; next/headers reads them for server pages.
let browserCookies = "";
vi.mock("next/headers", () => ({
  headers: async () => new Headers(browserCookies ? { cookie: browserCookies } : {}),
}));

let world: TestWorld;
let realFetch: typeof fetch;
const llmCalls: string[] = [];

// The AI behind the server: splits the request into two items and judges the first done, the second missed.
const fakeLlm: Llm = {
  async complete(request: CompleteRequest) {
    llmCalls.push(request.purpose ?? "");
    if (request.purpose === "checklist-split") {
      return "- Add a ReviewSummary component\n- Show the average rating on the product page";
    }
    if (request.purpose === "receipt-judge") {
      return "1 | done | src/components/reviews/ReviewSummary.tsx, src/components/reviews/ReviewSummary.test.tsx\n2 | missed |";
    }
    return "A small UI component.";
  },
};

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("GITHUB_CLIENT_ID", "gh-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", ["gh", "secret", "x1"].join("-"));
  world = await createTestWorld();
  // Real sessions from better-auth, not the test resolver.
  setSessionResolver(null);
  setLlmForTests(fakeLlm);
  // GitHub is the only thing mocked: its token and user endpoints answer for a new user, "ada".
  realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return Response.json({
        access_token: "gho_test",
        token_type: "bearer",
        scope: "read:user,user:email",
      });
    }
    if (url === "https://api.github.com/user") {
      return Response.json({ id: 4242, login: "ada", name: "Ada", email: null, avatar_url: null });
    }
    if (url.startsWith("https://api.github.com/user/emails")) {
      return Response.json([{ email: "ada@example.com", primary: true, verified: true }]);
    }
    return realFetch(input as RequestInfo, init);
  });
  // The device flow's clock (expiry, poll interval) moves with the CLI's waits instead of real time.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00Z"));
  browserCookies = "";
  llmCalls.length = 0;
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setLlmForTests(undefined);
  await world.teardown();
});

const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c?.endsWith("="))
    .join("; ");

async function signInWithGitHub(): Promise<string> {
  const start = await authPost(
    new Request(`${APP}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP },
      body: JSON.stringify({ provider: "github", callbackURL: "/projects" }),
    }),
  );
  const { url } = (await start.json()) as { url: string };
  expect(new URL(url).origin).toBe("https://github.com");
  const state = new URL(url).searchParams.get("state");
  // GitHub sends the browser back with a code; better-auth exchanges it (mocked GitHub) and starts a session.
  const back = await authGet(
    new Request(`${APP}/api/auth/callback/github?code=gh-code&state=${state}`, {
      headers: { cookie: cookiesOf(start) },
    }),
  );
  expect(back.status).toBe(302);
  expect(back.headers.get("location")).toBe("/projects");
  return cookiesOf(back);
}

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const projectRoutes: [RegExp, Handler][] = [
  [/^\/api\/index\/([^/]+)\/diff$/, diff],
  [/^\/api\/index\/([^/]+)\/summarize$/, summarize],
  [/^\/api\/index\/([^/]+)\/features$/, group],
  [/^\/api\/index\/([^/]+)$/, upload],
  [/^\/api\/hooks\/([^/]+)\/open-items$/, openItems],
];

// What the CLI's fetch reaches: the app's own route handlers, in process.
const appFetch: CliDeps["fetch"] = async (url, init) => {
  const req = new Request(url, init);
  const path = new URL(req.url).pathname;
  if (new URL(req.url).origin !== APP) throw new Error(`unexpected host ${req.url}`);
  if (path === "/api/device/start") return startRoute(req);
  if (path === "/api/device/token") return tokenRoute(req);
  if (path === "/api/token/whoami") return whoami(req);
  if (path === "/mcp") return mcpPost(req);
  for (const [re, handler] of projectRoutes) {
    const m = path.match(re);
    if (m?.[1]) return handler(req, { params: Promise.resolve({ projectId: m[1] }) });
  }
  return new Response("not found", { status: 404 });
};

function newApp() {
  const repo = mkdtempSync(join(tmpdir(), "cc-journey-"));
  cpSync(fixture, repo, { recursive: true });
  mkdirSync(join(repo, ".claude"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=a@example.com", "-c", "user.name=a", ...args], {
      cwd: repo,
    });
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  return { repo, git };
}

function cli(repo: string, home: string, openUrl?: (url: string) => Promise<boolean>) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (argv: string[], stdin = "") => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: appFetch,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), CODECEIPT_API_URL: APP },
      cwd: repo,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => stdin,
      sleep: async (ms) => void vi.setSystemTime(Date.now() + ms),
      hasCommand: () => true,
      ...(openUrl ? { openUrl } : {}),
    });
  };
  return { out, err, run };
}

const render = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as ReactElement);
const steps = (html: string) =>
  [...html.matchAll(/data-step="(\d)" data-status="(\w+)"/g)].map((m) => `${m[1]}:${m[2]}`);
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

async function mcp(token: string, name: string, args: Record<string, unknown>) {
  const res = await appFetch(`${APP}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await res.text();
  const data = body.includes("data:") ? (body.split("data:")[1] ?? "") : body;
  return JSON.parse(data).result.content[0].text as string;
}

describe("first-time user journey, end to end", () => {
  it("sign in, npx codeceipt (device approval, index, init), an agent session that misses an item, and the receipt in the dashboard", async () => {
    // 1. Sign in with GitHub (mocked); the first visit lands on the guided start page.
    browserCookies = await signInWithGitHub();
    const toStart = await ProjectsPage({ searchParams: Promise.resolve({}) }).then(
      () => "",
      (e: { digest?: string }) => String(e.digest),
    );
    expect(toStart).toContain("/start");
    expect(steps(await render(StartPage()))).toEqual(["1:waiting", "2:waiting", "3:waiting"]);

    // 2. npx codeceipt in the app's repo: the code is approved in the browser (with the session cookie), creating a
    // project; the CLI links the repo, indexes it and sets up Claude Code.
    const { repo } = newApp();
    const home = mkdtempSync(join(tmpdir(), "cc-journey-home-"));
    let approved = 0;
    const setup = cli(repo, home, async (url) => {
      const code = new URL(url).searchParams.get("code") ?? "";
      const res = await approveRoute(
        new Request(`${APP}/api/device/approve`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP, cookie: browserCookies },
          body: JSON.stringify({ user_code: code, new_project_name: "component-app" }),
        }),
      );
      approved = res.status;
      return true;
    });
    expect(await setup.run([])).toBe(0);
    expect(approved).toBe(200);
    expect(setup.err).toEqual([]);
    const projectId = JSON.parse(
      readFileSync(join(repo, ".git", "codeceipt", "project.json"), "utf8"),
    ).projectId as string;
    const receiptsUrl = `${APP}/projects/${projectId}/receipts`;
    expect(setup.out).toContain("Codeceipt is set up for this repo.");
    expect(setup.out.slice(-4)).toEqual([
      "What happens next:",
      "  1. Start Claude Code in this folder.",
      "  2. Ask it for a change, and end the session when it is done.",
      `  3. See your receipt: ${receiptsUrl}`,
    ]);
    expect(steps(await render(StartPage()))).toEqual(["1:done", "2:done", "3:waiting"]);
    // The user does not commit what setup added: Codeceipt's own files never count in the receipt.

    // 3. A scripted agent session: start hook, the request becomes a checklist, one item is built, session ends.
    const token = (
      JSON.parse(readFileSync(join(home, ".config", "codeceipt", "config.json"), "utf8"))
        .projects as {
        projectId: string;
        token: string;
      }[]
    ).find((p) => p.projectId === projectId)?.token as string;
    const agent = cli(repo, home);
    expect(
      await agent.run(
        ["hook", "session-start", "--agent", "claude"],
        JSON.stringify({ session_id: "s1", cwd: repo }),
      ),
    ).toBe(0);
    // The agent files the request under the feature it is about (reviews, which the index found), then builds one of
    // the two items: a ReviewSummary component with its test. The average on the product page is not done.
    const key = featureFromPath("src/components/reviews/ReviewSummary.tsx");
    const feature = (await featuresRepo.byKeys(world.db, projectId, [key ?? ""]))[0];
    expect(feature?.key).toBe("reviews");
    await mcp(token, "create_checklist", {
      featureId: feature?.id,
      request: "Add a review summary and show the average rating on the product page",
    });
    writeFileSync(
      join(repo, "src", "components", "reviews", "ReviewSummary.tsx"),
      'import { StarRating } from "./StarRating";\nexport function ReviewSummary({ count }: { count: number }) {\n  return <p>{count} reviews</p>;\n}\n',
    );
    writeFileSync(
      join(repo, "src", "components", "reviews", "ReviewSummary.test.tsx"),
      'import { ReviewSummary } from "./ReviewSummary";\ntest("renders", () => expect(ReviewSummary({ count: 3 })).toBeTruthy());\n',
    );
    expect(
      await agent.run(
        ["hook", "session-end", "--agent", "claude"],
        JSON.stringify({ session_id: "s1", cwd: repo }),
      ),
    ).toBe(2);
    expect(agent.err.slice(0, 3)).toEqual([
      "Codeceipt receipt: 1 done, 1 missed.",
      "Checks needing attention: none.",
      expect.stringMatching(
        new RegExp(`^Full receipt: ${receiptsUrl.replace(/[.]/g, "\\.")}#receipt-[\\w-]+$`),
      ),
    ]);
    expect(llmCalls).toEqual(expect.arrayContaining(["checklist-split", "receipt-judge"]));

    // 4. The dashboard: the receipt shows the miss, and the start page shows all three steps done with the receipt.
    const receipts = plain(
      await render(
        ReceiptsPage({
          params: Promise.resolve({ id: projectId }),
          searchParams: Promise.resolve({}),
        }),
      ),
    );
    expect(receipts).toContain("1 done");
    expect(receipts).toContain("1 missed");
    expect(receipts).toContain("Show the average rating on the product page");
    const start = await render(StartPage());
    expect(steps(start)).toEqual(["1:done", "2:done", "3:done"]);
    expect(plain(start)).toContain("Your first receipt");
    expect(plain(start)).toContain("Show the average rating on the product page");
  }, 120_000);
});
