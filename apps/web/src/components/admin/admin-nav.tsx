import { TabRow } from "@/components/ui/tab-row";
import Link from "next/link";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/ai", label: "AI usage" },
  { href: "/admin/waitlist", label: "Waitlist" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

// The admin section's tabs (only rendered on admin pages, which check the admin first).
export function AdminNav({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <TabRow label="Admin">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </TabRow>
  );
}
