import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination } from "@/components/ui/pagination";
import { type Status, StatusBadge } from "@/components/ui/status-badge";
import { featureBoard } from "@/server/dashboard";
import { type ListPageProps, loadListPage } from "@/server/dashboard-page";
import { ProjectNav } from "../project-nav";

export const dynamic = "force-dynamic";

const FEATURE_STATUS: Record<string, { status: Status; label: string }> = {
  todo: { status: "open", label: "To do" },
  in_progress: { status: "partial", label: "In progress" },
  done: { status: "done", label: "Done" },
};

// Feature board (docs/DESIGN.md screen 2): status, files, open checklist items and the last receipt per feature.
export default async function FeatureBoardPage(props: ListPageProps) {
  const board = await loadListPage(props, featureBoard);
  const base = `/projects/${board.project.id}`;
  return (
    <main className="page">
      <ProjectNav projectId={board.project.id} current="features" name={board.project.name} />
      {board.total === 0 ? (
        <EmptyState
          title="No features yet"
          text="Features grouped from your code appear here after the first index: run npx codeceipt in your project."
          action={{ label: "Get started", href: "/start" }}
        />
      ) : (
        <>
          <DataTable
            caption={`${board.total} features`}
            rows={board.rows}
            rowKey={(r) => r.id}
            columns={[
              { key: "name", header: "Feature", cell: (r) => <strong>{r.name}</strong> },
              {
                key: "status",
                header: "Status",
                cell: (r) => {
                  const s = FEATURE_STATUS[r.status] ?? {
                    status: "neutral" as const,
                    label: r.status,
                  };
                  return <StatusBadge status={s.status} label={s.label} />;
                },
              },
              { key: "files", header: "Files", cell: (r) => r.files },
              {
                key: "open",
                header: "Open items",
                cell: (r) =>
                  r.openItems > 0 ? (
                    <StatusBadge status="warning" label={`${r.openItems} open`} />
                  ) : (
                    <StatusBadge status="done" label="None open" />
                  ),
              },
              {
                key: "receipt",
                header: "Last receipt",
                cell: (r) =>
                  r.lastReceiptAt ? (
                    <time dateTime={r.lastReceiptAt}>{r.lastReceiptAt.slice(0, 10)}</time>
                  ) : (
                    <span className="muted">None yet</span>
                  ),
              },
            ]}
          />
          <Pagination page={board.page} pages={board.pages} basePath={`${base}/features`} />
        </>
      )}
    </main>
  );
}
