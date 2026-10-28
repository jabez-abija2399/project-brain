import { type SimilarOptions, findSimilarComponent, similarNameFilter } from "@brain/core";
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
  return findSimilarComponent(query, components, options).map(({ component, score }) => ({
    name: component.name,
    path: component.path,
    signature: component.signature,
    summary: component.summary,
    score,
  }));
}
