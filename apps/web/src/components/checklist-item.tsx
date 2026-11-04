import type { ReceiptItemStatus } from "@brain/core";
import { ChecklistItemActions } from "./checklist-item-actions";
import { CodeRef } from "./code-ref";
import { StatusBadge } from "./ui/status-badge";

// `action` is given for an open item the owner can close or dismiss (H3); a receipt row without an item id has none.
// Owner item 3 (2026-11-02): an item the owner closed reads "Closed by you", never the agent's status.
export function ChecklistItem({
  text,
  status,
  evidence,
  action,
  closedByOwner,
  readOnly = false,
}: {
  text: string;
  status: ReceiptItemStatus | "open";
  evidence: string[];
  action?: { projectId: string; itemId: string };
  closedByOwner?: true;
  // FEAT-021: on a shared page the viewer is not the owner ("Closed by the owner", not "by you").
  readOnly?: boolean;
}) {
  return (
    <li className="stack gap-4">
      <span className="row">
        <StatusBadge
          status={closedByOwner ? "closed_by_owner" : status}
          {...(closedByOwner && readOnly ? { label: "Closed by the owner" } : {})}
        />
        <span className="wrap">{text}</span>
      </span>
      {evidence.length > 0 && (
        <span className="row muted">
          {evidence.map((p) => (
            <CodeRef key={p} path={p} />
          ))}
        </span>
      )}
      {action && (
        <ChecklistItemActions
          projectId={action.projectId}
          itemId={action.itemId}
          text={text}
          status={status}
        />
      )}
    </li>
  );
}
