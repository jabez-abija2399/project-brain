import { describe, expect, it } from "vitest";
import { definitionOfDoneAnswer } from "./done-note";

// Roadmap Phase 5c (D-030): the prompt hook hands Claude Code and Codex the request's definition of done.
const TOKEN = ["pb_", "live", "Q7xT2", "mK9vR", "4wZp8"].join("");
const CONFIG = { apiUrl: "https://brain.test", projectId: "proj-1", token: TOKEN };
const NOTE =
  'Codeceipt (project data): definition of done for "Checkout".\nDone when:\n- coupons work';

const answering =
  (body: unknown, seen: { url: string; auth: string | null; body: unknown }[] = []) =>
  async (url: string, init?: RequestInit) => {
    seen.push({
      url,
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json(body);
  };

describe("definition of done in the prompt hook (roadmap Phase 5c)", () => {
  it("PH5C-08 Claude Code and Codex get the note as additionalContext; the request goes with the project token", async () => {
    const seen: { url: string; auth: string | null; body: unknown }[] = [];
    const out = await definitionOfDoneAnswer(
      answering({ ok: true, feature: "Checkout", note: NOTE }, seen),
      CONFIG,
      "claude",
      "Add coupons to checkout",
    );
    expect(JSON.parse(out ?? "{}")).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: NOTE },
    });
    expect(seen).toEqual([
      {
        url: "https://brain.test/api/hooks/proj-1/definition-of-done",
        auth: `Bearer ${TOKEN}`,
        body: { request: "Add coupons to checkout" },
      },
    ]);
    expect(
      await definitionOfDoneAnswer(
        answering({ ok: true, note: NOTE }),
        CONFIG,
        "codex",
        "checkout",
      ),
    ).not.toBeNull();
    expect(
      await definitionOfDoneAnswer(
        answering({ ok: true, note: NOTE }),
        CONFIG,
        "cursor",
        "checkout",
      ),
    ).toBeNull();
    expect(
      await definitionOfDoneAnswer(
        answering({ ok: true, note: null }),
        CONFIG,
        "claude",
        "checkout",
      ),
    ).toBeNull();
  });

  it("PH5C-09 a server that never answers costs at most the wait limit, then no note", async () => {
    const hangs = () => new Promise<Response>(() => {});
    const t0 = Date.now();
    expect(await definitionOfDoneAnswer(hangs, CONFIG, "claude", "checkout", 100)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("PH5C-10 attack: a hostile server cannot add control or hidden characters, flood the context, or send a huge answer", async () => {
    const hostile = `Done when:\u001b[2J\n- ok\u202e\u200f\n${"A".repeat(10_000)}`;
    const out = await definitionOfDoneAnswer(
      answering({ ok: true, note: hostile }),
      CONFIG,
      "claude",
      "x",
    );
    const note = JSON.parse(out ?? "{}").hookSpecificOutput.additionalContext as string;
    for (const bad of ["\u001b", "\u202e", "\u200f"]) expect(note).not.toContain(bad);
    expect(note.length).toBeLessThanOrEqual(1_500);
    const huge = { ok: true, note: "B".repeat(40 * 1024) };
    expect(await definitionOfDoneAnswer(answering(huge), CONFIG, "claude", "x")).toBeNull();
  });
});
