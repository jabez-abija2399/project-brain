import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { BrainDb } from "../db";
import {
  type ChecklistItem,
  type NewRequest,
  type Request as RequestRow,
  checklistItems,
  requests,
} from "../schema";

export const requestsRepo = {
  async insert(
    db: BrainDb,
    projectId: string,
    data: Omit<NewRequest, "projectId">,
  ): Promise<RequestRow> {
    const [row] = await db
      .insert(requests)
      .values({ ...data, projectId })
      .returning();
    if (!row) throw new Error("insert requests returned no row");
    return row;
  },

  async list(db: BrainDb, projectId: string, limit = 50): Promise<RequestRow[]> {
    return db
      .select()
      .from(requests)
      .where(eq(requests.projectId, projectId))
      .orderBy(desc(requests.createdAt))
      .limit(limit);
  },

  // FEAT-012: the request and its checklist items in one transaction (both or neither are stored).
  async createWithItems(
    db: BrainDb,
    projectId: string,
    data: { featureId: string | null; text: string; sessionId?: string | null },
    items: { text: string; needsClarification: boolean }[],
  ): Promise<{ request: RequestRow; items: ChecklistItem[] }> {
    return db.transaction(async (tx) => {
      const [request] = await tx
        .insert(requests)
        .values({
          projectId,
          featureId: data.featureId,
          text: data.text,
          sessionId: data.sessionId ?? null,
        })
        .returning();
      if (!request) throw new Error("insert requests returned no row");
      const rows =
        items.length === 0
          ? []
          : await tx
              .insert(checklistItems)
              .values(
                items.map((i, position) => ({ ...i, position, projectId, requestId: request.id })),
              )
              .returning();
      return { request, items: rows.sort((a, b) => a.position - b.position) };
    });
  },

  /** The newest request with exactly this text since `since` (a request captured by the hook, made again). */
  async findRecentByText(
    db: BrainDb,
    projectId: string,
    text: string,
    since: Date,
    sessionId?: string,
  ): Promise<RequestRow | null> {
    const rows = await db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.projectId, projectId),
          eq(requests.text, text),
          gte(requests.createdAt, since),
          // Without a session id: only requests a prompt-submit hook captured (they always carry one).
          sessionId ? eq(requests.sessionId, sessionId) : isNotNull(requests.sessionId),
        ),
      )
      .orderBy(desc(requests.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },

  /**
   * The requests made in one agent session, newest first: those captured with its id, and those recorded without a
   * session (an agent's own create_checklist) since the session started.
   */
  async listForSession(
    db: BrainDb,
    projectId: string,
    sessionId: string,
    since: Date | null,
    limit: number,
  ): Promise<RequestRow[]> {
    const ofSession = eq(requests.sessionId, sessionId);
    return db
      .select()
      .from(requests)
      .where(
        and(
          eq(requests.projectId, projectId),
          since
            ? or(ofSession, and(isNull(requests.sessionId), gte(requests.createdAt, since)))
            : ofSession,
        ),
      )
      .orderBy(desc(requests.createdAt), desc(requests.id))
      .limit(limit);
  },

  async byId(db: BrainDb, projectId: string, requestId: string): Promise<RequestRow | null> {
    const [row] = await db
      .select()
      .from(requests)
      .where(and(eq(requests.projectId, projectId), eq(requests.id, requestId)))
      .limit(1);
    return row ?? null;
  },

  /**
   * FEAT-016: the newest requests that still have unresolved checklist items (open, partial or missed), each with
   * those items in request order. Two bounded queries.
   */
  async listWithOpenItems(
    db: BrainDb,
    projectId: string,
    limit: number,
  ): Promise<(RequestRow & { items: ChecklistItem[] })[]> {
    const open = db
      .selectDistinct({ id: checklistItems.requestId })
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.projectId, projectId),
          inArray(checklistItems.status, ["open", "partial", "missed"]),
        ),
      );
    const rows = await db
      .select()
      .from(requests)
      .where(and(eq(requests.projectId, projectId), inArray(requests.id, open)))
      .orderBy(desc(requests.createdAt), desc(requests.id))
      .limit(limit);
    if (rows.length === 0) return [];
    const items = await db
      .select()
      .from(checklistItems)
      .where(
        and(
          eq(checklistItems.projectId, projectId),
          inArray(
            checklistItems.requestId,
            rows.map((r) => r.id),
          ),
          inArray(checklistItems.status, ["open", "partial", "missed"]),
        ),
      )
      .orderBy(asc(checklistItems.position), asc(checklistItems.id))
      // A request has at most 10 items (FEAT-012); this bounds the read even if that ever changes.
      .limit(limit * 100);
    return rows.map((r) => ({ ...r, items: items.filter((i) => i.requestId === r.id) }));
  },
};
