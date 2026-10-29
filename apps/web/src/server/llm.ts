import Anthropic from "@anthropic-ai/sdk";
import { type Llm, type LlmClient, MAX_TOKENS_CEILING, createLlm } from "@brain/core";

let cached: Llm | null = null;
let cachedPlanner: Llm | null = null;
let override: Llm | null | undefined;

// The server's only LLM (core llm.complete with the Anthropic client); null when ANTHROPIC_API_KEY is not set,
// so indexing still works and summaries wait for a later run. The cost log carries metadata only.
export function getLlm(): Llm | null {
  if (override !== undefined) return override;
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  cached = createLlm(new Anthropic({ apiKey }) as unknown as LlmClient, {
    log: (entry) => console.info("[llm]", JSON.stringify(entry)),
  });
  return cached;
}

// FEAT-019: the same client allowed longer answers (a draft plan) and a 25 s call limit; null when AI is not set up.
export function getPlanningLlm(): Llm | null {
  if (override !== undefined) return override;
  if (cachedPlanner) return cachedPlanner;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  cachedPlanner = createLlm(new Anthropic({ apiKey }) as unknown as LlmClient, {
    maxTokens: MAX_TOKENS_CEILING,
    timeoutMs: 25_000,
    log: (entry) => console.info("[llm]", JSON.stringify(entry)),
  });
  return cachedPlanner;
}

// Test-only: inject a fake Llm (null = no AI configured). Pass undefined to restore the default.
export function setLlmForTests(llm: Llm | null | undefined) {
  override = llm;
}
