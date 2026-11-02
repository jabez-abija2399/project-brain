import { safeDisplay } from "@brain/core";

// Known gap of PR #36, fixed: an item the owner closed is shown as "Closed by you" and an item the owner dismissed as
// "Dismissed", by `codeceipt last`, never as "missed" or "done" from the agent. The server names those items by id
// (owner_closed_ids, dismissed_ids); only plain ids of the receipt's own items take effect.
const PLAIN_ID = /^[\w-]{1,64}$/;
const MAX_IDS = 500;

function plainIds(value: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  for (const id of value.slice(0, MAX_IDS)) {
    if (typeof id === "string" && PLAIN_ID.test(id)) out.add(id);
  }
  return out;
}

/** A copy of the receipt whose owner-closed and dismissed items carry their owner status, not the agent's verdict. */
export function applyOwnerStates(
  receipt: Record<string, unknown>,
  closedIds: unknown,
  dismissedIds: unknown,
): Record<string, unknown> {
  if (!Array.isArray(receipt.items)) return receipt;
  const closed = plainIds(closedIds);
  const dismissed = plainIds(dismissedIds);
  if (closed.size === 0 && dismissed.size === 0) return receipt;
  const items = receipt.items.map((item) => {
    if (typeof item !== "object" || item === null) return item;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string") return item;
    if (dismissed.has(id)) return { ...item, status: "dismissed" };
    if (closed.has(id)) return { ...item, status: "closed_by_owner" };
    return item;
  });
  return { ...receipt, items };
}

/** One line per owner-closed or dismissed item, after the summary. Text is cleaned like the rest of the output. */
export function ownerStateLines(receipt: Record<string, unknown>): string[] {
  if (!Array.isArray(receipt.items)) return [];
  const lines: string[] = [];
  for (const item of receipt.items) {
    if (typeof item !== "object" || item === null) continue;
    const { status, text } = item as { status?: unknown; text?: unknown };
    const shown = typeof text === "string" ? safeDisplay(text, 200) : "";
    if (shown === "") continue;
    if (status === "closed_by_owner") lines.push(`Closed by you: ${shown}`);
    if (status === "dismissed") lines.push(`Dismissed: ${shown}`);
  }
  return lines.slice(0, 30);
}
