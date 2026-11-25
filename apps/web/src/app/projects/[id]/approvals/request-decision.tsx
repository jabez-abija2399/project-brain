"use client";

import { useState } from "react";
import { ApprovalAction } from "./approval-actions";

// FEAT-035: one request, two choices (Approve, Reject) and a "Remember my choice" box instead of four buttons.
// Remembering a risky or broad choice still asks to confirm (the server says so; approval-actions.tsx asks).
export function RequestDecision({
  projectId,
  requestId,
  summary,
}: {
  projectId: string;
  requestId: string;
  summary: string;
}) {
  const [remember, setRemember] = useState(false);
  const body = (decision: "approve" | "reject") => ({
    requestId,
    decision,
    ...(remember ? { remember: true } : {}),
  });
  return (
    <div className="stack gap-6">
      <span className="row wrap">
        <ApprovalAction
          projectId={projectId}
          path="decide"
          body={body("approve")}
          label="Approve"
          done={remember ? "Approved, and remembered." : "Approved."}
          variant="primary"
          ariaLabel={`Approve: ${summary}`}
        />
        <ApprovalAction
          projectId={projectId}
          path="decide"
          body={body("reject")}
          label="Reject"
          done={remember ? "Rejected, and remembered." : "Rejected."}
          ariaLabel={`Reject: ${summary}`}
        />
      </span>
      <label className="check-row muted">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>Remember my choice for this kind of action</span>
      </label>
    </div>
  );
}
