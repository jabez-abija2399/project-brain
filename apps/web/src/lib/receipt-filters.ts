// FEAT-032: the receipts list's filters, shared by the page (server) and the filter bar (client).
export type Filter = "all" | "attention" | "good" | "missed" | "findings";
export const FILTERS: Filter[] = ["all", "attention", "good", "missed", "findings"];
