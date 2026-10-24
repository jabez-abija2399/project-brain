// docs/architecture.md: every list is paginated, max 50 rows per page.
export const MAX_PAGE_SIZE = 50;

export type PageOptions = { limit?: number; offset?: number };
export type Page<T> = { items: T[]; nextOffset: number | null };

export function pageBounds(opts: PageOptions = {}): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? MAX_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const offset = Math.max(Math.trunc(opts.offset ?? 0), 0);
  return { limit, offset };
}

// Callers fetch limit + 1 rows; the extra row only tells whether another page exists.
export function toPage<T>(rows: T[], limit: number, offset: number): Page<T> {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    nextOffset: hasMore ? offset + limit : null,
  };
}
