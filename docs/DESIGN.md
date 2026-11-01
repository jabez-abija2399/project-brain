# Design contract: Codeceipt
Short on purpose: use one component library as-is; spend design effort only on the key screens.

## Direction: "Receipt" (owner, 2026-11-01; replaces "Bright ledger")
A warm off-white ground, ink text, one indigo accent and status colours (green done, amber partial or untested, red
missed), always with an icon and a word. The signature element is the receipt: white paper (in both themes), a torn
bottom edge, monospace text. Monospace only for receipts, terminals and code; everything else uses the UI font.
Generous spacing, max content width 1120 px, one display size (landing hero), one section size, one body size.
No gradients, glows, all-caps labels, emoji, coloured words inside headlines, identical card grids with soft shadows,
or arrows on buttons. Motion: the landing receipt prints once on load; terminal sequences play only when clicked;
prefers-reduced-motion shows the final state. Every page starts with breadcrumbs (where useful), a title, one purpose
sentence and at most one primary action, inside the shared shell (header with project switcher and sign out, the
landing page's footer). Screenshots: docs/screenshots/ (landing-*, pages/*).

## Earlier direction: "Bright ledger" (2026-10-31)
Cool neutrals with gradient primary buttons, a landing glow and lifting cards. Replaced: too decorative for a
verification product.

## Earlier direction: "Calm ledger"
Feels like a trustworthy receipt or bank statement: quiet, precise, readable by non-engineers; status is obvious at a
glance. Must NOT feel like a hacker tool or a noisy security dashboard. References: Linear, Stripe Dashboard, Vercel.

Alternative: "Friendly coach": warmer colors, illustrated empty states, more encouraging copy (Duolingo-like tone).
Rejected for v1: trust and clarity matter more than delight for a verification product.

## Tokens (CSS variables / theme file: apps/web/src/app/globals.css; never hard-code colors)
--bg · --surface · --surface-2 · --border · --border-strong · --text · --muted · --accent · --accent-soft ·
--on-accent · --success(-soft) · --warning(-soft) · --danger(-soft) · --ink / --on-ink / --on-ink-muted (always dark:
printer, terminals, tooltips, the final band) · --paper / --paper-text / --paper-muted / --paper-line (receipts,
white in both themes) · --radius · --radius-sm · --shadow-sm · --shadow-md · --ring · --ease · --fs-display ·
--fs-section · --fs-title · --fs-body · --fs-small · --font-ui · --font-mono · --content (1120 px)
Light: bg #F7F5F0, surface #FFFFFF, surface-2 #F1EEE7, border #E6E2D8, text #17181C, muted #5C5850, accent #4F46E5,
success #047857, warning #9A4508, danger #C11F1F (each with a soft tint for badge backgrounds). Every text colour is
at least 4.5:1 on the backgrounds it sits on, in both themes. Dark mode: automatic (prefers-color-scheme), same token
names; receipts keep the light status colours on white paper.
Font: Inter (UI) + JetBrains Mono (receipts, terminals, code). Radius 12 px (cards), 10 px (buttons).
Spacing 4/8/12/16/24/32/48. Landing-only styles: apps/web/src/app/landing.css; everything else: globals.css.

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
| ReceiptsFilter | apps/web/src/components/receipts-filter | chips with counts, search, shortcuts (/ j k o), day headings | receipts feed |
| StatCard | apps/web/src/components/ui/stat-card | label, value, hint, href; tone neutral/danger/warning/success | overview |
| ActivityChart | apps/web/src/components/activity-chart | 14 days, stacked all good / needs attention, focusable bars | overview |
| ProgressBar | apps/web/src/components/ui/progress-bar | done, total, label (role progressbar) | overview |
| Skeleton | apps/web/src/components/ui/skeleton | block; ProjectHeaderSkeleton | loading.tsx pages |
| FeaturesFilter | apps/web/src/components/features-filter | search + chips over table rows (data-feature marker) | feature board |
| AppShell | apps/web/src/components/shell/app-shell | header (project switcher, sign out), footer; public header signed out | layouts, 404 |
| PageHeader / Breadcrumbs | apps/web/src/components/shell/page-header | crumbs, title, purpose sentence, one action | every page |
| ProjectSwitcher | apps/web/src/components/shell/project-switcher | native details menu of the user's projects | AppShell |
| CommandBox | apps/web/src/components/landing/command-box | command + copy button (Copy / Copied / Copy failed); light or ink | landing, CopyCommand, docs |
| Paper | apps/web/src/components/landing/receipt | receipt paper with torn edge, mono | landing receipts |
| AgentTabs / HowTerminal / ReceiptStates / PrivacyToggle | apps/web/src/components/landing | WAI-ARIA tabs; step buttons + typed terminal; state buttons; toggle | landing |
| StateGuide | apps/web/src/components/state-guide | what each receipt state means; open on first view | receipts feed |
| DocPage | apps/web/src/components/landing/doc-page | title, table of contents from h2s, 68ch text | docs, privacy, terms |

## The screens that matter (max 3; polish these, everything else is plain components)
0. Project overview (2026-11-01, the first tab): leads with the decision ("2 receipts need your attention this
   week"), four numbers in priority order (needs attention, open missed items, done this week, security findings),
   each a link to the next step; a 14-day activity chart; the newest receipts needing attention with why; progress
   per feature. Inspiration: Vercel (filters, find, keyboard), Linear (few purposeful dashboards, keyboard-first),
   dashboard practice "what needs attention, why, what next" and "summarize, then drill down".
1. Receipts feed: newest receipts as ReceiptCards; asked / done / missed / outside scope / checks. Primary action:
   "Send fix to agent" (copies a prompt for missed items).
2. Feature board: a summary over the whole project (to do, in progress, done, with open items), then each feature
   with status, the next open item, progress (done of total), files, open items and the last receipt ("3 days ago").
   Sort on the server (name, most open, recent receipt; kept across pages); search and chips filter the rows in place.
3. Connect project (onboarding): sign in -> /start (or the Connect tab) -> copy `npx codeceipt` -> approve the code -> first index -> first receipt, each step ticking off by itself.
   Primary action: copy the command.

## Rules
- Status is never color alone: icon + label.
- Every async action: loading, success feedback, error message that says what to do next.
- Every page that loads data has a skeleton shaped like the page (aria-busy, "Loading …" for screen readers).
- Lists users scan daily get search and keyboard shortcuts, shown on the page (receipts: / j k o).
- Empty states have one clear button. Destructive actions need confirmation.
- Check at 375 px and 1280 px. Keyboard: Tab order, visible focus ring, labels on all inputs.
- Plain language for non-engineers: "Missed: reviews are not sorted by newest", not error codes.
- Anti-patterns: more than one primary button per view, red everywhere, raw JSON in the UI, motion that ignores
  prefers-reduced-motion, gradients or glows anywhere.
