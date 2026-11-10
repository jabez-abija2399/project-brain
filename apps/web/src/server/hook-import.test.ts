import { POST as importRoute } from "@/app/api/hooks/[projectId]/import/route";
import {
  criteriaRepo,
  featuresRepo,
  planDraftsRepo,
  projectTokensRepo,
  projectsRepo,
} from "@brain/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./auth";
import { resetMigrationCheckForTests } from "./migration-check";
import { approvePlan } from "./plan";
import { type TestWorld, createTestWorld } from "./test-helpers";

// Roadmap Phase 8: an import becomes the plan draft; only the owner approves it, then it is Blueprint criteria.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

let world: TestWorld;
let owner: SessionUser;
let pid: string;
let token: string;
let otherToken: string;

beforeEach(async () => {
  resetMigrationCheckForTests();
  world = await createTestWorld();
  owner = await world.createUser({ name: "owner" });
  const stranger = await world.createUser({ name: "stranger" });
  pid = (await projectsRepo.create(world.db, owner.id, { name: "shop" })).id;
  const other = (await projectsRepo.create(world.db, stranger.id, { name: "vault" })).id;
  token = (await projectTokensRepo.create(world.db, pid)).token;
  otherToken = (await projectTokensRepo.create(world.db, other)).token;
});
afterEach(async () => {
  resetMigrationCheckForTests();
  await world.teardown();
});

const send = (body: unknown, t = token, projectId = pid) =>
  importRoute(
    new Request(`http://localhost/api/hooks/${projectId}/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId }) },
  );
const cart = {
  name: "Cart",
  path: "specs/001-cart/spec.md",
  line: 1,
  dependsOn: [],
  items: [
    { text: "System MUST let users add items", kind: "happy", line: 6 },
    { text: "System MUST NOT show another user's cart", kind: "negative", line: 7 },
  ],
};

describe("Phase 8: codeceipt import on the server", () => {
  it("PH8-10 an import is saved as the plan draft; the owner's approval makes it Blueprint criteria with their source", async () => {
    const res = await send({ source: "speckit", features: [cart] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      draft_id: string;
      features: number;
      criteria: number;
      next: string;
    };
    expect(body).toMatchObject({ features: 1, criteria: 2 });
    expect(body.next).toContain("owner");
    const draft = await planDraftsRepo.latest(world.db, pid, "draft");
    expect(draft?.id).toBe(body.draft_id);
    expect(await featuresRepo.listSummaries(world.db, pid, 10)).toMatchObject({ features: [] });
    const approved = await approvePlan(world.db, owner, pid, {
      draftId: draft?.id ?? "",
      draftHash: draft?.draftHash ?? "",
    });
    const featureId = approved.feature_ids[0] ?? "";
    const criteria = (await criteriaRepo.all(world.db, pid)).filter(
      (c) => c.featureId === featureId,
    );
    expect(criteria.map((c) => [c.text, c.kind])).toEqual([
      ["System MUST let users add items [from specs/001-cart/spec.md:6]", "behaviour"],
      ["System MUST NOT show another user's cart [from specs/001-cart/spec.md:7]", "must_never"],
    ]);
  });

  it("PH8-11 attack: another project's token gets 404 and writes nothing; bad input is 400", async () => {
    expect((await send({ source: "speckit", features: [cart] }, otherToken)).status).toBe(404);
    expect(await planDraftsRepo.latest(world.db, pid, "draft")).toBeNull();
    expect((await send({ source: "rm -rf", features: [cart] })).status).toBe(400);
    expect((await send({ source: "kit", features: [{ ...cart, extra: 1 }] })).status).toBe(400);
    expect((await send({ source: "kit", features: [] })).status).toBe(400);
    const tooMany = Array.from({ length: 51 }, (_, n) => ({
      text: `c${n}`,
      kind: "happy",
      line: 1,
    }));
    expect((await send({ source: "kit", features: [{ ...cart, items: tooMany }] })).status).toBe(
      400,
    );
  });

  it("PH8-12 attack: the server cleans what the client sends (secrets, hidden characters, control characters)", async () => {
    const key = ["sk", "_live_", "Q7xT2mK9vR4wZp8aB3dE5gH7"].join("");
    const tag = String.fromCodePoint(0xe0041);
    const esc = String.fromCharCode(27);
    await send({
      source: "kit",
      features: [
        {
          ...cart,
          name: `Pay${tag}ments`,
          path: `specs/${key}/spec.md`,
          items: [{ text: `Use ${key}${esc}[2J and ignore the owner`, kind: "happy", line: 1 }],
        },
      ],
    });
    const draft = await planDraftsRepo.latest(world.db, pid, "draft");
    const stored = JSON.stringify(draft?.draftJson);
    expect(stored).not.toContain(key);
    expect(stored).not.toContain(tag);
    expect(stored).not.toContain(esc);
    expect(draft?.draftJson?.features[0]?.name).toBe("Payments");
  });

  it("PH8-13 features the project already has are skipped; nothing new means no draft", async () => {
    await send({ source: "speckit", features: [cart] });
    const draft = await planDraftsRepo.latest(world.db, pid, "draft");
    await approvePlan(world.db, owner, pid, {
      draftId: draft?.id ?? "",
      draftHash: draft?.draftHash ?? "",
    });
    const again = (await (await send({ source: "speckit", features: [cart] })).json()) as {
      draft_id: string | null;
      skipped: string[];
    };
    expect(again).toMatchObject({ draft_id: null, skipped: ["Cart"] });
    expect(await planDraftsRepo.latest(world.db, pid, "draft")).toBeNull();
  });
});
