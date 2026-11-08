import { and, asc, eq, inArray } from "drizzle-orm";
import type { BrainDb } from "../db";
import { criteria, featureFiles, features, files, symbols } from "../schema";

// One row past the cap tells whether the read was cut off.
const cut = <T>(rows: T[], cap: number) => ({
  rows: rows.slice(0, cap),
  truncated: rows.length > cap,
});

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
        .limit(DISCOVER_MAX_FEATURES + 1),
      db
        .select({ featureId: featureFiles.featureId, path: files.path })
        .from(featureFiles)
        .innerJoin(
          files,
          and(eq(files.projectId, featureFiles.projectId), eq(files.id, featureFiles.fileId)),
        )
        .where(eq(featureFiles.projectId, projectId))
        .orderBy(asc(files.path))
        .limit(DISCOVER_MAX_ROWS + 1),
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
        .orderBy(asc(symbols.id))
        .limit(DISCOVER_MAX_ROWS + 1),
      db
        .select({ featureId: criteria.featureId, kind: criteria.kind, status: criteria.status })
        .from(criteria)
        .where(eq(criteria.projectId, projectId))
        .orderBy(asc(criteria.id))
        .limit(DISCOVER_MAX_ROWS + 1),
    ]);
    const parts = [
      cut(featureRows, DISCOVER_MAX_FEATURES),
      cut(fileRows, DISCOVER_MAX_ROWS),
      cut(symbolRows, DISCOVER_MAX_ROWS),
      cut(criteriaRows, DISCOVER_MAX_ROWS),
    ] as const;
    return {
      features: parts[0].rows,
      files: parts[1].rows,
      symbols: parts[2].rows,
      criteria: parts[3].rows,
      truncated: parts.some((p) => p.truncated),
    };
  },
};
