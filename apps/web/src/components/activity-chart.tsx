// Receipts per day for the last 14 days, stacked: all good below, needs attention on top. Plain HTML bars, each with a
// label, so screen readers get the same numbers as the hover tooltip.
export function ActivityChart({
  days,
}: {
  days: { date: string; good: number; attention: number }[];
}) {
  const max = Math.max(1, ...days.map((d) => d.good + d.attention));
  return (
    <figure className="chart" aria-label="Receipts per day, last 14 days">
      <ol className="chart-bars">
        {days.map((d) => {
          const label = `${d.date}: ${d.good} all good, ${d.attention} needs attention`;
          return (
            <li key={d.date} className="chart-day" data-day={d.date} aria-label={label}>
              <span
                className="chart-stack"
                style={{ height: `${((d.good + d.attention) / max) * 100}%` }}
              >
                {d.attention > 0 && (
                  <span className="chart-attention" style={{ flexGrow: d.attention }} />
                )}
                {d.good > 0 && <span className="chart-good" style={{ flexGrow: d.good }} />}
              </span>
              <span className="chart-tip" aria-hidden="true">
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <figcaption className="chart-axis muted">
        <span>{days[0]?.date.slice(5)}</span>
        <span className="chart-legend">
          <span className="legend-dot legend-good" /> All good
          <span className="legend-dot legend-attention" /> Needs attention
        </span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}
