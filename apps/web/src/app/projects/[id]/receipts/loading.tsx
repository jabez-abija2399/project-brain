import { ProjectHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

// Loading state for the receipts feed: filter chips and three receipt cards, shaped like the real list.
export default function ReceiptsLoading() {
  return (
    <main className="page stack gap-20" aria-busy="true">
      <span className="lp-visually-hidden">Loading receipts…</span>
      <ProjectHeaderSkeleton />
      <div className="row">
        <Skeleton style={{ width: 70, height: 34, borderRadius: 999 }} />
        <Skeleton style={{ width: 150, height: 34, borderRadius: 999 }} />
        <Skeleton style={{ width: 100, height: 34, borderRadius: 999 }} />
      </div>
      {[0, 1, 2].map((n) => (
        <div key={n} className="card stack skeleton-card gap-10">
          <Skeleton style={{ width: 140, height: 12 }} />
          <Skeleton style={{ width: "70%", height: 18 }} />
          <div className="row">
            <Skeleton style={{ width: 64, height: 20, borderRadius: 999 }} />
            <Skeleton style={{ width: 84, height: 20, borderRadius: 999 }} />
            <Skeleton style={{ width: 72, height: 20, borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </main>
  );
}
