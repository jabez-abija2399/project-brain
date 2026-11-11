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

// Roadmap Phase 10b: the event the webhook sends for a pull request of a linked project with PR receipts on.
export const PR_EVENT = "github/pull_request.received";
export type PrEventData = {
  projectId: string;
  installationId: number;
  repo: string;
  number: number;
  headSha: string;
  // Only a repository GitHub says is private gets item text in its comment.
  publicRepo: boolean;
  deliveryId: string;
};

export type EventSender = (events: { name: string; data: PushEventData }[]) => Promise<void>;
export type PrEventSender = (events: { name: string; data: PrEventData }[]) => Promise<void>;

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

let prSenderOverride: PrEventSender | undefined;

export function getPrEventSender(): PrEventSender {
  if (prSenderOverride) return prSenderOverride;
  return async (events) => {
    await inngest.send(events);
  };
}

// Test-only: capture pull-request events instead of sending them to Inngest.
export function setPrEventSenderForTests(sender: PrEventSender | undefined): void {
  prSenderOverride = sender;
}
