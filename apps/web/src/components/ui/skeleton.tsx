import type { CSSProperties } from "react";

// A placeholder block shaped like the content that is loading (shimmer stops under reduced motion).
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

// The project header while a page loads: back link, name and tabs.
export function ProjectHeaderSkeleton() {
  return (
    <div className="stack gap-12">
      <Skeleton style={{ width: 72, height: 14 }} />
      <Skeleton style={{ width: 180, height: 26 }} />
      <Skeleton style={{ width: "min(520px, 100%)", height: 40, borderRadius: 12 }} />
    </div>
  );
}
