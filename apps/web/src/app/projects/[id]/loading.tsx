// Loading state for every project page (lists stream in after this).
export default function Loading() {
  return (
    <main className="page" aria-busy="true">
      <output className="muted">Loading…</output>
    </main>
  );
}
