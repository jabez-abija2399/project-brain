import { CommandBox } from "@/components/landing/command-box";
import { PageHeader } from "@/components/shell/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { onboarding } from "@/server/onboarding";
import { projectsList } from "@/server/projects-list";
import Link from "next/link";
import { redirect } from "next/navigation";
import CreateProjectForm from "./create-form";

export const dynamic = "force-dynamic";

// Journey part 1: until the user's first receipt arrives, /projects (where sign-in lands) is the guided start page;
// ?all=1 shows the list anyway. Each project shows its newest receipt and whether it needs attention.
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string | string[] }>;
}) {
  const user = await pageUser();
  const db = getDb();
  if ((await searchParams).all === undefined && !(await onboarding(db, user)).steps.receipt) {
    redirect("/start");
  }
  const projects = await projectsList(db, user);

  return (
    <main className="page stack stack-lg">
      <PageHeader
        title="Projects"
        purpose="Each project is one app. Open one to see its receipts, features and what needs your attention."
      />
      {projects.length === 0 ? (
        <div className="empty" data-testid="empty-state">
          <h2 className="section-title">No projects yet</h2>
          <p className="muted">
            Run this in your app's folder: it connects the repository, creates the project and sets
            up your agents.
          </p>
          <CommandBox command="npx codeceipt" />
        </div>
      ) : (
        <ul data-testid="projects-list" className="project-list plain-list">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}/overview`} className="project-row">
                <span className="project-row-main">
                  <strong className="wrap">{p.name}</strong>
                  <span className="muted wrap">
                    {p.last
                      ? (p.last.asked ?? "A session without a recorded request")
                      : "No receipts yet: end an agent session in this repository."}
                  </span>
                </span>
                <span className="project-row-side">
                  {p.last ? (
                    p.last.reasons.length > 0 ? (
                      <StatusBadge status="missed" label={p.last.reasons[0] ?? "Needs attention"} />
                    ) : (
                      <StatusBadge status="done" label="All good" />
                    )
                  ) : (
                    <StatusBadge status="open" label="Waiting" />
                  )}
                  {p.last ? (
                    <time className="muted" dateTime={p.last.createdAt}>
                      {p.last.createdAt.slice(0, 10)}
                    </time>
                  ) : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <CreateProjectForm />
    </main>
  );
}
