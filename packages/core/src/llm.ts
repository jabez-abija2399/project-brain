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

// Metadata only: never the prompt or the answer, so no user code can reach a log.
export type LlmCostEntry = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  purpose: string;
};

export type LlmOptions = {
  model?: string;
  timeoutMs?: number;
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

export function createLlm(client: LlmClient, options: LlmOptions = {}): Llm {
  const model = options.model ?? DEFAULT_MODEL;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async complete(request) {
      const started = Date.now();
      const response = await client.messages.create(
        {
          model,
          max_tokens: Math.min(request.maxTokens ?? DEFAULT_MAX_TOKENS, DEFAULT_MAX_TOKENS),
          ...(request.system ? { system: request.system } : {}),
          messages: [{ role: "user", content: request.prompt }],
        },
        { timeout },
      );
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
