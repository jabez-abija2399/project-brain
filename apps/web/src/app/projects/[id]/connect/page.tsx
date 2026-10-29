import { CopyCommand } from "@/components/copy-command";
import { StatusBadge } from "@/components/ui/status-badge";
import { connectStatus } from "@/server/dashboard";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import Link from "next/link";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

// The public address the CLI talks to (never a secret).
const appUrl = () => (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

// Connect project (docs/DESIGN.md screen 3): log in with a project token, index once, set up the agents. The token
// itself is never shown here; it is created on the Tokens tab and pasted into the terminal.
export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const status = await orNotFound(() => connectStatus(getDb(), user, id));
  const base = `/projects/${status.project.id}`;
  return (
    <main className="page stack">
      <div>
        <ProjectNav projectId={status.project.id} current="connect" name={status.project.name} />
      </div>
      <section className="stack">
        <h2 style={{ fontSize: 16, margin: 0 }}>1. Log in with a project token</h2>
        <p className="muted" style={{ margin: 0 }}>
          Create a token on the <Link href={base}>Tokens</Link> tab, run this in your app's folder
          and paste the token when asked.
        </p>
        <CopyCommand command={`npx projectbrain login --api-url ${appUrl()}`} />
      </section>
      <section className="stack">
        <h2 style={{ fontSize: 16, margin: 0 }}>2. Set up Claude Code and Cursor</h2>
        <CopyCommand command="npx projectbrain init" label="Copy command" />
      </section>
      <section className="stack">
        <h2 style={{ fontSize: 16, margin: 0 }}>3. Index your code</h2>
        <CopyCommand command="npx projectbrain index" />
        {status.indexedFiles === 0 ? (
          <output className="row">
            <StatusBadge status="open" label="Waiting for the first index" />
            <Link href={`${base}/connect`}>Check again</Link>
          </output>
        ) : (
          <output className="row">
            <StatusBadge status="done" label={`Indexed ${status.indexedFiles} files`} />
            <Link href={`${base}/features`}>Open the feature board</Link>
          </output>
        )}
      </section>
    </main>
  );
}
