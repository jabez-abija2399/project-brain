import { LiveStatus } from "@/app/start/live-status";
import { JourneySteps } from "@/components/journey-steps";
import { requireProjectAccess } from "@/server/auth";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { githubConfig } from "@/server/github";
import { projectSteps } from "@/server/onboarding";
import { projectSettingsView } from "@/server/project-settings";
import Link from "next/link";
import { ProjectNav } from "../project-nav";
import { PrReceiptsToggle } from "./pr-receipts-toggle";

export const dynamic = "force-dynamic";

// The public address the CLI talks to (never a secret).
const appUrl = () => (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

// Connect project (docs/DESIGN.md screen 3): the same `npx codeceipt` flow as the start page, with the status of
// this project: linked, first index, first receipt. No token is shown or pasted anywhere.
export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const { project, steps } = await orNotFound(() => projectSteps(getDb(), user, id));
  const settings = await orNotFound(() => projectSettingsView(getDb(), user, id));
  const row = await orNotFound(() => requireProjectAccess(getDb(), id, user));
  const done = steps.linked && steps.indexed && steps.receipt;
  const current = [steps.linked, steps.indexed, steps.receipt].map((d) => (d ? "1" : "0")).join("");
  return (
    <main className="page stack stack-lg">
      <div>
        <ProjectNav projectId={project.id} current="connect" name={project.name} />
      </div>
      <p className="muted m0">
        Connect a repository to this project: when the code page opens, pick this project. Its
        server is <code className="wrap">{appUrl()}</code>.
      </p>
      <JourneySteps steps={steps} />
      <LiveStatus on={!done} current={current} />
      {steps.receipt ? (
        <Link className="btn btn-primary self-start" href={`/projects/${project.id}/receipts`}>
          Open the receipts
        </Link>
      ) : null}
      {/* Backlog: the GitHub App connection, so pushes made outside an agent session update the project too. */}
      <section className="card stack" aria-labelledby="github-app">
        <h2 className="section-title m0" id="github-app">
          GitHub
        </h2>
        {row.installationId !== null && row.repoFullName ? (
          <p className="m0">
            Connected to <strong className="wrap">{row.repoFullName}</strong>. Pushes to its default
            branch update this project.
          </p>
        ) : githubConfig() ? (
          <>
            <p className="muted m0">
              Optional: connect the repository through the Codeceipt GitHub App, so pushes made
              outside an agent session update this project too.
            </p>
            <a
              className="btn btn-secondary self-start"
              href={`/api/github/install?projectId=${encodeURIComponent(project.id)}`}
            >
              Connect GitHub
            </a>
          </>
        ) : (
          <p className="muted m0">The GitHub App is not set up on this server.</p>
        )}
      </section>
      {/* Roadmap Phase 10b: receipts on pull requests, off until the owner turns them on. */}
      <section className="card stack" aria-labelledby="pr-receipts">
        <h2 className="section-title m0" id="pr-receipts">
          Receipts on pull requests
        </h2>
        <p className="muted m0">
          When this is on, Codeceipt adds one comment to each pull request of this repository with
          the receipts for its commits, and keeps it up to date. A public repository gets counts
          only. Pull requests from forks never get one.
        </p>
        {!settings.ready ? (
          <p className="m0">This is being set up on the server and cannot be turned on yet.</p>
        ) : !settings.repoConnected ? (
          <p className="m0">
            Connect this project's repository through the Codeceipt GitHub App first.
          </p>
        ) : (
          <>
            <p className="m0">{settings.prReceipts ? "It is on." : "It is off."}</p>
            <PrReceiptsToggle projectId={project.id} on={settings.prReceipts} />
          </>
        )}
      </section>
    </main>
  );
}
