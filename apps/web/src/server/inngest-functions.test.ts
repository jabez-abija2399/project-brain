import { describe, expect, it } from "vitest";
import { PR_RECEIPT_OPTIONS } from "./inngest-functions";

// Backlog wave D: pull-request events are debounced per project and pull request.
describe("pull-request receipt job", () => {
  it("BL-42 a burst of pushes to one pull request makes one job, per project and pull request, at least every 5 minutes", () => {
    expect(PR_RECEIPT_OPTIONS.debounce).toEqual({
      key: 'event.data.projectId + "-" + string(event.data.number)',
      period: "30s",
      timeout: "5m",
    });
    // Still one job at a time per project.
    expect(PR_RECEIPT_OPTIONS.concurrency).toEqual({ limit: 1, key: "event.data.projectId" });
  });
});
