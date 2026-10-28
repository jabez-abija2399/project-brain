import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, type LlmClient, type LlmCostEntry, createLlm } from "./llm";

// Fake secrets are built at runtime so no secret-shaped literal sits in the source (docs/build-checklist.md rule 3).
const FAKE_ANTHROPIC_KEY = ["sk-", "ant-", "ABCDEFGHIJKLMNOPQRSTUV"].join("");

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

describe("llm.complete options", () => {
  it("caps max tokens at createLlm's maxTokens", async () => {
    const sent: number[] = [];
    const client: LlmClient = {
      messages: {
        async create(params) {
          sent.push(params.max_tokens);
          return { content: [] };
        },
      },
    };
    const llm = createLlm(client, { maxTokens: 50 });
    await llm.complete({ prompt: "a", purpose: "t" });
    await llm.complete({ prompt: "b", maxTokens: 200, purpose: "t" });
    await llm.complete({ prompt: "c", maxTokens: 20, purpose: "t" });
    expect(sent).toEqual([50, 50, 20]);
  });

  it("logs a failed call with model, purpose and error type only, then rethrows", async () => {
    const client: LlmClient = {
      messages: {
        async create() {
          throw Object.assign(new Error(`401 bad key ${FAKE_ANTHROPIC_KEY}`), {
            name: "AuthenticationError",
          });
        },
      },
    };
    const log: LlmCostEntry[] = [];
    const llm = createLlm(client, { log: (e) => log.push(e) });
    await expect(llm.complete({ prompt: "secret prompt", purpose: "t" })).rejects.toThrow();
    expect(log).toEqual([{ model: DEFAULT_MODEL, purpose: "t", error: "AuthenticationError" }]);
  });
});
