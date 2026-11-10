import { describe, expect, it } from "vitest";
import { type NextStepState, nextStep } from "./next-step";

// Roadmap Phase 9: one next step, in order of urgency.
const base: NextStepState = {
  pendingApprovals: 0,
  planDraft: false,
  receipts: 3,
  openMissed: 0,
  features: 4,
  criteria: 10,
};

describe("Phase 9: next step", () => {
  it("PH9-01 an agent waiting on the owner comes first, then a plan draft", () => {
    const all = { ...base, pendingApprovals: 2, planDraft: true, openMissed: 5 };
    expect(nextStep(all)).toMatchObject({
      id: "approvals",
      page: "approvals",
      command: "codeceipt approvals",
      text: "Your agents are waiting for you: 2 requests to approve or reject.",
    });
    expect(nextStep({ ...all, pendingApprovals: 0 })).toMatchObject({ id: "plan", page: "plan" });
  });

  it("PH9-02 no receipts yet points to connecting; missed items point to the fix workflow", () => {
    expect(nextStep({ ...base, receipts: 0 })).toMatchObject({
      id: "first_receipt",
      page: "connect",
      command: "npx codeceipt",
    });
    expect(nextStep({ ...base, openMissed: 1 })).toMatchObject({
      id: "missed",
      text: "1 checklist item your agent missed is still open.",
      askAgent: expect.stringContaining("/codeceipt-fix"),
    });
  });

  it("PH9-03 features without criteria point to the Blueprint; otherwise all clear with the export check", () => {
    expect(nextStep({ ...base, criteria: 0 })).toMatchObject({ id: "criteria", page: "blueprint" });
    expect(nextStep(base)).toMatchObject({
      id: "all_clear",
      command: "codeceipt export --to agents --check",
    });
    // Before the Blueprint is set up, the export check is not offered.
    expect(nextStep({ ...base, criteria: null })).toMatchObject({
      id: "all_clear",
      page: "overview",
    });
  });

  it("PH9-04 odd counts (negative, fractional, not a number) are read as none", () => {
    expect(nextStep({ ...base, pendingApprovals: -3, openMissed: Number.NaN })).toMatchObject({
      id: "all_clear",
    });
    expect(nextStep({ ...base, pendingApprovals: 1.7 }).text).toContain("1 request to approve");
  });
});
