# Design contract: Codeceipt
Short on purpose: use one component library as-is; spend design effort only on the key screens.

## Direction: "Bright ledger" (owner, 2026-10-31; replaces "Calm ledger")
The calm ledger made brighter and more interactive: cool neutrals, one indigo accent (with a violet second stop for
primary buttons and the landing glow), soft tinted status colors, 12 px cards with layered shadows that lift on
hover, filled status badges, pill tabs, a turning chevron and fade when a receipt opens, filter chips on the
receipts feed, and an automatic dark mode. Motion is short (120-300 ms) and stops under prefers-reduced-motion.
Screenshots: docs/screenshots/ (landing, receipts light and dark).

## Earlier direction: "Calm ledger"
Feels like a trustworthy receipt or bank statement: quiet, precise, readable by non-engineers; status is obvious at a
glance. Must NOT feel like a hacker tool or a noisy security dashboard. References: Linear, Stripe Dashboard, Vercel.

Alternative: "Friendly coach": warmer colors, illustrated empty states, more encouraging copy (Duolingo-like tone).
Rejected for v1: trust and clarity matter more than delight for a verification product.

## Tokens (CSS variables / theme file: apps/web/src/app/globals.css; never hard-code colors)
--bg · --surface · --surface-2 · --border · --text · --muted · --accent · --accent-2 · --accent-soft ·
--success(-soft) · --warning(-soft) · --danger(-soft) · --radius · --shadow-sm · --shadow-md · --ring · --ease ·
--ink / --on-ink (always dark: the receipt printer and the final call to action)
Light: bg #F6F7FB, surface #FFFFFF, surface-2 #F1F3F9, border #E3E6EF, text #0B1020, muted #5B6478, accent #5146E5,
accent-2 #7C3AED, success #047857, warning #B45309, danger #C81E1E (each with a soft tint for badge backgrounds).
Dark mode: automatic (prefers-color-scheme), same token names, components unchanged.
Font: Inter (UI) + JetBrains Mono (paths, code refs). Radius 12 px (cards), 10 px (buttons). Spacing 4/8/12/16/24/32.

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
| JourneySteps | apps/web/src/components/journey-steps | linked, indexed, receipt (each done or waiting) | start page, Connect tab |
| CopyButton | apps/web/src/components/ui/copy-button | label, text; copied / failed feedback | receipts ("Send fix to agent"), CopyCommand |
| Pagination | apps/web/src/components/ui/pagination | page, pages, basePath (?page=N, 50 per page) | features, receipts, proposals |
| Disclosure | apps/web/src/components/ui/disclosure | open; summary; body rendered on first open (INP) | ReceiptCard |
| ReceiptsFilter | apps/web/src/components/receipts-filter | All / Needs attention / All good chips with counts | receipts feed |

## The screens that matter (max 3; polish these, everything else is plain components)
1. Receipts feed: newest receipts as ReceiptCards; asked / done / missed / outside scope / checks. Primary action:
   "Send fix to agent" (copies a prompt for missed items).
2. Feature board: features with status, file count, open items, last receipt. Primary action: open a feature.
3. Connect project (onboarding): sign in -> /start (or the Connect tab) -> copy `npx codeceipt` -> approve the code -> first index -> first receipt, each step ticking off by itself.
   Primary action: copy the command.

## Rules
- Status is never color alone: icon + label.
- Every async action: loading, success feedback, error message that says what to do next.
- Empty states have one clear button. Destructive actions need confirmation.
- Check at 375 px and 1280 px. Keyboard: Tab order, visible focus ring, labels on all inputs.
- Plain language for non-engineers: "Missed: reviews are not sorted by newest", not error codes.
- Anti-patterns: more than one primary button per view, red everywhere, raw JSON in the UI, motion that ignores
  prefers-reduced-motion. Gradients only on the primary button, the landing hero glow and the final call to action.
