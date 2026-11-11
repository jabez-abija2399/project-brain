import { requireProjectAccess } from "@/server/auth";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { safeDisplay } from "@brain/core";
import { projectTokensRepo } from "@brain/db";
import { DeleteProject } from "./delete-project";
import { ProjectNav } from "./project-nav";
import ProjectTokensPanel from "./tokens-panel";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await pageUser();
  const db = getDb();
  const project = await orNotFound(() => requireProjectAccess(db, id, user));

  const { items: tokens } = await projectTokensRepo.listForProject(db, project.id);

  return (
    <main className="page stack stack-lg">
      <ProjectNav projectId={project.id} current="" name={safeDisplay(project.name, 100)} />
      <section className="stack" aria-labelledby="tokens-title">
        <h2 id="tokens-title" className="section-title">
          Project tokens
        </h2>
        <ProjectTokensPanel
          projectId={project.id}
          initialTokens={tokens.map((t) => ({
            id: t.id,
            createdAt: t.createdAt.toISOString(),
            revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
            lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
          }))}
        />
      </section>
      <section className="card stack" aria-labelledby="delete-title">
        <h2 id="delete-title" className="section-title m0">
          Delete this project
        </h2>
        <DeleteProject projectId={project.id} name={project.name} />
      </section>
    </main>
  );
}
