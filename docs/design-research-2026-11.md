# Design research, 2026-11-25 (for design v3)

This research used web search excerpts. Direct fetches of vercel.com, linear.app, nngroup.com and developer.chrome.com were blocked by the session network. Points marked (3rd-party) come from teardown write-ups.

## App shells with a sidebar
- **Vercel navigation redesign.** The horizontal tabs became a sidebar that can be hidden, with one link set at the team and project levels. On phones it becomes a floating bottom bar.
  - https://vercel.com/changelog/new-dashboard-navigation-available
  - https://vercel.com/changelog/dashboard-navigation-redesign-rollout
- **Linear 2026 refresh.** The sidebar is dimmer than the content, and inactive items have lower contrast.
  - https://linear.app/changelog/2026-03-12-ui-refresh
  - https://linear.app/changelog/2024-12-18-personalized-sidebar
- **Supabase.** The organisation picker is in the header; the sidebar lists that organisation's projects.
  - https://supabase.com/changelog/33670-upcoming-breaking-change-to-dashboard-navigation
- **v0 (3rd-party).** The sidebar groups chats by project and shows a live status dot, including a "waiting on you" state.
  - https://www.createwith.com/tool/v0/updates/v0-introduces-new-sidebar-with-project-groups-and-live-status
- **Attio.** The workspace switcher sits top-left, with search at the top of the sidebar.
  - https://attio.com/help/reference/productivity-collaborating/navigating-your-workspace
- **Resend (3rd-party).** A left rail about 250 px wide. The sidebar has its own background only in light mode.
  - https://www.resend.com/blog/introducing-light-mode

## Status at a glance
- **GitHub merge box.** The overall status comes first; checks are rolled up below it.
  - https://github.blog/changelog/2025-03-04-improved-pull-request-merge-experience-is-now-generally-available/
- **Sentry issue page.** An Event Highlights block at the top, with progressive disclosure for the rest.
  - https://sentry.io/changelog/new-issue-details-ui-now-available/
- **Stripe Home.** Notices for things that need action.
  - https://docs.stripe.com/dashboard/basics
- **Supabase Security Advisor, lint 0013.** Rated ERROR, with an "Unrestricted" table badge.
  - https://supabase.github.io/splinter/0013_rls_disabled_in_public
- **Lighthouse.** Every status uses colour plus shape.
  - https://github.com/GoogleChrome/lighthouse/blob/main/docs/scoring.md

## What the AI did
- **GitHub Copilot coding agent.** Session log, an overview summary, then the changed files.
  - https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions
- **Cursor.** An "N files changed" card that opens into Keep / Undo for each file.
  - https://cursor.com/docs/release-notes/cloud-agents.md
- **Devin.** A Progress tab whose steps expand to the details.
  - https://docs.devin.ai/work-with-devin/devin-session-tools
- **Lovable.** Plan mode and version history.
  - https://docs.lovable.dev/features/plan-mode
- **CodeRabbit.** A plain-language summary, with the walkthrough collapsed below it.
  - https://docs.coderabbit.ai/pr-reviews/summaries
- **Vercel Security Review.** Each finding has a summary, a fix and a severity.
  - https://vercel.com/changelog/vercel-security-review-public-beta
- **Claude Code permission prompts.** "Always allow" states exactly what it covers.
  - https://code.claude.com/docs/en/permissions

## Decisions and approvals
- **Stripe Radar reviews.** Risk levels plus an explanation of why.
  - https://docs.stripe.com/radar/reviews
- **Linear Triage.** Declining asks for a reason; snoozed items come back.
  - https://linear.app/docs/triage
- **Ramp approvals.** AI suggestions are advice only.
  - https://support.ramp.com/bill-pay-approvals
- **Brex.** "Ask for clarification" is an option alongside approve and deny.
  - https://www.brex.com/support/approval-chains
- **Apple HIG.** A request says exactly what will happen.
  - https://developer.apple.com/design/human-interface-guidelines/privacy

## Onboarding (device flow)
- **GitHub device flow.** A short code, one fixed URL, an expiry and polling.
  - https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- **Vercel CLI login.** The approval page shows the location, IP and time.
  - https://vercel.com/changelog/new-vercel-cli-login-flow
- **Stripe CLI.** The pairing code appears on both sides so the user can match them.
  - https://docs.stripe.com/cli/login

## Progress, tone and calm
- **Basecamp hill charts.** "Figuring it out" versus "making it happen".
  - https://basecamp.com/hill-charts
- **Linear project health.**
  - https://linear.app/docs/project-updates
- **Duolingo.** Celebrate milestones only.
  - https://blog.duolingo.com/streak-milestone-design-animation
- **NN/g empty states.**
  - https://www.nngroup.com/articles/empty-state-interface-design/
- **Mailchimp voice and tone.**
  - https://styleguide.mailchimp.com/voice-and-tone/
- **Mercury (3rd-party).** Visual calm: red and amber are kept for real problems.
  - https://www.925studios.co/blog/mercury-design-breakdown
- **Linear theming.** The theme is built from 3 inputs (base, accent, contrast).
  - https://linear.app/blog/how-we-redesigned-the-linear-ui
- **Geist** font family.
  - https://vercel.com/font
