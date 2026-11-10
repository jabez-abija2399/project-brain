import { PageHeader } from "@/components/shell/page-header";
import Link from "next/link";
import type { ReactNode } from "react";

const TABS = [
  { href: "overview", label: "Overview" },
  { href: "features", label: "Features" },
  { href: "blueprint", label: "Blueprint" },
  { href: "receipts", label: "Receipts" },
  { href: "proposals", label: "Proposals" },
  { href: "approvals", label: "Approvals" },
  { href: "plan", label: "Plan" },
  { href: "connect", label: "Connect" },
  { href: "", label: "Tokens" },
] as const;

// One sentence per tab: what the page is for.
export const PURPOSE: Record<(typeof TABS)[number]["href"], string> = {
  overview: "What needs your attention this week, and how each feature is going.",
  features: "Every part of your app, how much of it is done and what is still open.",
  blueprint: "What your app must do and must never do, and how sure we are of each rule.",
  receipts: "One receipt per agent session: what you asked, what changed and what is missing.",
  proposals: "Changes to the feature map your agent suggested. Accept or reject each one.",
  approvals:
    "What your agents may do on their own, what they must ask for, and what is waiting for you.",
  plan: "The build plan your agent drafted. Approve it to turn it into features.",
  connect: "Connect a repository so your agents can write receipts for this project.",
  "": "The keys your agents and the CLI use for this project. Revoke any you no longer trust.",
};

// The project header on every project page: breadcrumbs, the project name, what this tab is for, one optional
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
  const tab = TABS.find((t) => t.href === current) ?? TABS[0];
  return (
    <div className="project-head">
      <PageHeader
        crumbs={[
          { label: "Projects", href: "/projects?all=1" },
          { label: name, href: `/projects/${projectId}/overview` },
          { label: tab.label },
        ]}
        title={name}
        purpose={PURPOSE[tab.href]}
        action={action}
      />
      <nav className="project-nav" aria-label="Project">
        {TABS.map((t) => (
          <Link
            key={t.label}
            href={`/projects/${projectId}${t.href ? `/${t.href}` : ""}`}
            aria-current={t.href === current ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
