// Roadmap Phase 9: one next step, everywhere. From a few counts about the project, the single most useful thing to do
// now, said the same way on the Overview page and by `codeceipt status`: the words, the web page, the command, and
// what to ask the agent. Deterministic; the order is the order of urgency (an agent waiting on the owner comes first).

export type NextStepState = {
  /** Requests from agents waiting for the owner (approvals). */
  pendingApprovals: number;
  /** An unapproved plan draft (from plan_project or codeceipt import). */
  planDraft: boolean;
  receipts: number;
  /** Checklist items a receipt marked missed that are still open. */
  openMissed: number;
  features: number;
  /** Active (owner-approved) Blueprint criteria; null when the Blueprint is not set up. */
  criteria: number | null;
};

export type NextStep = {
  id: "approvals" | "plan" | "first_receipt" | "missed" | "criteria" | "all_clear";
  text: string;
  /** The project tab that does it (a path segment under /projects/:id). */
  page: "approvals" | "plan" | "connect" | "features" | "blueprint" | "overview";
  /** The terminal command for the same step, if there is one. */
  command: string | null;
  /** What to ask the agent, if the agent can do it. */
  askAgent: string | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0);

export function nextStep(state: NextStepState): NextStep {
  const approvals = count(state.pendingApprovals);
  const missed = count(state.openMissed);
  if (approvals > 0) {
    return {
      id: "approvals",
      text: `Your agents are waiting for you: ${plural(approvals, "request", "requests")} to approve or reject.`,
      page: "approvals",
      command: "codeceipt approvals",
      askAgent: null,
    };
  }
  if (state.planDraft) {
    return {
      id: "plan",
      text: "A plan is waiting for your approval. Nothing in it is active until you approve it.",
      page: "plan",
      command: null,
      askAgent: null,
    };
  }
  if (count(state.receipts) === 0) {
    return {
      id: "first_receipt",
      text: "Connect a repository and finish one agent session to get your first receipt.",
      page: "connect",
      command: "npx codeceipt",
      askAgent: null,
    };
  }
  if (missed > 0) {
    return {
      id: "missed",
      text: `${plural(missed, "checklist item", "checklist items")} your agent missed ${missed === 1 ? "is" : "are"} still open.`,
      page: "features",
      command: "codeceipt last",
      askAgent: "/codeceipt-fix the missed items from the last receipt",
    };
  }
  if (state.criteria === 0 && count(state.features) > 0) {
    return {
      id: "criteria",
      text: "Your features have no approved criteria yet: write down what done means for each one.",
      page: "blueprint",
      command: "codeceipt import --dry-run",
      askAgent: "Propose criteria for the next feature with propose_blueprint",
    };
  }
  return {
    id: "all_clear",
    text: "All clear. Keep your agent's files in step with the Blueprint.",
    page: state.criteria === null ? "overview" : "blueprint",
    command: state.criteria === null ? "codeceipt last" : "codeceipt export --to agents --check",
    askAgent: "/codeceipt-feature the next feature",
  };
}
