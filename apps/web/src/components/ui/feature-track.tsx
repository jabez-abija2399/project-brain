// FEAT-040 (design v3): where a feature is, as four stages instead of a bare percentage (Basecamp hill charts):
// Planned, Being built, Checking, Done. The current stage is named in words; the bars only repeat it.
export const STAGES = ["Planned", "Being built", "Checking", "Done"] as const;

/** 0 = nothing planned yet; 1..4 = the stage reached. */
export function featureStage(f: {
  totalItems: number;
  doneItems: number;
  openItems: number;
}): number {
  if (f.totalItems === 0) return 0;
  if (f.doneItems === 0) return 1;
  if (f.doneItems < f.totalItems) return 2;
  return f.openItems > 0 ? 3 : 4;
}

export function FeatureTrack({ stage, label }: { stage: number; label: string }) {
  const now = stage > 0 ? STAGES[stage - 1] : "Not planned yet";
  return (
    <span className="feature-track" data-stage={stage}>
      <span className="track-bars" role="img" aria-label={`${label}: ${now}`}>
        {STAGES.map((s, i) => (
          <span key={s} className={i < stage ? "on" : undefined} />
        ))}
      </span>
      <span className="track-now">{now}</span>
    </span>
  );
}
