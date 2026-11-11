import {
  type NextStepState,
  nextStep,
  prReceiptCounts,
  receiptView,
  safeDisplay,
} from "@brain/core";
import type { CliConfig } from "./config";

// Roadmap Phase 9: `codeceipt status`. The server sends counts only; the CLI chooses and words the next step itself
// (the same core function the Overview page uses), so no server text reaches the terminal.

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0;

/** The counts from the server, read as numbers and booleans only (anything else counts as none). */
export function readState(raw: unknown): NextStepState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    pendingApprovals: num(s.pendingApprovals),
    planDraft: s.planDraft === true,
    receipts: num(s.receipts),
    openMissed: num(s.openMissed),
    features: num(s.features),
    criteria: s.criteria === null ? null : num(s.criteria),
  };
}

export function statusLines(
  raw: unknown,
  config: Pick<CliConfig, "apiUrl" | "projectId">,
): string[] {
  const step = nextStep(readState(raw));
  const base = `${config.apiUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(config.projectId)}`;
  const lines = [`Next step: ${step.text}`];
  lines.push(`  On the web: ${base}/${step.page}`);
  if (step.command) lines.push(`  In the terminal: ${step.command}`);
  if (step.askAgent) lines.push(`  Ask your agent: ${step.askAgent}`);
  return lines;
}

// Roadmap Phase 11: the same answers as data, for editors (the VS Code extension reads these). No token and no server
// text: counts, fixed words, and the owner's own missed item texts (cleaned, capped).
const projectUrl = (config: Pick<CliConfig, "apiUrl" | "projectId">) =>
  `${config.apiUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(config.projectId)}`;

export function statusJson(raw: unknown, config: Pick<CliConfig, "apiUrl" | "projectId">) {
  const step = nextStep(readState(raw));
  return {
    next: {
      id: step.id,
      text: step.text,
      url: `${projectUrl(config)}/${step.page}`,
      command: step.command,
      ask_agent: step.askAgent,
    },
  };
}

export function lastJson(
  receipt: Record<string, unknown> | null,
  receiptId: string | null,
  createdAt: string | null,
  config: Pick<CliConfig, "apiUrl" | "projectId">,
) {
  const url = `${projectUrl(config)}/receipts`;
  if (!receipt) return { receipt: null, url };
  const view = receiptView(receipt);
  const c = prReceiptCounts([view]);
  return {
    receipt: {
      id: receiptId,
      created_at: createdAt,
      counts: {
        done: c.done,
        partly_done: c.partial,
        missed: c.missed,
        not_verified: c.notVerified,
        security_findings: c.findings,
        test_checks: c.testChecks,
        claims_contradicted: c.contradicted,
      },
      missed: view.items
        .filter((i) => i.status === "missed")
        .slice(0, 20)
        .map((i) => safeDisplay(i.text, 200)),
    },
    url,
  };
}
