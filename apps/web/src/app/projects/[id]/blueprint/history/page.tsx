import { historyPage } from "@/server/blueprint-page";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { ProjectNav } from "../../project-nav";
import { BlueprintAction } from "../blueprint-actions";
import { BlueprintEmpty } from "../not-ready";

export const dynamic = "force-dynamic";

const REASON: Record<string, string> = {
  edit: "Your edit",
  accept_proposal: "You accepted a suggestion",
  restore: "Restored",
  plan_approve: "You approved a plan",
};

// Roadmap Phase 3c: every saved version of the Blueprint. Restoring one saves it again as the newest version; rules
// added since are retired, never deleted.
export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const view = await orNotFound(() => historyPage(getDb(), user, id));
  const base = `/projects/${view.project.id}`;
  const nav = (
    <ProjectNav projectId={view.project.id} current="blueprint" name={view.project.name} />
  );
  if (!view.ready || view.versions.length === 0) {
    return (
      <BlueprintEmpty
        nav={nav}
        title="No versions yet"
        text="Each change to the Blueprint is saved as a version you can go back to."
        action={{ label: "Back to the Blueprint", href: `${base}/blueprint` }}
      />
    );
  }
  return (
    <main className="page stack stack-lg">
      <div>{nav}</div>
      <ol className="plain-list stack" aria-label="Versions">
        {view.versions.map((v) => (
          <li key={v.version} className="card row wrap">
            <strong>Version {v.version}</strong>
            <span>
              {REASON[v.reason] ?? v.reason}
              {v.restoredFrom ? ` (from version ${v.restoredFrom})` : ""}
            </span>
            <time className="muted" dateTime={v.createdAt.toISOString()}>
              {v.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
            </time>
            {v.version === view.current ? (
              <span className="muted">Current</span>
            ) : (
              <BlueprintAction
                projectId={view.project.id}
                path="restore"
                body={{ version: v.version, baseVersion: view.current }}
                label="Restore"
                done="Restored as a new version."
                confirm={`Make version ${v.version} current again? Rules added since are retired (not deleted), and you can restore again later.`}
              />
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
