import type { ReceiptItemStatus } from "@brain/core";
import { ChecklistItemActions } from "./checklist-item-actions";
import { CodeRef } from "./code-ref";
import { StatusBadge } from "./ui/status-badge";

// `action` is given for an open item the owner can close or dismiss (H3); a receipt row without an item id has none.
export function ChecklistItem({
  text,
  status,
  evidence,
  action,
}: {
  text: string;
  status: ReceiptItemStatus;
  evidence: string[];
  action?: { projectId: string; itemId: string };
}) {
  return (
    <li className="stack gap-4">
      <span className="row">
        <StatusBadge status={status} />
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
