import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, type LlmClient, type LlmCostEntry, createLlm } from "./llm";

describe("llm.complete", () => {
  it("sends model, capped max tokens and timeout; logs cost without prompt or answer text", async () => {
    const calls: { params: unknown; options: unknown }[] = [];
    const client: LlmClient = {
      messages: {
        async create(params, options) {
          calls.push({ params, options });
          return {
            content: [
              { type: "text", text: " secret-free " },
              { type: "tool_use" },
              { type: "text", text: "answer " },
            ],
            usage: { input_tokens: 12, output_tokens: 3 },
          };
        },
      },
    };
    const log: LlmCostEntry[] = [];
    const llm = createLlm(client, { timeoutMs: 5000, log: (e) => log.push(e) });

    const text = await llm.complete({ prompt: "hello", maxTokens: 10_000, purpose: "test" });

    expect(text).toBe("secret-free answer");
    expect(calls).toEqual([
      {
        params: {
          model: DEFAULT_MODEL,
          max_tokens: 300,
          messages: [{ role: "user", content: "hello" }],
        },
        options: { timeout: 5000 },
      },
    ]);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      model: DEFAULT_MODEL,
      inputTokens: 12,
      outputTokens: 3,
      purpose: "test",
    });
    expect(Object.keys(log[0] ?? {}).sort()).toEqual([
      "inputTokens",
      "model",
      "ms",
      "outputTokens",
      "purpose",
    ]);
  });
});
