import Link from "next/link";

// Pages of at most 50 rows (docs/DESIGN.md); links keep the page in the URL so the back button works.
export function Pagination({
  page,
  pages,
  basePath,
}: { page: number; pages: number; basePath: string }) {
  if (pages <= 1) return null;
  const href = (n: number) => `${basePath}?page=${n}`;
  return (
    <nav className="pagination" aria-label="Pages">
      {page > 1 ? (
        <Link className="btn" href={href(page - 1)} rel="prev">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      <span className="muted">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link className="btn" href={href(page + 1)} rel="next">
          Older →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
