import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { projectTokensRepo, projectsRepo } from "@brain/db";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ProjectTokensPanel from "./tokens-panel";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const db = getDb();
  const project = await projectsRepo.get(db, id, session.user.id);
  if (!project) notFound();

  const { items: tokens } = await projectTokensRepo.listForProject(db, project.id);

  return (
    <main style={{ padding: "48px 32px", maxWidth: 800, margin: "0 auto" }}>
      <Link href="/projects" style={{ fontSize: 13 }}>
        ← Projects
      </Link>
      <h1 style={{ fontSize: 24, margin: "16px 0" }}>{project.name}</h1>
      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>Project tokens</h2>
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
    </main>
  );
}
