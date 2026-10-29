import type { ReceiptItemStatus } from "@brain/core";
import { CodeRef } from "./code-ref";
import { StatusBadge } from "./ui/status-badge";

export function ChecklistItem({
  text,
  status,
  evidence,
}: {
  text: string;
  status: ReceiptItemStatus;
  evidence: string[];
}) {
  return (
    <li className="stack" style={{ gap: 4 }}>
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
    </li>
  );
}
