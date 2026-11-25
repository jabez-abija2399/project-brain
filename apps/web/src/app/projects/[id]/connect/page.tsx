import { pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { ProjectNav } from "../project-nav";
import { ConnectSections, loadConnect } from "./connect-sections";

export const dynamic = "force-dynamic";

// Connect project: its URL now redirects to Settings (FEAT-030); the page stays for links that skip the redirect.
export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadConnect(getDb(), await pageUser(), id);
  return (
    <main className="page stack stack-lg">
      <div>
        <ProjectNav projectId={data.project.id} current="connect" name={data.project.name} />
      </div>
      <ConnectSections data={data} />
    </main>
  );
}
