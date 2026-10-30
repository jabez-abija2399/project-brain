import { LiveStatus } from "@/app/start/live-status";
import { JourneySteps } from "@/components/journey-steps";
import { orNotFound, pageUser } from "@/server/dashboard-page";
import { getDb } from "@/server/db";
import { projectSteps } from "@/server/onboarding";
import Link from "next/link";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

// The public address the CLI talks to (never a secret).
const appUrl = () => (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/+$/, "");

// Connect project (docs/DESIGN.md screen 3): the same `npx codeceipt` flow as the start page, with the status of
// this project: linked, first index, first receipt. No token is shown or pasted anywhere.
export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  const { project, steps } = await orNotFound(() => projectSteps(getDb(), user, id));
  const done = steps.linked && steps.indexed && steps.receipt;
  const current = [steps.linked, steps.indexed, steps.receipt].map((d) => (d ? "1" : "0")).join("");
  return (
    <main className="page stack">
      <div>
        <ProjectNav projectId={project.id} current="connect" name={project.name} />
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Connect a repository to this project: when the code page opens, pick this project. Its
        server is <code className="wrap">{appUrl()}</code>.
      </p>
      <JourneySteps steps={steps} />
      <LiveStatus on={!done} current={current} />
      {steps.receipt ? (
        <Link
          className="btn btn-primary"
          href={`/projects/${project.id}/receipts`}
          style={{ alignSelf: "flex-start" }}
        >
          Open the receipts
        </Link>
      ) : null}
    </main>
  );
}
