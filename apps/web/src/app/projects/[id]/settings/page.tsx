import { approvalsPage } from "@/server/approvals-page";
import { VIEW_COOKIE, viewMode } from "@/server/blueprint-page";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { projectTokensRepo } from "@brain/db";
import { cookies } from "next/headers";
import { ApprovalPolicy } from "../approvals/approval-sections";
import { ViewChoice } from "../blueprint/blueprint-actions";
import { ConnectSections, loadConnect } from "../connect/connect-sections";
import { DeleteProject } from "../delete-project";
import { ProjectNav } from "../project-nav";
import ProjectTokensPanel from "../tokens-panel";

export const dynamic = "force-dynamic";

// FEAT-030: Settings, everything about the project that is set once: how it connects, the connection keys, what
// agents may do on their own, and deleting it. Only the project's owner reaches it (404 for anyone else).
export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const query = (await searchParams)?.view;
  const user = await pageUser();
  const db = getDb();
  const connect = await loadConnect(db, user, id);
  const pid = connect.project.id;
  const [keys, approvals] = await Promise.all([
    projectTokensRepo.listForProject(db, pid),
    orNotFound(() => approvalsPage(db, user, pid)),
  ]);
  const o = approvals.overview;
  const mode = viewMode((await cookies()).get(VIEW_COOKIE)?.value, query) ?? "simple";
  return (
    <main className="page stack stack-lg">
      <div>
        <ProjectNav projectId={pid} current="settings" name={connect.project.name} />
      </div>
      <section className="stack" aria-labelledby="connect-title">
        <h2 id="connect-title" className="section-title m0">
          Connect
        </h2>
        <ConnectSections data={connect} />
      </section>
      <section className="stack" id="keys" aria-labelledby="keys-title">
        <h2 id="keys-title" className="section-title m0">
          Connection keys
        </h2>
        <p className="muted m0">
          Each key lets one computer or agent send receipts for this project. Remove a key and that
          computer stops at once.
        </p>
        <ProjectTokensPanel
          projectId={pid}
          initialTokens={keys.items.map((t) => ({
            id: t.id,
            createdAt: t.createdAt.toISOString(),
            revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
            lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
          }))}
        />
      </section>
      {o.ready ? (
        <section className="stack" id="approvals" aria-labelledby="approvals-title">
          <h2 id="approvals-title" className="section-title m0">
            What your agents may do on their own
          </h2>
          <div className="row wrap">
            <ViewChoice current={mode} />
          </div>
          <ApprovalPolicy pid={pid} o={o} table={approvals.table} mode={mode} />
        </section>
      ) : null}
      <section className="card stack" aria-labelledby="delete-title">
        <h2 id="delete-title" className="section-title m0">
          Delete this project
        </h2>
        <DeleteProject projectId={pid} name={connect.row.name} />
      </section>
    </main>
  );
}
