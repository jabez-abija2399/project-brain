import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "project-brain" });

// The event the webhook sends for each linked project of a push (FEAT-009).
export const PUSH_EVENT = "github/push.received";
export type PushEventData = {
  projectId: string;
  installationId: number;
  repo: string;
  before: string;
  after: string;
  deliveryId: string;
};

export type EventSender = (events: { name: string; data: PushEventData }[]) => Promise<void>;

let senderOverride: EventSender | undefined;

export function getEventSender(): EventSender {
  if (senderOverride) return senderOverride;
  return async (events) => {
    await inngest.send(events);
  };
}

// Test-only: capture events instead of sending them to Inngest (undefined restores the real sender).
export function setEventSenderForTests(sender: EventSender | undefined): void {
  senderOverride = sender;
}
