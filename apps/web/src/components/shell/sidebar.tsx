"use client";

import { NavCountsProvider, TabBadge } from "@/app/projects/[id]/nav-counts";
import { currentProjectId } from "@/lib/ui-helpers";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type NavIconName } from "./nav-icons";
import type { SwitcherProject } from "./project-switcher";

export type SidebarCounts = { projectId: string; receipts: number; decide: number } | null;

// FEAT-040 (design v3): a project's five sections, in the order people use them.
export const SECTIONS = [
  { href: "overview", label: "Home", icon: "home" },
  { href: "receipts", label: "Receipts", icon: "receipts", badge: "receipts" },
  { href: "decide", label: "To decide", icon: "decide", badge: "decide" },
  { href: "features", label: "Features", icon: "features" },
  { href: "blueprint", label: "Blueprint", icon: "blueprint" },
] as const;

// Pages that live inside a section (their old addresses and sub-pages) keep that section marked.
const SECTION_OF: Record<string, string> = {
  overview: "overview",
  receipts: "receipts",
  decide: "decide",
  proposals: "decide",
  approvals: "decide",
  features: "features",
  plan: "features",
  blueprint: "blueprint",
  settings: "settings",
  connect: "settings",
  "": "settings",
};

/** Which section the address is in, only for one of the user's own projects (null anywhere else). */
export function sectionOf(
  pathname: string | null,
  projects: SwitcherProject[],
): { projectId: string; section: string } | null {
  const id = currentProjectId(pathname);
  if (!id || !projects.some((p) => p.id === id)) return null;
  const segment = (pathname ?? "").split("/")[3] ?? "";
  return { projectId: id, section: SECTION_OF[segment] ?? "" };
}

function Item({
  href,
  label,
  icon,
  current,
  badge,
}: {
  href: string;
  label: string;
  icon: NavIconName;
  current: boolean;
  badge?: "receipts" | "decide";
}) {
  return (
    <Link href={href} aria-current={current ? "page" : undefined}>
      <NavIcon name={icon} />
      <span className="nav-label">{label}</span>
      {badge ? <TabBadge of={badge} /> : null}
    </Link>
  );
}

/**
 * The sidebar's links (desktop) and the floating bottom bar (phones), from one list. Inside one of the user's own
 * projects: its five sections with the counts that wait on the owner, and the project's settings. Anywhere else:
 * Projects. The counts come from the server for that project only (server/shell.ts).
 */
export function ProjectLinks({
  projects,
  counts,
  variant,
}: {
  projects: SwitcherProject[];
  counts: SidebarCounts;
  variant: "sidebar" | "bar";
}) {
  const pathname = usePathname();
  const where = sectionOf(pathname, projects);
  const onAccount = (pathname ?? "").startsWith("/account");
  const value =
    where && counts?.projectId === where.projectId
      ? { receipts: counts.receipts, decide: counts.decide }
      : null;
  const base = where ? `/projects/${where.projectId}` : "";
  if (variant === "bar") {
    const items = where ? SECTIONS.slice(0, 4) : [];
    return (
      <NavCountsProvider value={value}>
        <nav className="tabbar" aria-label="Sections">
          {items.map((s) => (
            <Item
              key={s.href}
              href={`${base}/${s.href}`}
              label={s.href === "decide" ? "Decide" : s.label}
              icon={s.icon}
              current={where?.section === s.href}
              badge={"badge" in s ? s.badge : undefined}
            />
          ))}
          {where ? null : (
            <Item href="/projects?all=1" label="Projects" icon="projects" current={false} />
          )}
          <details className="tabbar-more">
            <summary>
              <NavIcon name="more" />
              <span className="nav-label">More</span>
            </summary>
            <div className="tabbar-menu">
              {where ? (
                <>
                  <Link href={`${base}/blueprint`}>Blueprint</Link>
                  <Link href={`${base}/settings`}>Project settings</Link>
                </>
              ) : null}
              <Link href="/projects?all=1">All projects</Link>
              <Link href="/account">Account</Link>
              <Link href="/docs/quickstart">Docs</Link>
            </div>
          </details>
        </nav>
      </NavCountsProvider>
    );
  }
  return (
    <NavCountsProvider value={value}>
      <nav className="side-nav" aria-label={where ? "Project" : "Main"}>
        {where ? (
          SECTIONS.map((s) => (
            <Item
              key={s.href}
              href={`${base}/${s.href}`}
              label={s.label}
              icon={s.icon}
              current={where.section === s.href}
              badge={"badge" in s ? s.badge : undefined}
            />
          ))
        ) : (
          <Item
            href="/projects?all=1"
            label="Projects"
            icon="projects"
            current={(pathname ?? "").startsWith("/projects")}
          />
        )}
      </nav>
      <nav className="side-nav side-foot" aria-label="Settings and help">
        {where ? (
          <Item
            href={`${base}/settings`}
            label="Project settings"
            icon="settings"
            current={where.section === "settings"}
          />
        ) : null}
        <Item href="/account" label="Account" icon="account" current={onAccount} />
        <Item href="/docs/quickstart" label="Docs" icon="docs" current={false} />
      </nav>
    </NavCountsProvider>
  );
}
