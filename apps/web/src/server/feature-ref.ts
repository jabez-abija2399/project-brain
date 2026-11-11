import { maskSecretsIn } from "@brain/core";
import { type BrainDb, type Feature, featuresRepo } from "@brain/db";
import { AppError } from "./errors";

// Dogfooding (edutech): a tool that takes a feature accepts it exactly as list_features and where_did_we_stop show
// it: the name, the key, or the id. Only the token's own project is searched, so another project's id is "not found".
const MAX_LISTED = 50;

/** A wrong feature: the error lists this project's feature names, so the agent can pick a valid one. */
export class FeatureNotFoundError extends AppError {
  constructor(
    readonly ref: string,
    readonly valid: string[],
  ) {
    super(404, "feature_not_found");
  }
}

export async function resolveFeature(
  db: BrainDb,
  projectId: string,
  ref: string,
): Promise<Feature> {
  // Automatic features' keys start with "@": such a ref is looked up as a key first, so a feature someone named
  // "@home" cannot take the place of the automatic feature with that key (backlog, D-023 review).
  const byKey = async () => (await featuresRepo.byKeys(db, projectId, [ref]))[0] ?? null;
  const found =
    (await featuresRepo.byId(db, projectId, ref)) ??
    (ref.startsWith("@") ? await byKey() : null) ??
    (await featuresRepo.byName(db, projectId, ref)) ??
    (await byKey());
  if (found) return found;
  const { features } = await featuresRepo.listSummaries(db, projectId, MAX_LISTED);
  throw new FeatureNotFoundError(
    ref,
    features.map((f) => maskSecretsIn(f.name)).sort((a, b) => a.localeCompare(b)),
  );
}
