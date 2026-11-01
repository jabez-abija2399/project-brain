import Link from "next/link";

// One number that matters, what it means, and where to go next (the whole card is the link).
export function StatCard({
  id,
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  id: string;
  label: string;
  value: string;
  hint: string;
  href: string;
  tone?: "neutral" | "danger" | "warning" | "success";
}) {
  return (
    <Link href={href} className={`stat-card stat-${tone}`} data-stat={id}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-hint">{hint}</span>
    </Link>
  );
}
