import { CLAIM_KINDS, CLAIM_VERDICTS, safePath } from "@brain/core";
import { z } from "zod";
import { repoPath } from "./code-index-input";

// Roadmap Phase 10: the claim checker's result, as the session-end hook found it on the user's machine. A claim is a
// kind, a repo path when it names one, and a verdict: never the agent's words (the summary stays on the machine).
export const MAX_RECEIPT_CLAIMS = 20;

export const claimsInput = z
  .array(
    z
      .object({
        kind: z.enum(CLAIM_KINDS),
        verdict: z.enum(CLAIM_VERDICTS),
        path: repoPath.optional(),
      })
      .strict(),
  )
  .max(MAX_RECEIPT_CLAIMS);

export type ReceiptClaims = {
  items: { kind: string; verdict: string; path?: string }[];
  confirmed: number;
  contradicted: number;
  cannot_check: number;
};

/** The receipt's claims section (paths masked per segment); null when the hook sent none. */
export function receiptClaims(
  input: z.infer<typeof claimsInput> | undefined,
): ReceiptClaims | null {
  if (!input || input.length === 0) return null;
  const items = input.map((c) => ({
    kind: c.kind,
    verdict: c.verdict,
    ...(c.path ? { path: safePath(c.path) } : {}),
  }));
  const count = (v: string) => items.filter((i) => i.verdict === v).length;
  return {
    items,
    confirmed: count("confirmed"),
    contradicted: count("contradicted"),
    cannot_check: count("cannot_check"),
  };
}
