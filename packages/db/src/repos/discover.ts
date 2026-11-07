import { and, asc, eq, inArray } from "drizzle-orm";
import type { BrainDb } from "../db";
import { criteria, featureFiles, features, files, symbols } from "../schema";

// Roadmap Phase 3b: what Discover reads from the index, for one project, in five bounded queries. Paths, names and
// statuses only: never source code.
export const DISCOVER_MAX_FEATURES = 500;
export const DISCOVER_MAX_ROWS = 20_000;

export const discoverRepo = {
  async input(db: BrainDb, projectId: string) {
    const [featureRows, fileRows, symbolRows, criteriaRows] = await Promise.all([
      db
        .select({
          id: features.id,
          key: features.key,
          name: features.name,
          purpose: features.description,
          status: features.status,
          buildOrder: features.buildOrder,
        })
        .from(features)
        .where(eq(features.projectId, projectId))
        .orderBy(asc(features.createdAt), asc(features.id))
        .limit(DISCOVER_MAX_FEATURES),
      db
        .select({ featureId: featureFiles.featureId, path: files.path })
        .from(featureFiles)
        .innerJoin(
          files,
          and(eq(files.projectId, featureFiles.projectId), eq(files.id, featureFiles.fileId)),
        )
        .where(eq(featureFiles.projectId, projectId))
        .limit(DISCOVER_MAX_ROWS),
      db
        .select({
          path: files.path,
          kind: symbols.kind,
          name: symbols.name,
          signature: symbols.signature,
        })
        .from(symbols)
        .innerJoin(files, and(eq(files.projectId, symbols.projectId), eq(files.id, symbols.fileId)))
        .where(and(eq(symbols.projectId, projectId), inArray(symbols.kind, ["route", "component"])))
        .limit(DISCOVER_MAX_ROWS),
      db
        .select({ featureId: criteria.featureId, kind: criteria.kind, status: criteria.status })
        .from(criteria)
        .where(eq(criteria.projectId, projectId))
        .limit(DISCOVER_MAX_ROWS),
    ]);
    return { features: featureRows, files: fileRows, symbols: symbolRows, criteria: criteriaRows };
  },
};
