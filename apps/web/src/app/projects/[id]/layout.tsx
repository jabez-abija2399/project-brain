import type { ReactNode } from "react";

// FEAT-040: the section counts moved to the sidebar, which the app shell loads once per page (server/shell.ts, owner
// only). This layout only groups the project pages.
export default function ProjectLayout({ children }: { children: ReactNode }) {
  return children;
}
