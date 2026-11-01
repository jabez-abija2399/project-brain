"use client";

import { currentProjectId } from "@/lib/ui-helpers";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export type SwitcherProject = { id: string; name: string };

// The header's project switcher: a native disclosure with a list of links (works without JavaScript; Escape and a
// click outside close it).
export function ProjectSwitcher({ projects }: { projects: SwitcherProject[] }) {
  const current = currentProjectId(usePathname());
  const menu = useRef<HTMLDetailsElement>(null);
  const active = projects.find((p) => p.id === current);
  useEffect(() => {
    const close = (e: Event) => {
      const el = menu.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) {
        el.open = false;
        if (e instanceof KeyboardEvent) el.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("keydown", close);
    document.addEventListener("click", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("click", close);
    };
  }, []);
  return (
    <details className="switcher" ref={menu}>
      <summary aria-label={`Switch project. Current: ${active?.name ?? "none"}`}>
        <span className="switcher-name">{active?.name ?? "Projects"}</span>
      </summary>
      <div className="switcher-menu">
        <ul>
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}/overview`}
                aria-current={p.id === current ? "page" : undefined}
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                }}
              >
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
        <Link
          className="switcher-all"
          href="/projects?all=1"
          onClick={() => {
            if (menu.current) menu.current.open = false;
          }}
        >
          All projects
        </Link>
      </div>
    </details>
  );
}
