# Design contract: Project Brain
Short on purpose: use one component library as-is; spend design effort only on the key screens.

## Direction: "Calm ledger" (RECOMMENDED)
Feels like a trustworthy receipt or bank statement: quiet, precise, readable by non-engineers; status is obvious at a
glance. Must NOT feel like a hacker tool or a noisy security dashboard. References: Linear, Stripe Dashboard, Vercel.

Alternative: "Friendly coach": warmer colors, illustrated empty states, more encouraging copy (Duolingo-like tone).
Rejected for v1: trust and clarity matter more than delight for a verification product.

## Tokens (CSS variables / theme file: apps/web/src/app/globals.css; never hard-code colors)
--bg · --surface · --border · --text · --muted · --accent · --success · --warning · --danger
Light: bg #FAFAF9, surface #FFFFFF, border #E7E5E4, text #1C1917, muted #78716C, accent #4F46E5,
success #15803D, warning #B45309, danger #B91C1C. Dark mode: not in v1 (parked in agent/later.md); tokens are
structured so a dark theme can be added later without changing components.
Font: Inter (UI) + JetBrains Mono (paths, code refs). Radius 8 px. Spacing scale 4/8/12/16/24/32.

## Component inventory (build each once, reuse everywhere; add a row before creating a new shared component)
| Component | Path | Variants / props | Used by |
|---|---|---|---|
| Button | apps/web/src/components/ui/button | primary, secondary, ghost, danger; loading | all |
| StatusBadge | apps/web/src/components/ui/status-badge | done, partial, missed, open, warning; icon + label | receipts, features |
| Card | apps/web/src/components/ui/card | default, highlighted | receipts, projects |
| DataTable | apps/web/src/components/ui/data-table | loading, empty, error; pagination (50 max) | features, receipts |
| EmptyState | apps/web/src/components/ui/empty-state | title, text, one action | all lists |
| Dialog / ConfirmDialog | apps/web/src/components/ui/dialog | confirm destructive | tokens, features |
| CodeRef | apps/web/src/components/code-ref | path:line, mono, copy button | receipts, features |
| ChecklistItem | apps/web/src/components/checklist-item | status, evidence CodeRef | receipts |
| ReceiptCard | apps/web/src/components/receipt-card | collapsed, expanded | receipts feed, feature page |
| CopyCommand | apps/web/src/components/copy-command | command text + copy | onboarding |

## The screens that matter (max 3; polish these, everything else is plain components)
1. Receipts feed: newest receipts as ReceiptCards; asked / done / missed / outside scope / checks. Primary action:
   "Send fix to agent" (copies a prompt for missed items).
2. Feature board: features with status, file count, open items, last receipt. Primary action: open a feature.
3. Connect project (onboarding): sign in -> create project -> copy `npx projectbrain init` -> waiting for first index.
   Primary action: copy the command.

## Rules
- Status is never color alone: icon + label.
- Every async action: loading, success feedback, error message that says what to do next.
- Empty states have one clear button. Destructive actions need confirmation.
- Check at 375 px and 1280 px. Keyboard: Tab order, visible focus ring, labels on all inputs.
- Plain language for non-engineers: "Missed: reviews are not sorted by newest", not error codes.
- Anti-patterns: gradients, more than one primary button per view, red everywhere, raw JSON in the UI.
