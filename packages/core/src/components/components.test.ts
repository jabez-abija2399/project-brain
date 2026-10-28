import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { indexRepo } from "../indexer";
import { type LlmClient, createLlm } from "../llm";
import { findSimilarComponent } from "./similar";
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
