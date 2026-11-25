# Design plan: make every page easy, clear and lovable (2026-11-25)

Owner request (2026-11-25): every section user-friendly, easy to understand and lovable; research inspiration;
plan every page, none left out. Sources: six reviews of the code and screenshots (public pages, onboarding, project
pages, blueprint, account/admin/shell, outside inspiration). Keeps the "Receipt" direction in docs/DESIGN.md
(warm paper, one indigo accent, icon + word for status, no gradients, emoji or all-caps). Build one phase per
session; each item names the files to touch. P1 = must, P2 = should, P3 = nice.

## Principles (what "lovable" means for Codeceipt)
1. **A sentence first, identifiers second.** Every receipt, row and event leads with plain words ("Your agent did
   3 of 4 things; 1 needs a look"); SHAs, IDs, paths and SQL sit behind "Technical details". (Stripe shows what to
   avoid; CodeRabbit walkthroughs show how.)
2. **Say who has to act.** Group by "Needs you / Agent is fixing / All good" (Graphite inbox), with counts on tabs.
3. **One next step per screen.** One primary button, placed where the eye lands; every stat links to the exact
   filtered list (Plausible, Stripe Home).
4. **Zoom, don't dump.** Show the summary, open details on request (NN/g progressive disclosure; C4 zoom levels).
5. **Explain words once.** Glossary tooltips (dotted underline, open on hover and keyboard focus) for receipt,
   blueprint/rules, checklist item, RLS, MCP, index, token; a /glossary page.
6. **Calm delight.** One printed "All done" stamp on the receipt paper, a first-receipt moment, "All clear" empty
   states; always respects prefers-reduced-motion. Dry humour only in empty states, never in errors.
7. **Times people read.** "2 days ago" / "Today 14:19" in local time everywhere; full date on hover.

## Phase 0: shared foundations (every later phase uses these)
- P1 `formatRelative` / `formatDay` helper in apps/web/src (replaces 15+ `slice(0,10)`, `slice(0,16)+" UTC"`,
  `toLocaleDateString`, `toUTCString` in receipt-card, overview, plan, proposals, approvals, account, tokens, admin).
- P1 `ConfirmDialog` (listed in DESIGN.md, never built): consequence sentence, danger style, type-the-name for
  deletes (GitHub). Replaces `window.confirm` in blueprint-actions.tsx:39, approval-actions.tsx:60,
  tokens-panel.tsx:141-148 (double confirm) and the hand-rolled confirms in account and admin suspend.
- P1 Mobile header menu: at <=560 px Account/Admin vanish (globals.css:1100-1103). Add a "Menu" disclosure
  (Docs, Account, Admin when admin, Sign out); add Account to the footer.
- P1 Glossary tooltip component + /glossary DocPage.
- P2 Tab rows (project and admin): fade mask at the scroll edge, scroll the active tab into view.
- P2 UI kit: Button `sm` and `danger` variants, specific loading labels ("Approving…"), `btn-secondary` CSS;
  EmptyState used everywhere (9 hand-rolled `.empty`), action optional for "all caught up" states; DataTable used
  for all tables with numbers right-aligned; Pagination without arrows; StatusBadge "inactive/revoked" variant.
- P2 Error pages say what failed and what to do; `admin/error.tsx`; loading skeletons shaped like each page
  (admin has none; account skeleton width jumps).
- P3 "?" opens the shortcut sheet for the current page, plus a setting to turn single-letter shortcuts off.

## Phase 1: trust fixes (bugs and contradictions people notice first)
- P1 Pricing story contradicts itself: landing/FAQ/terms say "Free during the beta", /pricing sells $12/$29/$79
  (landing.tsx:84,220; content.ts:372; pricing-body.tsx; plans.ts). **Owner decides** which story, then add
  Pricing to the header and footer.
- P1 Remove visible launch placeholders: `[REVIEW]` on privacy (74,79,92,123,127) and terms (152,174,186,191);
  `[SCREENSHOT]` boxes on quickstart (88-93). Keep them as code comments.
- P1 Onboarding steps tick at the wrong moment: step 1 "Run npx codeceipt" turns done only after approval, step 2
  only after indexing (server/onboarding.ts:40, journey-steps.tsx:38,42); steps can show 3 done with 1 waiting.
- P1 Receipt cards show "0 partly done" and a red "0 missed" on every good receipt (receipt-card.tsx:145-150);
  "1 findings" grammar (:173).
- P1 Deleting a paid account shows "Reload the page" instead of "Cancel your plan first"
  (delete-account.tsx:27-32 vs server/account.ts:129-134).
- P1 Admin: status badge stays "Active" after suspend until reload (users/[id]/page.tsx:43-47,80-84);
  AI usage shows "$0.00 a call" (admin/ai/page.tsx:16).
- P1 CLI tells npx users to run `codeceipt last`, which they don't have (setup-command.ts:345): print
  `npx codeceipt last`. Raw project UUID in "already connected" (:256).
- P1 Suspended page: "Contact support" is not a link (suspended/page.tsx:25).
- P1 Connect tab link to "Tokens tab" points at Overview (connect/page.tsx:89).

## Phase 2: navigation (project tabs 9 -> 6)
Today: Overview, Features, Blueprint, Receipts, Proposals, Approvals, Plan, Connect, Tokens (project-nav.tsx:5-15).
Proposed, each with a count badge where something waits:
1. **Overview**
2. **Receipts** (badge: needs attention)
3. **Features** (Plan becomes a banner here: "Your agent drafted a plan with 2 new features. Review plan")
4. **To decide** (badge): one inbox for approval requests, rule proposals and checklist proposals
5. **Blueprint** (keep the name, subtitle "What your app does and must never do")
6. **Settings**: Connect, Connection keys (today's Tokens), approval presets and pause, Delete project (moved out
   of Tokens)
Old URLs redirect. Projects list hides the project switcher. **Owner confirms the regroup.**

## Phase 3: onboarding (sign-in -> first receipt)
- P1 Relabel steps to match their triggers: 1 "Connect this computer", 2 "Codeceipt reads your project",
  3 "Get your first receipt". One current step (expanded, "Waiting for…" + subtle spinner); done steps collapsed
  with a tick; later steps dimmed; never a done step after a waiting one.
- P1 "Never used a terminal?" helper under the command (open Terminal / PowerShell / Cursor's terminal, `cd` by
  dragging the folder, install Node if npx is missing) and the easy route: "Or paste this into Claude Code or
  Cursor: Run npx codeceipt in this project and tell me the code it shows."
- P1 One primary action per state on /start: Copy before the first receipt; "Open all receipts" only after
  (start/page.tsx:75-81; build-choice.tsx:175 selected choice uses btn-primary).
- P1 /device: catch an expired code before the form ("This code expired or was already used. Run npx codeceipt
  again"); show the code read-only and identical to the terminal's; plain reassurance: "This lets Codeceipt on
  this computer send receipts to one project. Your source code stays on your computer; only file names and short
  summaries are sent." Deny warning once. Preselect a project whose name matches the folder.
- P1 After approving: "Watch your progress on Get started" link + "Your terminal may ask 1-2 yes/no questions;
  Enter accepts the recommended answer."
- P2 First-receipt moment: "Your first receipt is here" printed on paper (once, reduced-motion safe), one summary
  sentence, "How to read it" behind a Disclosure, one action "Send your next request".
- P2 Stack confirmation after the first index: "We found Next.js + Supabase, 14 pages, 3 tables" (Vercel import),
  plus a suggested first prompt for the agent (Sentry wizard).
- P2 "How do you build?" becomes a compact choice that tailors step 1 instead of a second list (build-guide.ts).
- P2 Connect tab in three plain sections: On your computer / Claude Code on the web (why first, env var in a
  CopyCommand) / GitHub (optional). Drop "Its server is…".
- P2 CLI Guard question in plain words: "Want Codeceipt to warn you before a commit if tests were weakened or a
  password slipped in? (recommended) [Y/n]".
- P2 Waiting states: "Paused. Reload to check again" when live updates stop; "Stuck?" with the top 3 fixes after
  ~10 minutes. Normal-wait hint: "Usually appears within a minute of your agent finishing" (PostHog).
- P3 /github/select uses Button and catches link errors; /oauth/authorize drops "MCP app" and "redirects to";
  hide not-yet-released installers.

## Phase 4: Overview
- P1 Merge the headline and "Next step" into one block with one button ("Review them").
- P1 Stat cards in plain words and linked to filtered lists (`?filter=attention`, `?filter=findings`):
  "Security problems / Passwords or keys in your code, or data anyone can read";
  "Things your agent missed / Still not built"; "Built as asked / 78% of what you asked for this week".
- P1 Headline count and list agree (label the list "Recent receipts to check" or limit it to this week).
- P2 2x2 compact stats on phones; chart dates on focus; Open items explains Close vs Dismiss.
- P2 Lovable: "All clear. Everything your agents did this week checks out" with a one-time check; streak line
  ("3 weeks with nothing missed").

## Phase 5: Receipts
- P1 Summary shows at most 3 badges: the worst problem, "+N more", and a verdict sentence ("Mostly done: 1 thing
  missed"); green "All done" when nothing is wrong; zero counts hidden.
- P1 Plain section titles: "New packages your agent installed", "Build and tests: not checked. Ask your agent to
  set up a check command." One term everywhere: "Changed something you didn't ask for".
- P1 "Send fix to agent" -> "Copy fix for your agent" with toast "Copied. Paste it into Claude Code or Cursor."
- P1 Local times; SHA moves into the body. Say "These changes are already in your files" (Cursor confusion).
- P2 Group the feed by Needs you / Agent is fixing / All good; missed-item actions Send fix / Not needed / Remind
  me later with shown shortcuts (Linear triage).
- P2 Group changed files by feature ("Reviews page: 3 files"), not one row per file (CodeRabbit).
- P2 "No receipts match 'xyz'. Clear search"; placeholder says what search covers; StateGuide as a "?" popover
  after the first visit; share explains "Anyone with the link can view, no sign-in" before creating.
- P3 "All N items done" stamp prints once on a perfect receipt (off switch in Account).

## Phase 6: Features and Plan
- P1 Status agrees with progress ("In progress" once any item is done, or label the column "Plan status").
- P1 Plan: `[negative]`/`[positive]` -> "Must" / "Must never" with icons; empty state "Ask your agent: 'Plan this
  app with Codeceipt.' The plan shows up here for you to approve."; add "Not right? Tell your agent what to change."
- P2 Stats become the filter chips; sort moves to a select; rows open a feature page (its receipts and items);
  cards instead of a 6-column table on phones; drop the Files column on mobile.
- P2 "No checklist yet" -> "Nothing planned yet. Ask your agent: 'plan the Booking feature'"; features with a stale
  receipt show "No update in 14 days" (Linear project health).
- P3 "Done" celebration badge at 100%; "Plan approved. Your agent will start with Booking."

## Phase 7: To decide (Proposals + Approvals)
- P1 One inbox with Approve / Reject per card; "Remember my choice for this kind of action" checkbox replaces the
  "Always…" buttons; actions as sentences (not `replaceAll("_"," ")`); "expires in 5 hours".
- P1 Proposals show a visual diff (old struck through, new added) and the agent's reason; declining asks "Why not?
  (optional)" and sends it back to the agent (GitHub reviews, Linear triage).
- P2 Approval presets move to Settings as radio cards ("Recommended" on Balanced); one "Pause automatic
  approvals…" menu instead of three buttons; Guard, "done gate" and protected folders explained.
- P2 Empty state: "Nothing to decide. When your agent wants to change what it was asked to build, you'll approve
  it here."

## Phase 8: Blueprint (Blueprint, Safety check, History)
- P1 Rules in plain words ("When someone pays, they get a receipt by email"); formal wording only in Full detail;
  grouped "It does" / "It must never" (must-never first, shield icon). Removes the all-caps EARS text.
- P1 Each feature card gets a health sentence and one action ("Checkout: 2 promises, none checked by a test yet.
  Copy prompt"; "Orders has no promises yet. Add a rule").
- P1 Summary line on top: "Your app has 2 parts and 2 promises. 0 are proven by tests. 1 suggestion is waiting."
  Review is the single primary button; suggestions above the view question.
- P1 Discover = "Safety check" and History get titles, purpose sentences and breadcrumbs; safety risks written for
  people ("Anyone on the internet can read and change your orders") with SQL and paths under Technical details;
  Discover gets a "Confirm this feature" primary button with progress and an end state ("Your whole app is mapped").
- P2 Blueprint map: cards grouped by area (Pages, Data, Sign-in, Payments, Emails) from what Discover collects,
  C4-style zoom (app first, then a feature); list layout on phones.
- P2 "Since your last visit" band; entries marked "Out of date" with the receipt that changed them (Swimm).
- P2 History: relative time, who did what ("You accepted: receipt email for Checkout"), Compare with current,
  ConfirmDialog for Restore; one plain wording hint with "Use this wording" instead of 4 hints (fix the broken
  "SHALL ensure that … should" rewrite).
- P3 "Version 1" -> "Last saved 2 days ago"; Retry/Reload buttons in errors; "No risks found. We checked 12 tables
  and your last 50 receipts." on receipt paper.

## Phase 9: Account, Connection keys, Admin, Suspended
- P1 Account Plan card: what the plan includes and usage ("1 project, 40 AI checks a day. 12 used today"),
  renewal date, "Pro until 1 Dec, then Free"; delete is blocked up front for active paid plans with the billing
  button.
- P1 One name for "computers / keys / project tokens": **Connection keys** (account and Settings); copy button on
  the one-time secret; no double confirm.
- P2 Sessions -> "Signed-in browsers" with a "This browser" pill; confirm "Sign out everywhere, including this
  browser?"; computers show "Unnamed computer" and relative dates; empty states link to /start.
- P1 Admin suspend explains consequences, takes an optional reason (shown in the audit log), danger style;
  Restore primary. Admin link in the user menu.
- P2 Admin overview leads with a sentence ("All systems OK · 1 project hit the AI limit"), setup rows say how to
  fix; users list filters and sort; audit log shows names and sentences with filters and paging; waitlist uses
  Pagination; "40 / 40 (limit reached)"; 3-4 decimals for unit costs.
- P2 Suspended: "Your agents can't send receipts and the dashboard is paused until it's restored"; Sign out
  instead of Privacy; reply time stated.
- P3 Friendly first line on Account ("Hi Ada, here's everything connected to your Codeceipt").

## Phase 10: public pages
- P1 Landing: order the first step in the hero ("1. Run this in your app's folder", then "Already set up? Sign
  in" as a link); shorter sub-line ("When your AI agent finishes, you get a receipt: what you asked, what changed,
  what it missed. Checked against git, not the agent's word. Your code never leaves your computer."); 9 sections
  -> hero, problem, read a receipt, privacy, how to use (3 lines + Quickstart link), final call; Checks and
  "Where it fits" move below the FAQ or to docs; the problem section becomes a body-size list with icons.
- P2 Landing: "Tap a line to see what it means" under the hero receipt (hover-only today); agent tabs wrap on
  phones; positive install note ("Needs Node.js 20 or newer. Installers without Node.js are coming soon."); plain
  study citation.
- P1 Pricing: comparison table (stacks on phones), Free gets "Start free", plain intro of what AI-checked means
  and what happens past the limit; reassurance "Payments by Stripe. Cancel any time. Nothing is deleted."; explain
  Pro "Unlimited" vs Agency 25; title + purpose sentence, no TOC.
- P1 Quickstart: the same 3 steps as the landing page, working command first, "Not sure what a terminal is?";
  numbered troubleshooting starting with `codeceipt doctor`; "Before you start" block.
- P1 Shared receipt /r/[token]: public header and footer, title "A receipt for an AI coding session" and purpose
  sentence; state legend; one calm call to action; date and agent in the heading.
- P1 404: "Home" primary for signed-out visitors, "Your projects" secondary; copy "We couldn't find this page. The
  link may be wrong, or the page may have been removed or not shared with you."; own message for dead share links.
- P2 Sign-in: split reassurance from the GitHub App note; plain network errors; "New here? Signing in creates your
  account. It's free." Privacy/terms: contact address, Sent / Never sent summary first, Stripe under Services.
- P3 404 as a tiny torn receipt; final band reprints a mini receipt; footer line "Thank you for building carefully."

## Decisions for the owner (before the phase that needs them)
1. Pricing: "free during beta" or the paid plans (Phase 1).
2. Tabs 9 -> 6 with "To decide" and "Settings" (Phase 2).
3. Name for tokens/keys/computers: "Connection keys" (Phase 9).
4. Celebrations on by default with an off switch in Account (Phases 5 and 8).

## After each phase
Refresh docs/screenshots (several are older than the code), check 375 and 1280 px in light and dark, keyboard
and screen reader pass, run `bash scripts/verify.sh --quick`, and update docs/DESIGN.md (component inventory and
any changed rule).
