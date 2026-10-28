-- FEAT-012: checklist items know when they need clarification, and an agent's change to an item is only a proposal
-- (proposed_change: {"text": "..."} or {"dismiss": true}) until the project owner confirms it in the dashboard.
ALTER TABLE "checklist_items" ADD COLUMN "needs_clarification" boolean NOT NULL DEFAULT false;
ALTER TABLE "checklist_items" ADD COLUMN "proposed_change" jsonb;
ALTER TABLE "checklist_items" ADD COLUMN "proposed_at" timestamptz;
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_status_check"
  CHECK ("status" IN ('open', 'done', 'partial', 'missed', 'dismissed'));
