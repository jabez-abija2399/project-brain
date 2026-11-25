// FEAT-031: onboarding from sign-in to the first receipt. One current step that says what it waits for, help for
// people who never used a terminal, /device catching a dead code before the form, plain reassurance, and the first
// receipt as a moment. Attacker test: a code in the URL alone never links a computer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import DevicePage from "@/app/device/page";
import StartPage from "@/app/start/page";
import { deviceCodesRepo, filesRepo, projectsRepo, receiptsRepo, requestsRepo } from "@brain/db";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { approveDevice, startDevice } from "./device";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const SRC = join(__dirname, "..");
let world: TestWorld;
let owner: SessionUser;
beforeEach(async () => {
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  world.signInAs(owner);
});
afterEach(async () => {
  await world.teardown();
});

const render = async (el: unknown) => renderToStaticMarkup((await el) as ReactElement);
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const device = (code?: string) =>
  render(DevicePage({ searchParams: Promise.resolve(code ? { code } : {}) }));
const newCode = async () =>
  (
    await startDevice(world.db, new Request("http://x/api/device/start", { method: "POST" }), {
      name: "salon",
    })
  ).user_code;

async function linkedWithReceipt() {
  const project = await projectsRepo.create(world.db, owner.id, { name: "shop" });
  const code = await newCode();
  await approveDevice(world.db, owner, { user_code: code, project_id: project.id });
  await filesRepo.insert(world.db, project.id, { path: "src/App.tsx", hash: "a".repeat(64) });
  const request = await requestsRepo.insert(world.db, project.id, { text: "Add a star rating" });
  await receiptsRepo.insert(world.db, project.id, {
    requestId: request.id,
    commitSha: null,
    summaryJson: {
      items: [
        { id: "i1", text: "Add the StarRating component", status: "done", evidence: [] },
        { id: "i2", text: "Show the average", status: "done", evidence: [] },
        { id: "i3", text: "Empty state", status: "missed", evidence: [] },
      ],
      files_by_feature: [],
      outside_scope: [],
      not_verified: [],
      llm_calls: 1,
    },
  });
  return project;
}

describe("FEAT-031 onboarding", () => {
  it("AC-031-01 /start: one current step with a Waiting line, no competing primary button, and a 'Never used a terminal?' helper", async () => {
    const html = await render(StartPage());
    expect(html.match(/data-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-step="1" data-status="waiting" data-current="true"/);
    expect(text(html)).toContain(
      "Waiting for you to run the command and approve the code in your browser",
    );
    // Before any receipt the copy button is the only next step: no primary "Open all receipts".
    expect(html).not.toContain("Open all receipts");
    expect(html).not.toMatch(/btn btn-primary/);
    expect(html).toContain("<summary>Never used a terminal?</summary>");
    expect(text(html)).toContain("paste this into Claude Code or Cursor");
    expect(html).toContain(
      'data-copy="Run npx codeceipt in this project and tell me the code it shows."',
    );
    expect(html.match(/journey-step-later/g)).toHaveLength(2);
  });

  it("AC-031-02 /device with an expired or used code says so before any form", async () => {
    const html = await device("BCDF-GHJK");
    expect(html).toContain('data-testid="device-expired"');
    expect(text(html)).toContain("This code expired or was already used");
    expect(text(html)).toContain("Run npx codeceipt again");
    expect(html).not.toContain("<form");
    // A used code is just as dead: approve one, then open the page with it again.
    const code = await newCode();
    await approveDevice(world.db, owner, { user_code: code, new_project_name: "salon" });
    expect(await device(code)).toContain('data-testid="device-expired"');
  });

  it("AC-031-03 /device explains in plain words what approving allows; after approving it links to Get started", async () => {
    const html = text(await device(await newCode()));
    expect(html).toContain(
      "This lets Codeceipt on this computer send receipts to one project. Your source code stays on your computer; only file names and short summaries are sent.",
    );
    // The deny warning is said once, by the buttons.
    expect(html.match(/Press Deny/g)).toHaveLength(1);
    const form = readFileSync(join(SRC, "app/device/device-approval.tsx"), "utf8");
    expect(form).toContain('href="/start"');
    expect(form).toContain("Watch your progress on Get started");
    expect(form).toContain("pressing Enter accepts the recommended");
  });

  it("AC-031-04 the first receipt: 'Your first receipt is here', one summary sentence, one next action, printed once and not with reduced motion", async () => {
    await linkedWithReceipt();
    const html = await render(StartPage());
    const t = text(html);
    expect(t).toContain("Your first receipt is here");
    expect(t).toContain("Your agent did 2 of 3 things you asked; 1 needs a look.");
    expect(t).toContain("Next: ask your agent for your next change.");
    expect(html.match(/btn btn-primary/g)).toHaveLength(1);
    expect(html).toContain('class="print-once"');
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/\.print-once \{\s*animation: receipt-print 900ms var\(--ease\) 1 both;/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.journey-dot,\s*\.print-once \{\s*animation: none;/,
    );
  });

  it("AC-031-05 attack: opening /device with a code, signed in or not, never links a computer; only Approve does", async () => {
    const code = await newCode();
    // Signed out: the page only offers sign-in.
    world.signInAs(null);
    expect(text(await device(code))).toContain("Sign in with GitHub");
    // Signed in: the page shows the form, and the code is still waiting.
    world.signInAs(owner);
    const html = await device(code);
    expect(html).toContain("<form");
    expect(await deviceCodesRepo.pendingByUserCode(world.db, code, new Date())).not.toBeNull();
    const { items } = await projectsRepo.listByOwner(world.db, owner.id, { limit: 10, offset: 0 });
    expect(items).toHaveLength(0);
    // A stranger cannot approve it into the owner's project.
    const theirs = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
    const stranger = await world.createUser({ name: "stranger" });
    await expect(
      approveDevice(world.db, stranger, { user_code: code, project_id: theirs }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await deviceCodesRepo.pendingByUserCode(world.db, code, new Date())).not.toBeNull();
  });
});
