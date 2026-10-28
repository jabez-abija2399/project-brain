// The only LLM entry (AGENTS.md): model, timeout, max tokens and a cost log in one place.
// Core makes no network calls itself: the caller passes the client (the Anthropic SDK client fits this shape).

export type LlmClient = {
  messages: {
    create(
      params: {
        model: string;
        max_tokens: number;
        system?: string;
        messages: { role: "user"; content: string }[];
      },
      options?: { timeout?: number },
    ): Promise<{
      content: { type: string; text?: string }[];
      usage?: { input_tokens: number; output_tokens: number };
    }>;
  };
};

// Metadata only: never the prompt, the answer or an error message, so no user code can reach a log.
export type LlmCostEntry =
  | { model: string; inputTokens: number; outputTokens: number; ms: number; purpose: string }
  | { model: string; purpose: string; error: string };

export type LlmOptions = {
  model?: string;
  timeoutMs?: number;
  /** Upper bound for every request (default and never above DEFAULT_MAX_TOKENS). */
  maxTokens?: number;
  log?: (entry: LlmCostEntry) => void;
};

export type CompleteRequest = {
  prompt: string;
  system?: string;
  maxTokens?: number;
  /** Short label for the cost log, e.g. "component-summary". */
  purpose: string;
};

export type Llm = { complete(request: CompleteRequest): Promise<string> };

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_TOKENS = 300;

// Only the error's class name (e.g. "RateLimitError"): its message may quote the request.
export function errorType(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  return /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(name) ? name : "Error";
}

export function createLlm(client: LlmClient, options: LlmOptions = {}): Llm {
  const model = options.model ?? DEFAULT_MODEL;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cap = Math.min(options.maxTokens ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS);
  return {
    async complete(request) {
      const started = Date.now();
      let response: Awaited<ReturnType<LlmClient["messages"]["create"]>>;
      try {
        response = await client.messages.create(
          {
            model,
            max_tokens: Math.min(request.maxTokens ?? cap, cap),
            ...(request.system ? { system: request.system } : {}),
            messages: [{ role: "user", content: request.prompt }],
          },
          { timeout },
        );
      } catch (err) {
        options.log?.({ model, purpose: request.purpose, error: errorType(err) });
        throw err;
      }
      options.log?.({
        model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        ms: Date.now() - started,
        purpose: request.purpose,
      });
      return response.content
        .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
        .join("")
        .trim();
    },
  };
}
