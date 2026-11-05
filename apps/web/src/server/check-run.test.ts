// FEAT-022 (server side): the CLI runs the repo's check command on the user's computer and posts only the result
// (passed/failed/timed out, exit code, duration, test counts) for a receipt; the receipt then shows it, or "not run".
import { POST } from "@/app/api/hooks/[projectId]/check-run/route";
import { ReceiptCard } from "@/components/receipt-card";
import { receiptView } from "@brain/core";
import { projectTokensRepo, projectsRepo, receipts, receiptsRepo } from "@brain/db";
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TestWorld, createTestWorld } from "./test-helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
beforeEach(async () => {
  world = await createTestWorld();
});
afterEach(async () => {
  await world.teardown();
});

async function fixture() {
  const owner = await world.createUser({ name: "owner" });
  const project = await projectsRepo.create(world.db, owner.id, { name: "A" });
  const other = await projectsRepo.create(world.db, owner.id, { name: "B" });
  const receipt = await receiptsRepo.insert(world.db, project.id, {
    summaryJson: { items: [{ id: "i1", text: "Add a footer", status: "done" }] },
  });
  const otherReceipt = await receiptsRepo.insert(world.db, other.id, {
    summaryJson: { items: [] },
  });
  const token = (await projectTokensRepo.create(world.db, project.id, "laptop")).token;
  return { project, receipt, otherReceipt, token };
}

const post = (projectId: string, token: string, body: unknown) =>
  POST(
    new Request(`http://localhost/api/hooks/${projectId}/check-run`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) },
  );
const summaryOf = async (id: string) =>
  (await world.db.select().from(receipts).where(eq(receipts.id, id)))[0]?.summaryJson;
const card = (summary: unknown) =>
  renderToStaticMarkup(
    createElement(ReceiptCard, {
      receipt: {
        id: "r",
        projectId: "p",
        createdAt: new Date().toISOString(),
        asked: "Add a footer",
        commitSha: null,
        view: receiptView(summary),
        fixPrompt: null,
      },
      expanded: true,
      readOnly: true,
    }),
  ).replace(/<[^>]+>/g, " ");

describe("FEAT-022 build and test evidence (server)", () => {
  it("AC-022-01 a posted result is stored on the receipt and shown: passed, exit code, duration, test counts", async () => {
    const f = await fixture();
    const res = await post(f.project.id, f.token, {
      receipt_id: f.receipt.id,
      status: "failed",
      exit_code: 1,
      duration_ms: 41_200,
      passed: 11,
      failed: 1,
    });
    expect(res.status).toBe(200);
    const summary = await summaryOf(f.receipt.id);
    expect(receiptView(summary).checkRun).toEqual({
      status: "failed",
      exitCode: 1,
      durationMs: 41_200,
      passed: 11,
      failed: 1,
    });
    expect(card(summary)).toMatch(
      /Build and tests:\s+failed \(exit code 1\) in 41 s; 11 passed, 1 failed/,
    );
  });

  it("AC-022-02 a timed-out run is shown as timed out", async () => {
    const f = await fixture();
    await post(f.project.id, f.token, {
      receipt_id: f.receipt.id,
      status: "timed_out",
      exit_code: null,
      duration_ms: 300_000,
    });
    expect(card(await summaryOf(f.receipt.id))).toMatch(/Build and tests:\s+timed out after 300 s/);
  });

  it("AC-022-04 attack: output or any other field is refused (400); another project's receipt is 404", async () => {
    const f = await fixture();
    const withOutput = await post(f.project.id, f.token, {
      receipt_id: f.receipt.id,
      status: "passed",
      exit_code: 0,
      duration_ms: 10,
      output: "FAIL src/a.test.ts ... sk_live_secret",
    });
    expect(withOutput.status).toBe(400);
    expect(JSON.stringify(await summaryOf(f.receipt.id))).not.toContain("check_run");
    const foreign = await post(f.project.id, f.token, {
      receipt_id: f.otherReceipt.id,
      status: "passed",
      exit_code: 0,
      duration_ms: 10,
    });
    expect(foreign.status).toBe(404);
    expect(JSON.stringify(await summaryOf(f.otherReceipt.id))).not.toContain("check_run");
  });

  it("AC-022-05 a receipt without a check run says 'not run'", () => {
    expect(receiptView({ items: [] }).checkRun).toEqual({
      status: "not_run",
      exitCode: null,
      durationMs: null,
      passed: null,
      failed: null,
    });
    expect(card({ items: [] })).toMatch(/Build and tests:\s+not run/);
  });

  it("attack (security review): a receipt keeps its first result; a later post (a forged 'passed') is refused with 409", async () => {
    const f = await fixture();
    await post(f.project.id, f.token, {
      receipt_id: f.receipt.id,
      status: "failed",
      exit_code: 1,
      duration_ms: 5,
    });
    const forged = await post(f.project.id, f.token, {
      receipt_id: f.receipt.id,
      status: "passed",
      exit_code: 0,
      duration_ms: 5,
    });
    expect(forged.status).toBe(409);
    expect(receiptView(await summaryOf(f.receipt.id)).checkRun.status).toBe("failed");
    expect(card(await summaryOf(f.receipt.id))).toContain("reported by your computer");
  });
});
