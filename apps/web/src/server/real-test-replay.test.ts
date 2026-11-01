import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET as lastReceipt } from "@/app/api/hooks/[projectId]/last-receipt/route";
import { GET as openItems } from "@/app/api/hooks/[projectId]/open-items/route";
import { POST as captureRequest } from "@/app/api/hooks/[projectId]/requests/route";
import { POST as diff } from "@/app/api/index/[projectId]/diff/route";
import { POST as group } from "@/app/api/index/[projectId]/features/route";
import { POST as rebuild } from "@/app/api/index/[projectId]/rebuild/route";
import { POST as upload } from "@/app/api/index/[projectId]/route";
import { POST as summarize } from "@/app/api/index/[projectId]/summarize/route";
import { GET as whoami } from "@/app/api/token/whoami/route";
import { POST as mcpPost } from "@/app/mcp/route";
import { AppShell } from "@/components/shell/app-shell";
import { type CliDeps, main } from "@brain/cli";
import type { CompleteRequest, Llm } from "@brain/core";
import { checklistItemsRepo, projectTokensRepo, projectsRepo, receiptsRepo } from "@brain/db";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLlmForTests } from "./llm";
import { setRegistryFetchForTests } from "./npm-registry";
import { type TestWorld, createTestWorld } from "./test-helpers";

// The user's real end-to-end test session (2026-11-01), replayed in order against the real CLI, the real route
// handlers and PGlite: only the AI and the npm registry are fakes. Each step is one of the bugs it found (J, A, B, E,
// I, C, G, F, H, D) plus the VS Code Stop hook; the AI answers in the shapes that broke the old parser.
const APP = "https://codeceipts.test";
const S = (id: string, repo: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ session_id: id, cwd: repo, ...extra });

const SKIP = "In src/lib/permissions.test.ts, add .skip to the first test so it doesn't run.";
const KEY = ["sk_live_", "Zr8Qw2Lm5", "Xp9Tn4Vb7", "Kc1Hd6"].join("");
const DEMO = `Create a file src/lib/demo-config.ts that exports const paymentKey = "${KEY}". This is a fake key for testing.`;
const PACKAGES =
  'Use Codeceipt\'s check_package tool to check "zod" and "react-super-hooks-xyz" before we install anything, and ' +
  'tell me the results. Then add "dayjs" to the dependencies in package.json, but don\'t run npm install.';
const TWO_TASKS =
  "Two tasks: add a comment at the top of the main page, and add a link to /about in the footer. Only do the first " +
  "task for now, skip the second.";
const PRICING = "Add a pricing page with a monthly and a yearly plan";

let world: TestWorld;
let judge = "";
const llmCalls: string[] = [];
const fakeLlm: Llm = {
  async complete(req: CompleteRequest) {
    llmCalls.push(req.purpose ?? "");
    if (req.purpose === "receipt-judge") return judge;
    if (req.purpose !== "request-capture") return "A small module.";
    const p = req.prompt;
    // The shapes that broke the old parser: numbered with backticks, fenced '*' bullets, bold + checkbox + '•'.
    if (p.includes("add .skip"))
      return "FEATURE: none\n1. In `src/lib/permissions.test.ts`, the first test is skipped";
    if (p.includes("demo-config"))
      return "FEATURE: none\n```\n* File src/lib/demo-config.ts exports paymentKey\n```";
    if (p.includes("check_package"))
      return "FEATURE: none\n**Checklist:**\n- [ ] **zod** and **react-super-hooks-xyz** are checked and reported\n• dayjs is in the dependencies in package.json\n2) npm install is not run";
    if (p.includes("Two tasks"))
      return "FEATURE: none\n- A comment is at the top of the main page\n~ The footer has a link to /about";
    if (p.includes("pricing"))
      return "FEATURE: none\n- A pricing page shows a monthly and a yearly plan";
    return "NOT A REQUEST";
  },
};

type Handler = (req: Request, ctx: { params: Promise<{ projectId: string }> }) => Promise<Response>;
const projectRoutes: [RegExp, Handler][] = [
  [/^\/api\/index\/([^/]+)\/diff$/, diff],
  [/^\/api\/index\/([^/]+)\/summarize$/, summarize],
  [/^\/api\/index\/([^/]+)\/features$/, group],
  [/^\/api\/index\/([^/]+)\/rebuild$/, rebuild],
  [/^\/api\/index\/([^/]+)$/, upload],
  [/^\/api\/hooks\/([^/]+)\/open-items$/, openItems],
  [/^\/api\/hooks\/([^/]+)\/requests$/, captureRequest],
  [/^\/api\/hooks\/([^/]+)\/last-receipt$/, lastReceipt],
];
const uploads: string[] = [];
const appFetch: CliDeps["fetch"] = async (url, init) => {
  const req = new Request(url, init);
  const path = new URL(req.url).pathname;
  if (path === "/api/token/whoami") return whoami(req);
  if (path === "/mcp") return mcpPost(req);
  for (const [re, handler] of projectRoutes) {
    const m = path.match(re);
    if (m?.[1]) {
      if (path.startsWith("/api/index/")) uploads.push(path);
      return handler(req, { params: Promise.resolve({ projectId: m[1] }) });
    }
  }
  return new Response("not found", { status: 404 });
};

function repo(name: string, remote: string, files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), `cc-replay-${name}-`));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.email=a@example.com", "-c", "user.name=a", ...args], {
      cwd: dir,
    });
  git("init", "-q");
  git("remote", "add", "origin", remote);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git("add", ".");
  git("commit", "-q", "-m", `${name} base`);
  return { dir, git };
}

function cli(home: string) {
  const out: string[] = [];
  const err: string[] = [];
  const run = (cwd: string, argv: string[], stdin = "") => {
    out.length = 0;
    err.length = 0;
    return main(argv, {
      fetch: appFetch,
      env: { HOME: home, XDG_CONFIG_HOME: join(home, ".config") },
      cwd,
      homedir: home,
      platform: "linux",
      stdout: (l) => out.push(l),
      stderr: (l) => err.push(l),
      readStdin: async () => stdin,
      hasCommand: () => true,
    });
  };
  return { out, err, run };
}

const APP_FILES = {
  "package.json": JSON.stringify(
    { name: "app", scripts: { dev: "next dev" }, dependencies: { next: "15.0.0" } },
    null,
    2,
  ),
  "src/app/page.tsx": "export default function Home() {\n  return <main>Home</main>;\n}\n",
  "src/app/layout.tsx":
    "export default function Layout({ children }: { children: React.ReactNode }) {\n  return <body>{children}<footer>Footer</footer></body>;\n}\n",
  "src/components/ui/button.tsx":
    'export function Button() {\n  return <button type="button">Go</button>;\n}\n',
  "src/lib/permissions.ts":
    'export function canEdit(role: string) {\n  return role === "admin";\n}\n',
  "src/lib/permissions.test.ts":
    'import { describe, expect, it } from "vitest";\nimport { canEdit } from "./permissions";\ndescribe("permissions", () => {\n  it("allows admins", () => {\n    expect(canEdit("admin")).toBe(true);\n  });\n  it("denies guests", () => {\n    expect(canEdit("guest")).toBe(false);\n  });\n});\n',
};

beforeEach(async () => {
  world = await createTestWorld();
  setLlmForTests(fakeLlm);
  judge = "";
  llmCalls.length = 0;
  uploads.length = 0;
  const doc = (name: string) => ({
    name,
    versions: { "1.11.13": { name, version: "1.11.13" } },
    "dist-tags": { latest: "1.11.13" },
    time: {
      created: "2018-01-01T00:00:00Z",
      modified: "2026-01-01T00:00:00Z",
      "1.11.13": "2024-08-20T00:00:00Z",
    },
    repository: { type: "git", url: `git+https://github.com/example/${name}.git` },
  });
  setRegistryFetchForTests(async (url) => {
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    return name === "dayjs" || name === "zod"
      ? new Response(JSON.stringify(doc(name)), { status: 200 })
      : new Response('{"error":"Not found"}', { status: 404 });
  });
});
afterEach(async () => {
  setRegistryFetchForTests(null);
  setLlmForTests(undefined);
  vi.unstubAllEnvs();
  await world.teardown();
});

describe("the real test session, replayed in order", () => {
  it("J, A, B, E, I, C, G, F, H, D and the Stop hook", async () => {
    const owner = await world.createUser({ name: "" });
    const projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
    const token = (await projectTokensRepo.create(world.db, projectId, "laptop")).token;
    const home = mkdtempSync(join(tmpdir(), "cc-replay-home-"));
    const c = cli(home);
    const app = repo("app", "git@github.com:acme/app.git", APP_FILES);

    // Setup: the first repo is connected, indexed and set up for Claude Code (the hooks run without a global install).
    expect(await c.run(app.dir, ["login", "--api-url", APP], `${token}\n`)).toBe(0);
    expect(await c.run(app.dir, ["index"])).toBe(0);
    expect(await c.run(app.dir, ["init", "--claude"])).toBe(0);
    const settings = JSON.parse(readFileSync(join(app.dir, ".claude", "settings.json"), "utf8"));
    expect(JSON.stringify(settings.hooks)).toContain(
      "npx -y codeceipt hook session-end --agent claude",
    );
    expect(settings.hooks.Stop).toHaveLength(1);
    app.git("add", "-A");
    app.git("commit", "-q", "-m", "codeceipt setup");

    // J. A second repository ("stock") carrying a copy of the first repo's link uploads nothing into its project.
    const stock = repo("stock", "git@github.com:acme/stock.git", {
      "design-system/src/components/button.tsx": "export function Button() {\n  return null;\n}\n",
    });
    cpSync(join(app.dir, ".git", "codeceipt"), join(stock.dir, ".git", "codeceipt"), {
      recursive: true,
    });
    uploads.length = 0;
    expect(await c.run(stock.dir, ["index"])).not.toBe(0);
    expect(c.err.join("\n")).toContain("not the one connected");
    expect(uploads).toEqual([]);
    expect(await c.run(stock.dir, ["unlink"])).toBe(0);
    const similar = JSON.parse(await mcpCall(token, "find_similar_component", { query: "button" }));
    const paths = JSON.stringify(similar);
    expect(paths).toContain("src/components/ui/button.tsx");
    expect(paths).not.toContain("design-system/");

    // A + B. The .skip request becomes a real item (not a "Clarify:" question), and the skipped test is labelled
    // "You asked for this" instead of raising an alarm.
    const s1 = S("s1", app.dir);
    await c.run(app.dir, ["hook", "session-start", "--agent", "claude"], s1);
    await c.run(
      app.dir,
      ["hook", "prompt", "--agent", "claude", "--worker"],
      S("s1", app.dir, { prompt: SKIP }),
    );
    writeFileSync(
      join(app.dir, "src/lib/permissions.test.ts"),
      APP_FILES["src/lib/permissions.test.ts"].replace(
        'it("allows admins"',
        'it.skip("allows admins"',
      ),
    );
    judge = "1 | done | src/lib/permissions.test.ts";
    expect(await c.run(app.dir, ["hook", "session-end", "--agent", "claude"], s1)).toBe(0);
    expect(c.err[0]).toBe("Codeceipt receipt: 1 file changed; 1 done, 0 missed.");
    expect(c.err[1]).toBe("Checks needing attention: none.");
    expect(c.err[2]).toBe("Also listed: 1 you asked for.");
    expect(await c.run(app.dir, ["last"])).toBe(0);
    let last = c.out.join("\n");
    expect(last).not.toContain("Clarify");
    expect(last).toContain(
      "Test check: Tests skipped or focused (1) in src/lib/permissions.test.ts: skip: allows admins [You asked for this]",
    );
    app.git("commit", "-q", "-am", "skip");

    // A + B + E. The demo-config request: proper item, the fake key is masked and asked for, and the new file sits
    // with its folder's feature (src/lib, like permissions.ts), never "(no feature)".
    const s2 = S("s2", app.dir);
    await c.run(app.dir, ["hook", "session-start", "--agent", "claude"], s2);
    await c.run(
      app.dir,
      ["hook", "prompt", "--agent", "claude", "--worker"],
      S("s2", app.dir, { prompt: DEMO }),
    );
    writeFileSync(join(app.dir, "src/lib/demo-config.ts"), `export const paymentKey = "${KEY}";\n`);
    judge = "1 | done | src/lib/demo-config.ts";
    await c.run(app.dir, ["hook", "session-end", "--agent", "claude"], s2);
    expect(await c.run(app.dir, ["last"])).toBe(0);
    last = c.out.join("\n");
    expect(last).toMatch(
      /Security finding: .* in src\/lib\/demo-config\.ts:1 \(sk_l\*\*\*\) \[You asked for this\]/,
    );
    expect(last).not.toContain(KEY.slice(4));
    const stored = JSON.stringify(
      (await receiptsRepo.list(world.db, projectId, 1))[0]?.summaryJson,
    );
    expect(stored).not.toContain(KEY.slice(4));
    expect(stored).not.toContain("(no feature)");
    app.git("add", "-A");
    app.git("commit", "-q", "-m", "demo config");

    // A + I + C. The check_package/dayjs request: three items, and dayjs (names and ranges only) is on the receipt
    // with its check_package result; `codeceipt last` names it.
    const s3 = S("s3", app.dir);
    await c.run(app.dir, ["hook", "session-start", "--agent", "claude"], s3);
    await c.run(
      app.dir,
      ["hook", "prompt", "--agent", "claude", "--worker"],
      S("s3", app.dir, { prompt: PACKAGES }),
    );
    const pkg = JSON.parse(APP_FILES["package.json"]);
    pkg.dependencies.dayjs = "^1.11.13";
    writeFileSync(join(app.dir, "package.json"), JSON.stringify(pkg, null, 2));
    judge = "1 | done | package.json\n2 | done | package.json\n3 | done | package.json";
    await c.run(app.dir, ["hook", "session-end", "--agent", "claude"], s3);
    expect(await c.run(app.dir, ["last"])).toBe(0);
    last = c.out.join("\n");
    expect(last).toContain(
      "Dependency: dayjs added ^1.11.13 in package.json (check_package: ok to install)",
    );
    const s3Receipt = (await receiptsRepo.list(world.db, projectId, 1))[0]?.summaryJson as {
      items: unknown[];
    };
    expect(s3Receipt.items).toHaveLength(3);
    expect(JSON.stringify(s3Receipt)).not.toContain("next dev");
    app.git("commit", "-q", "-am", "dayjs");

    // G. Two tasks, the second deferred: it is recorded as postponed, on the receipt, never missed.
    const s4 = S("s4", app.dir);
    await c.run(app.dir, ["hook", "session-start", "--agent", "claude"], s4);
    await c.run(
      app.dir,
      ["hook", "prompt", "--agent", "claude", "--worker"],
      S("s4", app.dir, { prompt: TWO_TASKS }),
    );
    writeFileSync(
      join(app.dir, "src/app/page.tsx"),
      `// Main page\n${APP_FILES["src/app/page.tsx"]}`,
    );
    judge = "1 | done | src/app/page.tsx";
    await c.run(app.dir, ["hook", "session-end", "--agent", "claude"], s4);
    expect(c.err[0]).toBe("Codeceipt receipt: 1 file changed; 1 done, 0 missed.");
    expect(c.err[1]).toContain("1 postponed");
    await c.run(app.dir, ["last"]);
    expect(c.out.join("\n")).toContain("Postponed: The footer has a link to /about");
    app.git("commit", "-q", "-am", "comment");

    // F. A request with no changed file still gets a receipt: "No files changed".
    const s5 = S("s5", app.dir);
    await c.run(app.dir, ["hook", "session-start", "--agent", "claude"], s5);
    await c.run(
      app.dir,
      ["hook", "prompt", "--agent", "claude", "--worker"],
      S("s5", app.dir, { prompt: PRICING }),
    );
    llmCalls.length = 0;
    await c.run(app.dir, ["hook", "session-end", "--agent", "claude"], s5);
    expect(c.err[0]).toBe("Codeceipt receipt: No files changed; 1 not done.");
    expect(llmCalls).not.toContain("receipt-judge");

    // H. The next start note: open work, the postponed item still open, questions apart, untested work apart, the
    // repeated request once, and the next step is the first truly open item.
    const s6 = S("s6", app.dir);
    await c.run(
      app.dir,
      ["hook", "prompt", "--agent", "claude", "--worker"],
      S("s6x", app.dir, { prompt: PRICING }),
    );
    await c.run(app.dir, ["hook", "session-start", "--agent", "claude"], s6);
    const note = c.out.join("\n");
    const open = note.slice(
      note.indexOf("STILL OPEN FROM EARLIER"),
      note.indexOf("DONE, ADD A TEST LATER"),
    );
    expect(open).toContain("(postponed) The footer has a link to /about");
    expect(open.match(/A pricing page shows a monthly and a yearly plan/g)).toHaveLength(1);
    expect(open).not.toContain("A comment is at the top of the main page");
    expect(note).toContain("DONE, ADD A TEST LATER:");
    expect(note).toContain("NEXT STEP: A pricing page shows a monthly and a yearly plan");
    const items = await checklistItemsRepo.listOpenForProject(world.db, projectId, 50);
    expect(items.some((i) => i.status === "postponed")).toBe(true);

    // VS Code: SessionEnd never comes; Stop keeps exactly one receipt for the session, updated as work goes on.
    const before = (await receiptsRepo.list(world.db, projectId, 50)).length;
    writeFileSync(
      join(app.dir, "src/app/pricing.tsx"),
      "export function Pricing() {\n  return null;\n}\n",
    );
    judge = "1 | partial | src/app/pricing.tsx";
    await c.run(app.dir, ["hook", "stop", "--agent", "claude"], s6);
    expect((await receiptsRepo.list(world.db, projectId, 50)).length).toBe(before + 1);
    await c.run(app.dir, ["hook", "stop", "--agent", "claude"], s6);
    expect((await receiptsRepo.list(world.db, projectId, 50)).length).toBe(before + 1);
    writeFileSync(join(app.dir, "src/app/pricing.test.tsx"), 'test("renders", () => {});\n');
    judge = "1 | done | src/app/pricing.tsx";
    await c.run(app.dir, ["hook", "stop", "--agent", "claude"], s6);
    const after = await receiptsRepo.list(world.db, projectId, 50);
    expect(after.length).toBe(before + 1);
    expect(JSON.stringify(after[0]?.summaryJson)).toContain("pricing.test.tsx");

    // D. The dashboard header: a GitHub account without a display name and an unnamed project still have labels.
    const html = renderToStaticMarkup(
      AppShell({
        user: { name: "", email: "ada@example.com" },
        projects: [
          { id: "p1", name: "" },
          { id: "p2", name: "app" },
          { id: "p3", name: "stock" },
        ],
        children: null,
      }),
    );
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    for (const el of header.match(/<(a|summary|button)\b[^>]*>[\s\S]*?<\/\1>/g) ?? []) {
      const text = el.replace(/<[^>]+>/g, "").trim();
      expect(text !== "" || /aria-label="[^"]+"/.test(el), el).toBe(true);
    }
    for (const li of header.match(/<li\b[\s\S]*?<\/li>/g) ?? []) {
      expect(li.replace(/<[^>]+>/g, "").trim(), li).not.toBe("");
    }
    expect(header).toContain("ada@example.com");
    expect(header).toContain("Untitled project");
  });
});

async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
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
