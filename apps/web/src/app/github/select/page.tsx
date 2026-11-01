import { PageHeader } from "@/components/shell/page-header";
import { pageUser } from "@/server/dashboard-page";
import RepoPicker from "./repo-picker";

export const dynamic = "force-dynamic";

// The repo selection screen (AC-009-01) for an installation that covers several repos.
export default async function SelectRepoPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  // Signed out: the sign-in page first (the picker's API needs a session anyway).
  await pageUser();
  const { state = "" } = await searchParams;
  return (
    <main className="page page-narrow stack stack-lg">
      <PageHeader
        title="Choose the repository"
        purpose="The GitHub App can see several repositories. Pick the one this project tracks; pushes to its default branch update the project."
      />
      <div className="card">
        <RepoPicker state={state} />
      </div>
    </main>
  );
}
