import { describe, expect, it } from "vitest";
import { type LlmClient, createLlm } from "../llm";
import {
  MAX_ATTEMPTS,
  type PreviousSummaries,
  componentHash,
  componentKey,
  summarizeComponents,
} from "./summarize";

const button = {
  name: "Button",
  path: "src/components/ui/Button.tsx",
  line: 1,
  props: null,
  signature: "({ label }) => JSX",
};
const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ...button, name: `Widget${i}` }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// answer(n) for the n-th call (1-based): a string, or throws.
function scriptedClient(answer: (n: number) => Promise<string>) {
  let calls = 0;
  let inFlight = 0;
  const startedWith: number[] = [];
  const client: LlmClient = {
    messages: {
      async create() {
        const n = ++calls;
        startedWith.push(++inFlight);
        try {
          return { content: [{ type: "text", text: await answer(n) }] };
        } finally {
          inFlight--;
        }
      },
    },
  };
  return { client, calls: () => calls, startedWith };
}

function exhausted(name: string): PreviousSummaries {
  const c = { ...button, name };
  return new Map([
    [
      componentKey(c.path, c.name),
      {
        hash: componentHash(c),
        summary: null,
        summaryStatus: "error" as const,
        summaryAttempts: MAX_ATTEMPTS,
        summaryAttemptedAt: new Date("2026-10-01T00:00:00Z"),
      },
    ],
  ]);
}

describe("FEAT-008 summarize scheduling (FEAT-007 review N1, fresh attempts)", () => {
  it("N1 workers resume after a success: a few early failures never reduce the 4 parallel calls", async () => {
    // Calls 1-3 fail at once; every other call succeeds after a short wait.
    const fake = scriptedClient(async (n) => {
      if (n <= 3) throw new Error("flaky");
      await sleep(5);
      return "Renders a widget.";
    });
    const rows = await summarizeComponents(many(40), createLlm(fake.client));
    expect(fake.calls()).toBe(40);
    expect(rows.filter((c) => c.summaryStatus === "ok")).toHaveLength(37);
    // After the first successes the pool is back to 4 calls at a time.
    expect(Math.max(...fake.startedWith.slice(10))).toBe(4);
  });

  it("after a success in the run, a component that used up its 3 attempts gets one fresh attempt", async () => {
    const fake = scriptedClient(async () => "Renders a widget.");
    const old = { ...button, name: "Old" };
    const rows = await summarizeComponents([old, button], createLlm(fake.client), exhausted("Old"));
    expect(fake.calls()).toBe(2);
    expect(rows.find((c) => c.name === "Old")).toMatchObject({
      summaryStatus: "ok",
      summary: "Renders a widget.",
      summaryAttempts: MAX_ATTEMPTS + 1,
    });
  });

  it("the fresh attempt is given once: no success in the run means no call, and a 4th failure is final", async () => {
    const old = { ...button, name: "Old" };
    const previous = exhausted("Old");

    // Nothing else succeeds in this run: the exhausted component is not sent.
    const idle = scriptedClient(async () => "Renders a widget.");
    await summarizeComponents([old], createLlm(idle.client), previous);
    expect(idle.calls()).toBe(0);

    // A success (Button) unlocks one fresh attempt for Old, which fails again.
    const fake = scriptedClient(async (n) => {
      if (n === 1) return "Renders a button.";
      throw new Error("still broken");
    });
    let rows = await summarizeComponents([button, old], createLlm(fake.client), previous, {
      now: new Date("2026-10-28T00:00:00Z"),
    });
    expect(fake.calls()).toBe(2);
    expect(rows.find((c) => c.name === "Old")).toMatchObject({
      summaryStatus: "error",
      summaryAttempts: MAX_ATTEMPTS + 1,
    });
    const next: PreviousSummaries = new Map(rows.map((c) => [componentKey(c.path, c.name), c]));
    const later = scriptedClient(async () => "Renders a widget.");
    rows = await summarizeComponents(
      [old, { ...button, name: "New" }],
      createLlm(later.client),
      next,
      {
        now: new Date("2026-11-28T00:00:00Z"),
      },
    );
    expect(later.calls()).toBe(1);
    expect(rows.find((c) => c.name === "Old")?.summaryAttempts).toBe(MAX_ATTEMPTS + 1);
  });

  it("maxCalls bounds the calls in one run and leaves the rest for the next run", async () => {
    const fake = scriptedClient(async () => "Renders a widget.");
    const rows = await summarizeComponents(many(10), createLlm(fake.client), new Map(), {
      maxCalls: 3,
    });
    expect(fake.calls()).toBe(3);
    expect(rows.filter((c) => c.summaryStatus === null && c.summaryAttempts === 0)).toHaveLength(7);
  });
});
