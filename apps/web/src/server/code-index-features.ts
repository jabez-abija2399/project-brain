import { groupFeatures } from "@brain/core";
import { type BrainDb, codeIndexRepo, featuresRepo } from "@brain/db";

/**
 * FEAT-006 wire-in, the CLI index step after the uploads: groups every stored file of the project by its stored
 * imports and route symbols and saves the map (features matched by key, so user renames and moves are kept).
 * Reads only the database: paths, imports and route URLs, never source.
 */
export async function groupProject(
  db: BrainDb,
  projectId: string,
): Promise<{ features: number; shared: number }> {
  const input = await codeIndexRepo.groupingInput(db, projectId);
  const files = input.files.map((f) => ({
    path: f.path,
    imports: f.imports.map((resolved) => ({ resolved })),
  }));
  const map = groupFeatures(files, input.routes);
  await featuresRepo.saveMap(db, projectId, map);
  return { features: map.features.length, shared: map.shared.length };
}
