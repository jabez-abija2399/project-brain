import { PageHeader } from "@/components/shell/page-header";
import { TabRow } from "@/components/ui/tab-row";
import Link from "next/link";
import type { ReactNode } from "react";
import { TabBadge } from "./nav-counts";

// FEAT-030: six tabs. Receipts and To decide show a count when something waits for the owner.
const TABS = [
  { href: "overview", label: "Overview" },
  { href: "receipts", label: "Receipts", badge: "receipts" },
  { href: "features", label: "Features" },
  { href: "decide", label: "To decide", badge: "decide" },
  { href: "blueprint", label: "Blueprint" },
  { href: "settings", label: "Settings" },
] as const;

// The pages the six tabs replaced (their URLs redirect, docs/design-plan-2026-11.md): which tab they belong to now,
// and the word the breadcrumb still uses for them.
const MOVED: Record<string, { tab: (typeof TABS)[number]["href"]; crumb: string }> = {
  proposals: { tab: "decide", crumb: "Proposals" },
  approvals: { tab: "decide", crumb: "Approvals" },
  plan: { tab: "features", crumb: "Plan" },
  connect: { tab: "settings", crumb: "Connect" },
  "": { tab: "settings", crumb: "Keys" },
};

// One sentence per page: what it is for.
export const PURPOSE = {
  overview: "What needs your attention this week, and how each feature is going.",
  receipts: "One receipt per agent session: what you asked, what changed and what is missing.",
  features: "Every part of your app, how much of it is done and what is still open.",
  decide: "Everything your agents are waiting on you for. Approve or reject each one.",
  blueprint: "What your app must do and must never do, and how sure we are of each rule.",
  settings: "How this project connects, the keys your agents use, what they may do alone.",
  proposals: "Changes to the feature map your agent suggested. Accept or reject each one.",
  approvals:
    "What your agents may do on their own, what they must ask for, and what is waiting for you.",
  plan: "The build plan your agent drafted. Approve it to turn it into features.",
  connect: "Connect a repository so your agents can write receipts for this project.",
  "": "The keys your agents and the CLI use for this project. Revoke any you no longer trust.",
} as const;
const purposeOf = (key: string): string | undefined => (PURPOSE as Record<string, string>)[key];

// The project header on every project page: breadcrumbs, the project name, what this page is for, one optional
// primary action, and the tabs.
export function ProjectNav({
  projectId,
  current,
  name,
  action,
}: {
  projectId: string;
  current: string;
  name: string;
  action?: ReactNode;
}) {
  const moved = MOVED[current];
  const active = moved?.tab ?? TABS.find((t) => t.href === current)?.href ?? "overview";
  const tab = TABS.find((t) => t.href === active) ?? TABS[0];
  return (
    <div className="project-head">
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects?all=1" },
          { label: name, href: `/projects/${projectId}/overview` },
          { label: moved?.crumb ?? tab.label },
        ]}
        title={name}
        purpose={purposeOf(current) ?? PURPOSE[tab.href]}
        action={action}
      />
      <TabRow label="Project">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={`/projects/${projectId}/${t.href}`}
            aria-current={t.href === active ? "page" : undefined}
          >
            {t.label}
            {"badge" in t ? <TabBadge of={t.badge} /> : null}
          </Link>
        ))}
      </TabRow>
    </div>
  );
}
