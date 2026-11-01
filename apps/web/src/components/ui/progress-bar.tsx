// Done out of total as a native progress bar with its own label (never color alone: the text beside it says the
// numbers).
export function ProgressBar({
  done,
  total,
  label,
}: { done: number; total: number; label: string }) {
  return <progress className="progress" value={done} max={Math.max(total, 1)} aria-label={label} />;
}
