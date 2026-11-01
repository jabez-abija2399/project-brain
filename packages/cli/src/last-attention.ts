import { receiptView, safeDisplay } from "@brain/core";

// Real-test C (2026-11-01): `codeceipt last` names what needs attention, not just counts: each test check (file and
// test names), each security finding (masked), each question and postponed item, and each item not done. The stored
// receipt is data: it is read through receiptView (cleaned, masked again, capped) and control characters are dropped,
// so nothing the server says reaches the terminal raw.
const MAX_LINES = 30;
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;
const clean = (text: string) => safeDisplay(text.replace(CONTROL, ""), 200);
const ASKED = " [You asked for this]";

export function attentionLines(receipt: Record<string, unknown>): string[] {
  const view = receiptView(receipt);
  const out: string[] = [];
  for (const c of view.testChecks) {
    const names = c.names.length > 0 ? `: ${c.names.map(clean).join("; ")}` : "";
    out.push(
      `Test check: ${c.label} (${c.count}) in ${clean(c.file)}${names}${c.asked ? ASKED : ""}`,
    );
  }
  for (const f of view.findings) {
    const where = f.file ? ` in ${clean(f.file)}${f.line ? `:${f.line}` : ""}` : "";
    const value = f.maskedValue ? ` (${clean(f.maskedValue)})` : "";
    out.push(
      `Security finding: ${clean(f.type).replaceAll("_", " ")}${where}${value}${f.asked ? ASKED : ""}`,
    );
  }
  if (view.findingsOmitted > 0) out.push(`...and ${view.findingsOmitted} more security findings`);
  const LABEL: Record<string, string> = {
    missed: "Missed",
    partial: "Partly done",
    not_done: "Not done",
    not_verified: "Not verified",
    question: "Question",
    postponed: "Postponed",
  };
  for (const i of view.items) {
    const label = LABEL[i.status];
    if (label) out.push(`${label}: ${clean(i.text)}`);
  }
  for (const d of view.dependencies) {
    const change = d.from ? `${clean(d.from)} -> ${clean(d.range)}` : `added ${clean(d.range)}`;
    const verdict = d.recommendation
      ? d.recommendation.replaceAll("_", " ")
      : d.note
        ? clean(d.note)
        : "not checked";
    out.push(`Dependency: ${clean(d.name)} ${change} in ${clean(d.path)} (check_package: ${verdict})`);
  }
  for (const p of view.outsideScope) {
    out.push(
      `Outside the request: ${clean(p)}${view.outsideScopeAsked.includes(p) ? ASKED : ""}`,
    );
  }
  if (out.length === 0) return [];
  const shown = out.slice(0, MAX_LINES).map((l) => `  - ${l}`);
  if (out.length > MAX_LINES) shown.push(`  ...and ${out.length - MAX_LINES} more in the receipt`);
  return ["Needs attention:", ...shown];
}
