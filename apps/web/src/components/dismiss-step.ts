// Owner item 1 (2026-11-02): Dismiss is a two-step action. The first click only asks ("Confirm dismiss" / "Cancel");
// the request is sent only by the confirm. Pure, so the rule is tested without a DOM.
export type DismissStep = "idle" | "confirming";
export type DismissEvent = "dismiss" | "confirm" | "cancel";

export function nextDismissStep(
  step: DismissStep,
  event: DismissEvent,
): { step: DismissStep; send: boolean } {
  if (step === "idle" && event === "dismiss") return { step: "confirming", send: false };
  if (step === "confirming" && event === "confirm") return { step: "idle", send: true };
  if (step === "confirming" && event === "cancel") return { step: "idle", send: false };
  return { step: "idle", send: false };
}
