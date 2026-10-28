import {
  type SimilarOptions,
  findSimilarComponent,
  maskSecretsIn,
  similarNameFilter,
} from "@brain/core";
import { type BrainDb, symbolsRepo } from "@brain/db";

export type SimilarComponent = {
  name: string;
  path: string;
  signature: string | null;
  summary: string | null;
  score: number;
};

// DB read + lexical scoring only, never an LLM (MCP read-tool rule). The caller has already run
// requireProjectAccess for projectId; this function never takes a project id from a client directly.
export async function findSimilarComponents(
  db: BrainDb,
  projectId: string,
  query: string,
  options: SimilarOptions = {},
): Promise<SimilarComponent[]> {
  const components = await symbolsRepo.listComponents(db, projectId, {
    nameContainsAny: similarNameFilter(query, options),
  });
  // Masked before it leaves the server (AGENTS.md): a stored path or summary may carry a secret.
  const mask = (value: string | null) => (value === null ? null : maskSecretsIn(value));
  return findSimilarComponent(query, components, options).map(({ component, score }) => ({
    name: maskSecretsIn(component.name),
    path: maskSecretsIn(component.path),
    signature: mask(component.signature),
    summary: mask(component.summary),
    score,
  }));
}
