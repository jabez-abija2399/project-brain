import { ProjectHeaderSkeleton, Skeleton } from "@/components/ui/skeleton";

// Loading state for the Blueprint pages: the header and three feature cards.
export default function BlueprintLoading() {
  return (
    <main className="page stack stack-lg" aria-busy="true">
      <span className="lp-visually-hidden">Loading the Blueprint…</span>
      <ProjectHeaderSkeleton />
      {[0, 1, 2].map((n) => (
        <div key={n} className="card stack">
          <Skeleton style={{ width: "40%", height: 20 }} />
          <Skeleton style={{ width: "70%", height: 14 }} />
        </div>
      ))}
    </main>
  );
}
