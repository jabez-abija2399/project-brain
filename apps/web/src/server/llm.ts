import Anthropic from "@anthropic-ai/sdk";
import { type Llm, type LlmClient, createLlm } from "@brain/core";

let cached: Llm | null = null;
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

// Test-only: inject a fake Llm (null = no AI configured). Pass undefined to restore the default.
export function setLlmForTests(llm: Llm | null | undefined) {
  override = llm;
}
