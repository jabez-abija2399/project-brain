-- FEAT-013: checklist items keep the order of the user's request (ids are random UUIDs, so ordering by id shuffled
-- them in receipts, judging prompts and the context pack). Existing items keep position 0 and fall back to id order.
ALTER TABLE "checklist_items" ADD COLUMN "position" integer NOT NULL DEFAULT 0;
