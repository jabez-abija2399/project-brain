import RepoPicker from "./repo-picker";

export const dynamic = "force-dynamic";

// The repo selection screen (AC-009-01) for an installation that covers several repos.
export default async function SelectRepoPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state = "" } = await searchParams;
  return (
    <main style={{ padding: "48px 32px", maxWidth: 640, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Choose the repository</h1>
      <p style={{ color: "var(--muted)", marginBottom: 24 }}>
        The GitHub App can see several repositories. Pick the one this project tracks; pushes to its
        default branch update the project.
      </p>
      <RepoPicker state={state} />
    </main>
  );
}
