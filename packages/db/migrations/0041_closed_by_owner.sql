-- 2026-11-02 (owner item 3): an item the owner closed is "Closed by you", never shown as done by the agent. The flag is
-- set only by the owner's Close; a receipt judge never overwrites a row with it set (checklistItemsRepo.setStatuses).
-- Existing rows are false: the agent's own done items stay "Done".
ALTER TABLE "checklist_items" ADD COLUMN "closed_by_owner" boolean DEFAULT false NOT NULL;
