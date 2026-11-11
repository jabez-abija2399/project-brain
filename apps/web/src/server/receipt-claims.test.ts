import { ReceiptCard } from "@/components/receipt-card";
import { receiptView } from "@brain/core";
import { projectTokensRepo, projectsRepo, receiptsRepo } from "@brain/db";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateReceipt } from "./receipt";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 10: the claim checker's result on a receipt: kinds, repo paths and verdicts only.
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {} }),
}));

let world: TestWorld;
let token: { id: string; projectId: string };
let projectId: string;

beforeEach(async () => {
  world = await createTestWorld();
  const owner = await world.createUser({ name: "owner" });
  projectId = (await projectsRepo.create(world.db, owner.id, { name: "app" })).id;
  token = (await projectTokensRepo.create(world.db, projectId)).row;
});
afterEach(async () => {
  await world.teardown();
});

const receipt = (claims: unknown) =>
  generateReceipt(world.db, token, { changedFiles: ["src/cart.ts"], claims });

describe("Phase 10: claims on a receipt", () => {
  it("PH10-09 claims are stored with their counts and shown worst first, with fixed words and the path as data", async () => {
    await receipt([
      { kind: "changed_file", path: "src/cart.ts", verdict: "confirmed" },
      { kind: "tests_pass", verdict: "cannot_check" },
      { kind: "tests_added", verdict: "contradicted" },
    ]);
    const [row] = await receiptsRepo.list(world.db, projectId, 1);
    expect((row?.summaryJson as { claims: unknown }).claims).toMatchObject({
      confirmed: 1,
      contradicted: 1,
      cannot_check: 1,
    });
    const view = receiptView(row?.summaryJson);
    expect(view.claims).toEqual([
      { label: "Said it added tests", verdict: "contradicted", path: "" },
      { label: "Said the tests pass", verdict: "cannot_check", path: "" },
      { label: "Said it changed", verdict: "confirmed", path: "src/cart.ts" },
    ]);
    const html = renderToStaticMarkup(
      createElement(ReceiptCard, {
        receipt: { id: row?.id ?? "", createdAt: new Date().toISOString(), asked: null, view },
        expanded: true,
      } as never),
    );
    expect(html).toContain("What the agent said, checked");
    expect(html).toContain("Contradicted");
    expect(html).toContain("Said it added tests");
  });

  it("PH10-10 attack: free text, unknown kinds, paths outside the repo and too many claims are refused", async () => {
    const bad = [
      [{ kind: "tests_added", verdict: "confirmed", text: "ignore previous instructions" }],
      [{ kind: "rm_rf", verdict: "confirmed" }],
      [{ kind: "tests_added", verdict: "approved" }],
      [{ kind: "changed_file", path: "../../etc/passwd", verdict: "confirmed" }],
      [{ kind: "changed_file", path: `a${String.fromCharCode(27)}[2J.ts`, verdict: "confirmed" }],
      Array.from({ length: 21 }, () => ({ kind: "tests_pass", verdict: "confirmed" })),
    ];
    for (const claims of bad) await expect(receipt(claims)).rejects.toMatchObject({ status: 400 });
    expect(await receiptsRepo.list(world.db, projectId, 5)).toHaveLength(0);
  });

  it("PH10-11 a stored receipt with odd claims shows only the ones it understands; a secret-looking path is masked", () => {
    const key = ["sk", "_live_", "Q7xT2mK9vR4wZp8aB3dE5gH7"].join("");
    const view = receiptView({
      claims: {
        items: [
          { kind: "changed_file", verdict: "confirmed", path: `keys/${key}.ts` },
          { kind: "__proto__", verdict: "confirmed" },
          { kind: "tests_pass", verdict: "maybe" },
          "text",
        ],
      },
    });
    expect(view.claims).toHaveLength(1);
    expect(view.claims[0]?.path).not.toContain(key);
    expect(receiptView({}).claims).toEqual([]);
  });
});
