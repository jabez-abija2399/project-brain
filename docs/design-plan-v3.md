# Codeceipt design v3: "Clearance" (plan, 2026-11-25)

Owner brief: start over from why people use Codeceipt, not from the current screens. Add a sidebar. Research inspiration deeply.

## Why people come, and the one feeling to design for
Non-technical makers build apps by asking an AI agent. The agent says "done", and they cannot check its work. Codeceipt is the trust layer: it shows what the AI really did, what it missed, what is unsafe, and what it is waiting to be allowed to do.

The feeling to design for is **"I can see what my AI did, and I trust it."** Every screen opens with a verdict a person can read in one second, and offers one next step.

## What the research says (sources: docs/design-research-2026-11.md)
- **Status first, details on demand.** GitHub's merge box, Sentry's Event Highlights, Stripe Home notices, Headspace's progressive disclosure.
- **A quiet sidebar.** It is dimmer than the content (Linear 2026). The project switcher sits at the top (Attio, Supabase). There is one link set at every level, the sidebar can be hidden, and on phones it becomes a floating bottom bar (Vercel 2025).
- **Shape + colour + word for every status, never colour alone.** Lighthouse.
  - ● Done
  - ◐ Partly done
  - ▲ Missed
  - ○ dashed: Not checked (never green)
- **Lead with the consequence.**
  - Security: "Anyone can read your orders table", with "RLS off" as small print (Supabase lint 0013).
  - Requests: "Delete the Team invites feature (4 files)" (Apple HIG purpose strings).
- **Decisions.**
  - Show why the agent is asking (Stripe Radar).
  - Codeceipt's suggestion is advice only (Ramp).
  - Reject asks for a reason that goes back to the agent (Linear triage).
  - "Ask agent to explain" and "Decide later" are extra choices (Brex, Linear snooze).
  - "Always allow" says exactly what it covers (Claude Code permissions).
- **Progress.** A 4-stage track per feature, Planned → Being built → Checking → Done, instead of a bare percentage (Basecamp hill charts). One health word per feature (Linear).
- **Calm.**
  - One neutral and one accent, with red and amber kept for real problems (Mercury, Linear LCH themes).
  - Hairline borders instead of stacked shadows (Raycast, Resend).
  - Celebrate milestones only (Duolingo).
  - Calm empty states with a direct next step (NN/g, Superhuman).

## Identity
The current look (warm cream ground, indigo accent, cards everywhere) reads as generic. v3 moves to a cool, crisp "clearance" identity: a verified document, not a dashboard.

- **Colour**
  - Canvas (light): `#F5F6F8`
  - Surface (light): `#FFFFFF`
  - Sidebar (light): `#EEF0F3`
  - Ink: `#11141B`
  - Muted: `#5B6270`
  - Hairline: `#E2E5EA`
  - Accent ("verified cobalt"): `#2747D6`, soft `#E9EDFD`
  - Status: done `#0B7A55`, partly `#A15C07`, missed `#C42B2B`, not checked `#5B6270` (dashed)
  - Dark mode: canvas `#0D1015`, surface `#141821`, sidebar `#10141B`, ink `#ECEEF2`, accent `#8EA2FF`. The receipt paper stays light in both themes.
- **Type**
  - Geist for the interface.
  - Geist Mono only for receipts, file paths, codes and masked keys.
  - One display size for the verdict sentence (40/44, weight 600, tracking -0.02em). One section size, one body size, one small size.
- **Signature element: the clearance seal.** A round mark next to every verdict.
  - ✓ cobalt ring: "Clear"
  - amber ring with a count: "Needs you"
  - red ring: "Unsafe"

  It is the one memorable thing; everything around it stays quiet.
- **Structure**
  - Hairline 1 px borders.
  - Radius: 14 px for panels, 10 px for controls, 999 px for chips.
  - No shadows, except on floating things (menus, the phone bottom bar).
  - No gradients, no all-caps labels, no arrows on buttons.

## Layout
```
┌────────────┬──────────────────────────────────────────────┐
│ ◉ salon ▾  │  Home                                        │
│            │  ( ✓ )  Your app is clear to keep building.  │
│ Home       │         Last session did 4 of 5 things.      │
│ Receipts   │  ── Needs you ───────────────────────────    │
│ To decide 2│  1 request to approve · 1 missed item        │
│ Features   │  ── Latest receipt ─────── Plan ──────────   │
│ Blueprint  │  [ receipt paper preview ] [ 4-stage tracks] │
│            │                                              │
│ Settings   │                                              │
│ Docs       │                                              │
│ ● Maya     │                                              │
└────────────┴──────────────────────────────────────────────┘
Phone: no sidebar. Top bar with the project switcher; a floating bottom bar with
Home · Receipts · To decide (badge) · Features · More.
```
- **Sidebar.** 248 px wide.
  - Top: a project switcher with a status dot per project (v0).
  - Middle: the 5 sections, with counts only where something waits on the user.
  - Bottom: Settings, Docs, and the account menu.
  - It can be collapsed to icons on desktop.
- **Content.** Left-aligned, max 880 px for reading pages and 1120 px for lists. Each page opens with its title and purpose sentence, then the verdict, then the details.

## Screens
1. **Home.**
   - The seal + verdict sentence.
   - "Needs you": an action list, shown only when something does.
   - The latest receipt as a paper preview.
   - Feature tracks.
   - No charts first.
2. **Receipts.** A bank-feed list grouped by day.
   - Each row: time, the ask in the user's words, the agent, and a verdict chip (shape + word).
   - Rows with a security problem get a red left edge.
3. **Receipt detail.** The receipt paper (monospace, torn edge), in this order:
   1. Verdict sentence.
   2. "What you asked", worst first, with status shapes.
   3. Security callouts, consequence first, each with "Copy fix for your agent".
   4. Collapsed "Changed outside your request" with one line per file.
4. **To decide.** A queue on the left and the detail pane on the right (stacked on phones). The pane holds:
   - A specific action sentence and a risk chip.
   - "Why we're asking" (files and the Blueprint rules involved).
   - Codeceipt's suggestion.
   - Approve / Reject (with a reason) / Ask agent to explain / Decide later.
   - "Always allow" spelled out.
5. **Features.** One row per feature with the 4-stage track, a health word and "What's next". A small celebration when a feature reaches Done.
6. **Blueprint.** Two columns, "Always" and "Never". Each rule shows "Last checked: kept / broken in <receipt>". Suggestions are worded as example sentences.
7. **Onboarding.** Install → Connect → First receipt. The step that is waiting shows a live state. The approval page shows the matching code, the device and the time, plus "Not you? Deny".
8. **Settings / Account.**
   - Grouped sections: Account, Connected computers (last seen, Remove), Plan (a beta meter that says what happens at the limit), Preferences.
   - The danger zone is last, calm and literal.

## Mock-ups
`docs/mockups/v3/`: home, receipt, decide, features, plus the phone and dark views. The owner approves them before the build.
