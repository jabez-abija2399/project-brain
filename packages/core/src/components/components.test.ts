import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexRepo } from "../indexer";
import { DEFAULT_MODEL, type LlmClient, createLlm } from "../llm";
import { findSimilarComponent, nameTokens, similarNameFilter } from "./similar";
import {
  MAX_SUMMARY,
  type PreviousSummaries,
  componentKey,
  summarizeComponents,
} from "./summarize";

const fixtureRoot = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../..",
  "tests/fixtures/component-app",
);

// A fake Anthropic-shaped client: records every prompt and answers with a long sentence (over 200 chars).
function fakeClient() {
  const prompts: string[] = [];
  const client: LlmClient = {
    messages: {
      async create(params) {
        prompts.push(params.messages[0]?.content ?? "");
        return {
          content: [{ type: "text", text: `Renders a widget. ${"x".repeat(300)}` }],
          usage: { input_tokens: 10, output_tokens: 80 },
        };
      },
    },
  };
  return { client, prompts };
}

describe("FEAT-007 component registry", () => {
  it("AC-007-01 every indexed component gets a summary of at most 200 characters through llm.complete", async () => {
    const index = await indexRepo(fixtureRoot);
    const { client, prompts } = fakeClient();
    const costs: string[] = [];
    const llm = createLlm(client, { log: (e) => costs.push(e.purpose) });

    const result = await summarizeComponents(index.components, llm);

    expect(index.components.map((c) => c.name).sort()).toEqual([
      "Button",
      "HomePage",
      "PlanPicker",
      "ReviewCard",
      "StarRating",
      "TextInput",
    ]);
    expect(result).toHaveLength(6);
    expect(prompts).toHaveLength(6);
    expect(costs).toEqual(Array(6).fill("component-summary"));
    for (const c of result) {
      expect(c.summary).toMatch(/^Renders a widget\. x+\.\.\.$/);
      expect(c.summary?.length).toBe(MAX_SUMMARY);
    }
    // The prompt carries metadata only, never the component body.
    expect(prompts.some((p) => p.includes("radiogroup") || p.includes("aria-checked"))).toBe(false);
  });

  it("AC-007-02 findSimilarComponent('StarRatingInput') returns StarRating as the top match", async () => {
    const index = await indexRepo(fixtureRoot);
    const matches = findSimilarComponent("StarRatingInput", index.components);
    expect(matches[0]?.component.name).toBe("StarRating");
    expect(matches[0]?.component.path).toBe("src/components/reviews/StarRating.tsx");
    expect(matches.map((m) => m.component.name)).toEqual(["StarRating"]);
  });

  it("AC-007-03 a query with no match above the threshold returns [], not the closest unrelated component", async () => {
    const index = await indexRepo(fixtureRoot);
    const query = "PasswordStrengthInputField";
    // There is a closest component (TextInput shares "input")...
    const closest = findSimilarComponent(query, index.components, { threshold: 0 });
    expect(closest[0]?.component.name).toBe("TextInput");
    // ...but it is below the threshold, so the lookup returns nothing.
    expect(findSimilarComponent(query, index.components)).toEqual([]);
    expect(findSimilarComponent("ZzzUnknownThing", index.components)).toEqual([]);
    expect(findSimilarComponent("", index.components)).toEqual([]);
  });

  it("AC-007-04 only new or changed components are summarized; an unchanged re-index makes 0 LLM calls", async () => {
    const first = await indexRepo(fixtureRoot);
    const one = fakeClient();
    const stored = await summarizeComponents(first.components, createLlm(one.client));
    expect(one.prompts).toHaveLength(6);

    const previous: PreviousSummaries = new Map(
      stored.map((c) => [componentKey(c.path, c.name), { hash: c.hash, summary: c.summary }]),
    );
    const again = await indexRepo(fixtureRoot);
    const two = fakeClient();
    const second = await summarizeComponents(again.components, createLlm(two.client), previous);
    expect(two.prompts).toHaveLength(0);
    expect(second.map((c) => c.summary)).toEqual(stored.map((c) => c.summary));

    // One changed signature and one new component: exactly 2 calls.
    const changed = again.components.map((c) =>
      c.name === "Button" ? { ...c, signature: "({ label, variant }) => JSX" } : c,
    );
    changed.push({
      name: "Badge",
      path: "src/components/ui/Badge.tsx",
      line: 1,
      props: null,
      signature: "() => JSX",
    });
    const three = fakeClient();
    await summarizeComponents(changed, createLlm(three.client), previous);
    expect(three.prompts).toHaveLength(2);
    expect(three.prompts[0]).toContain("Component: Button");
    expect(three.prompts[1]).toContain("Component: Badge");
  });
});

// Review fixes (agent/reviews/FEAT-007.md M1, L1, L3).
describe("FEAT-007 summary attempts", () => {
  const button = {
    name: "Button",
    path: "src/components/ui/Button.tsx",
    line: 1,
    props: null,
    signature: "({ label }) => JSX",
  };
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...button, name: `Widget${i}` }));

  function scriptedClient(answer: () => Promise<string>) {
    let calls = 0;
    const client: LlmClient = {
      messages: {
        async create() {
          calls++;
          return { content: [{ type: "text", text: await answer() }] };
        },
      },
    };
    return { client, calls: () => calls };
  }
  const asPrevious = (rows: Awaited<ReturnType<typeof summarizeComponents>>): PreviousSummaries =>
    new Map(rows.map((c) => [componentKey(c.path, c.name), c]));

  it("AC-007-04 an empty answer is recorded; three unchanged re-indexes make 0 LLM calls", async () => {
    const fake = scriptedClient(async () => "   ");
    const llm = createLlm(fake.client);
    let rows = await summarizeComponents([button], llm);
    expect(fake.calls()).toBe(1);
    expect(rows[0]).toMatchObject({ summary: null, summaryStatus: "empty", summaryAttempts: 1 });
    for (let day = 1; day <= 3; day++) {
      const now = new Date(Date.now() + day * 48 * 3600_000);
      rows = await summarizeComponents([button], llm, asPrevious(rows), { now });
    }
    expect(fake.calls()).toBe(1);
  });

  it("AC-007-04 a failed summary retries at most once per 24 h and at most 3 times per hash", async () => {
    const fake = scriptedClient(async () => {
      throw new Error("overloaded");
    });
    const llm = createLlm(fake.client);
    const t0 = Date.parse("2026-10-28T00:00:00Z");
    const at = (hours: number) => ({ now: new Date(t0 + hours * 3600_000) });
    let rows = await summarizeComponents([button], llm, new Map(), at(0));
    expect(rows[0]).toMatchObject({ summary: null, summaryStatus: "error", summaryAttempts: 1 });
    rows = await summarizeComponents([button], llm, asPrevious(rows), at(23));
    expect(fake.calls()).toBe(1);
    rows = await summarizeComponents([button], llm, asPrevious(rows), at(24));
    rows = await summarizeComponents([button], llm, asPrevious(rows), at(48));
    expect(fake.calls()).toBe(3);
    expect(rows[0]?.summaryAttempts).toBe(3);
    rows = await summarizeComponents([button], llm, asPrevious(rows), at(24 * 30));
    expect(fake.calls()).toBe(3);
    // A changed signature is a new hash: attempts start again.
    const changed = { ...button, signature: "({ label, size }) => JSX" };
    rows = await summarizeComponents([changed], llm, asPrevious(rows), at(24 * 30));
    expect(fake.calls()).toBe(4);
    expect(rows[0]?.summaryAttempts).toBe(1);
  });

  it("AC-007-04 an outage stops the batch after 5 errors in a row and logs each failure without the prompt", async () => {
    const fake = scriptedClient(async () => {
      throw Object.assign(new Error("connect ECONNREFUSED sk-ant-ABCDEFGHIJKLMNOPQRSTUV"), {
        name: "APIConnectionError",
      });
    });
    const log: unknown[] = [];
    const llm = createLlm(fake.client, { log: (e) => log.push(e) });
    const rows = await summarizeComponents(many(40), llm);
    expect(fake.calls()).toBe(5);
    expect(rows.filter((c) => c.summaryStatus === "error")).toHaveLength(5);
    // Not attempted: no attempt recorded, so the next index tries them.
    expect(rows.filter((c) => c.summaryStatus === null && c.summaryAttempts === 0)).toHaveLength(
      35,
    );
    expect(log).toEqual(
      Array(5).fill({
        model: DEFAULT_MODEL,
        purpose: "component-summary",
        error: "APIConnectionError",
      }),
    );
  });

  it("an error streak is broken by a success", async () => {
    let n = 0;
    const fake = scriptedClient(async () => {
      n++;
      if (n % 4 === 0) return "Renders a widget.";
      throw new Error("flaky");
    });
    const rows = await summarizeComponents(many(20), createLlm(fake.client));
    expect(fake.calls()).toBe(20);
    expect(rows.filter((c) => c.summaryStatus === "ok")).toHaveLength(5);
  });

  it("AC-007-01 secrets in the path, signature and AI answer are masked", async () => {
    const prompts: string[] = [];
    const client: LlmClient = {
      messages: {
        async create(params) {
          prompts.push(params.messages[0]?.content ?? "");
          return {
            content: [
              {
                type: "text",
                text: "Uses sk-ant-ABCDEFGHIJKLMNOPQRSTUV and password=hunter22 to log in.",
              },
            ],
          };
        },
      },
    };
    // Built at runtime so secret scanners do not flag a fake key in the source; the value is unchanged.
    const fakeAwsKey = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
    const leaky = {
      ...button,
      path: "src/ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123/Button.tsx",
      signature: `({ apiKey = '${fakeAwsKey}' }) => JSX`,
    };
    const [row] = await summarizeComponents([leaky], createLlm(client));
    expect(prompts[0]).toContain("ghp_***");
    expect(prompts[0]).toContain("AKIA***");
    expect(prompts[0]).not.toMatch(/ABCDEFGHIJKLMNOP/);
    expect(row?.summary).toBe("Uses sk-a*** and password=hunt*** to log in.");
  });
});

describe("FEAT-007 name filter and scoring use the same words", () => {
  it("AC-007-05 a long query scores only the words the database pre-filter sends", () => {
    const words = Array.from({ length: 25 }, (_, i) => `Word${String.fromCharCode(97 + i)}`);
    const query = words.join("");
    const filter = similarNameFilter(query) ?? [];
    expect(filter).toHaveLength(20);
    // Shares words 21-25 by name and the rest by path: the old scoring passed it, the pre-filter dropped it.
    const candidate = {
      name: words.slice(20).join(""),
      path: `src/${words.slice(0, 20).join("/")}.tsx`,
    };
    expect(nameTokens(candidate.name).some((t) => filter.includes(t))).toBe(false);
    expect(findSimilarComponent(query, [candidate])).toEqual([]);
  });
});
