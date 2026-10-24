import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { projectsRepo } from "@brain/db";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import CreateProjectForm from "./create-form";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user) redirect("/");

  const db = getDb();
  const { items: projects } = await projectsRepo.listByOwner(db, session.user.id);

  return (
    <main style={{ padding: "48px 32px", maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Projects</h1>
      <CreateProjectForm />
      {projects.length === 0 ? (
        <p style={{ marginTop: 24, color: "var(--muted)" }}>No projects yet. Create one above.</p>
      ) : (
        <ul
          data-testid="projects-list"
          style={{ marginTop: 24, listStyle: "none", padding: 0, display: "grid", gap: 12 }}
        >
          {projects.map((p) => (
            <li
              key={p.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <Link href={`/projects/${p.id}`} style={{ textDecoration: "none" }}>
                <strong>{p.name}</strong>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
