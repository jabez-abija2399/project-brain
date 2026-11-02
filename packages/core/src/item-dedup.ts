// H1/H2 (2026-11-02): near-duplicate checklist items. Pure: no database, no network. The database repositories and the
// server call these; nothing here reads or writes anything.

// Two open items are the same item when their word sets are at least this similar (Jaccard on normalized tokens).
export const DUPLICATE_SIMILARITY = 0.8;

// The filler words a normalized key drops. Kept short on purpose: the key stays conservative.
const FILLER_WORDS = new Set(["a", "the", "short", "please", "to", "at", "top", "of"]);

/** The normalized key of an item: lower case, punctuation as spaces, filler words dropped, single spaces. */
export function itemKey(text: string): string {
  return tokens(text).join(" ");
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w !== "" && !FILLER_WORDS.has(w));
}

/** Jaccard similarity of the two items' word sets (0 to 1). Two items without words are not similar. */
export function itemSimilarity(a: string, b: string): number {
  const setA = new Set(tokens(a));
  const setB = new Set(tokens(b));
  if (setA.size === 0 && setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** The same open item in different words: its normalized key is equal or its word sets are similar enough. */
export function isNearDuplicate(a: string, b: string): boolean {
  if (itemKey(a) === "" || itemKey(b) === "") return false;
  return itemSimilarity(a, b) >= DUPLICATE_SIMILARITY;
}

/** The first candidate that is a near-duplicate of `text`, or undefined. */
export function findNearDuplicate<T>(
  text: string,
  candidates: readonly T[],
  textOf: (candidate: T) => string,
): T | undefined {
  return candidates.find((c) => isNearDuplicate(text, textOf(c)));
}

export type CleanupItem = {
  id: string;
  text: string;
  status: string;
  // Owner item 3: the owner's own Close. Not the agent's evidence, so it never closes another item as "done".
  closedByOwner?: boolean;
  // When the item's request was made: "later" means a receipt made after the open item was requested.
  requestCreatedAt: Date;
};

export type CleanupChange = { id: string; status: "done" | "done_untested" | "dismissed" };

const OPEN_STATUSES = new Set(["open", "partial", "missed", "postponed"]);
const DONE_STATUSES = new Set(["done", "done_untested"]);

/**
 * H2 cleanup plan for one project's items (pure). An open item that a LATER item shows done is closed with that
 * item's status (done or done_untested, never upgraded to done). Of the open items left, the newest of each group of
 * near-duplicates stays open and the older ones are dismissed as merged into it. Applying the plan and planning again
 * gives no changes (idempotent).
 */
export function planOpenItemCleanup(items: readonly CleanupItem[]): CleanupChange[] {
  const newestFirst = [...items].sort(
    (a, b) => b.requestCreatedAt.getTime() - a.requestCreatedAt.getTime() || (a.id < b.id ? 1 : -1),
  );
  // Each item's words are read once here, not once per comparison (the owner's cleanup can cover thousands of items).
  const words = new Map(newestFirst.map((i) => [i.id, new Set(tokens(i.text))] as const));
  const near = (a: string, b: string) => {
    const wa = words.get(a) as Set<string>;
    const wb = words.get(b) as Set<string>;
    if (wa.size === 0 || wb.size === 0) return false;
    let shared = 0;
    for (const t of wa) if (wb.has(t)) shared++;
    return shared / (wa.size + wb.size - shared) >= DUPLICATE_SIMILARITY;
  };
  const done = newestFirst.filter((i) => DONE_STATUSES.has(i.status) && i.closedByOwner !== true);
  const changes: CleanupChange[] = [];
  const stillOpen: CleanupItem[] = [];
  for (const item of newestFirst) {
    if (!OPEN_STATUSES.has(item.status)) continue;
    const shown = done.find(
      (d) => d.requestCreatedAt.getTime() > item.requestCreatedAt.getTime() && near(d.id, item.id),
    );
    if (shown) {
      changes.push({ id: item.id, status: shown.status as "done" | "done_untested" });
    } else {
      stillOpen.push(item);
    }
  }
  const kept: CleanupItem[] = [];
  for (const item of stillOpen) {
    if (kept.some((k) => near(k.id, item.id))) {
      changes.push({ id: item.id, status: "dismissed" });
    } else {
      kept.push(item);
    }
  }
  return changes;
}
