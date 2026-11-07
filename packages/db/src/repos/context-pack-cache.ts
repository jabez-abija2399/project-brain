import { and, eq, gt } from "drizzle-orm";
import type { BrainDb } from "../db";
import { type ContextPackCacheEntry, contextPackCache } from "../schema";

// Roadmap Phase 2a: cached FILES and COMPONENTS lines of a feature's context pack. Always scoped by project.
// Triggers clear a project's rows on every index change. A read that was building an entry while the index changed
// can still store it after the clear, so entries also expire: an entry is used for at most CONTEXT_PACK_CACHE_TTL_MS.
export const CONTEXT_PACK_CACHE_TTL_MS = 10 * 60 * 1000;

export const contextPackCacheRepo = {
  async get(
    db: BrainDb,
    projectId: string,
    featureId: string,
    now: Date = new Date(),
  ): Promise<ContextPackCacheEntry | null> {
    const [row] = await db
      .select({
        files: contextPackCache.files,
        filesTotal: contextPackCache.filesTotal,
        components: contextPackCache.components,
      })
      .from(contextPackCache)
      .where(
        and(
          eq(contextPackCache.projectId, projectId),
          eq(contextPackCache.featureId, featureId),
          gt(contextPackCache.computedAt, new Date(now.getTime() - CONTEXT_PACK_CACHE_TTL_MS)),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  // Insert or replace. The feature must belong to the project: the composite foreign key (0051) refuses another project's
  // feature id, so a cache row can never point across projects.
  async put(
    db: BrainDb,
    projectId: string,
    featureId: string,
    entry: ContextPackCacheEntry,
  ): Promise<void> {
    const values = { projectId, featureId, ...entry, computedAt: new Date() };
    await db
      .insert(contextPackCache)
      .values(values)
      .onConflictDoUpdate({
        target: [contextPackCache.projectId, contextPackCache.featureId],
        set: {
          files: entry.files,
          filesTotal: entry.filesTotal,
          components: entry.components,
          computedAt: values.computedAt,
        },
      });
  },
};
