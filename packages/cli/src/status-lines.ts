import { type NextStepState, nextStep } from "@brain/core";
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
