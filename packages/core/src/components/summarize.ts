import { createHash } from "node:crypto";
import type { ComponentIndex } from "../indexer";
import type { Llm } from "../llm";
import { maskSecretsIn } from "../mask";

export const MAX_SUMMARY = 200;
const CONCURRENCY = 4;

export type SummarizedComponent = ComponentIndex & {
  /** Hash of everything the summary is built from; a summary is regenerated only when it changes. */
  hash: string;
  summary: string | null;
};

/** What the previous index stored, keyed by componentKey(path, name). */
export type PreviousSummaries = Map<string, { hash: string; summary: string | null }>;

export function componentKey(path: string, name: string): string {
  return `${path}#${name}`;
}

// The summary sees metadata only (name, path, signature from the AST): the server never has the source.
export function componentHash(c: Pick<ComponentIndex, "path" | "name" | "signature">): string {
  return createHash("sha256").update(`${c.path}\n${c.name}\n${c.signature}`).digest("hex");
}

const SYSTEM =
  "You describe React components for a project map. Answer with one plain sentence under 200 characters: " +
  "what the component is for. No markdown, no code.";

function promptFor(c: ComponentIndex): string {
  return maskSecretsIn(`Component: ${c.name}\nFile: ${c.path}\nSignature: ${c.signature}`);
}

export function cleanSummary(text: string): string | null {
  const flat = maskSecretsIn(text.replace(/\s+/g, " ").trim());
  if (!flat) return null;
  return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY - 3)}...` : flat;
}

// Reuses the stored summary when the hash is unchanged; otherwise asks llm.complete. A failed call leaves the
// summary null, so the next index retries it.
export async function summarizeComponents(
  components: ComponentIndex[],
  llm: Llm,
  previous: PreviousSummaries = new Map(),
): Promise<SummarizedComponent[]> {
  const out: SummarizedComponent[] = components.map((c) => {
    const hash = componentHash(c);
    const prev = previous.get(componentKey(c.path, c.name));
    return { ...c, hash, summary: prev && prev.hash === hash ? prev.summary : null };
  });
  const todo = out.filter((c) => c.summary === null);
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const c = todo[next++] as SummarizedComponent;
      try {
        const text = await llm.complete({
          system: SYSTEM,
          prompt: promptFor(c),
          maxTokens: 100,
          purpose: "component-summary",
        });
        c.summary = cleanSummary(text);
      } catch {
        c.summary = null;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return out;
}
