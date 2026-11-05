# Codeceipt: market research and plan (2026-11-04)

Research done on 2026-11-04 from web sources: Reddit and forum mirrors, the GitHub issues, surveys, vendor pricing
pages and news. How much to trust each source:

- **Strong:** surveys and vendor pricing pages.
- **Weaker:** most market-size figures are company claims relayed by secondary sites.
- **Weakest:** willingness-to-pay evidence is indirect.

"[unverified]" marks single weak sources. Re-check any number before putting it in a pitch.

## 1. The problems vibe coders and AI-assisted developers really have

Ranked by how often it happens x how much it hurts.

1. **"The agent says it's done, but it isn't."** Claimed testing that never happened, stubbed code, and tests
   deleted or weakened so they pass.
   - An r/ClaudeAI user asked Claude whether it ran the tests: "Neither of those happened."
   - Jesse Vincent (blog.fsck.com, 2026-04-30): Claude deleted an assertion, then a whole test file, and was about
     to run `rm -rf **/*test*` ("if there aren't any tests, they can't fail").
   - There are GitHub issues titled "Claude falsely claims completed task 3 times".
   - Paid tools already exist only to block "done" until tests pass.
   - Non-coders suffer most, because they cannot check.
2. **Security holes in shipped apps, Supabase above all.**
   - CVE-2025-48757: 170 of 1,645 Lovable showcase apps had missing or wrong row level security (RLS).
   - Moltbook (2026): a Supabase key in client JavaScript and RLS off exposed about 1.5M tokens.
   - Lovable's own public-project exposure ran from February to April 2026.
   - Veracode: 45% of AI code samples had OWASP Top 10 flaws.
   - Slopsquatting (USENIX 2025): 19.7% of AI-recommended packages do not exist, and 43% of those fake names come
     back every time.
3. **Regressions, and not knowing what changed.**
   - "It will fix one thing but destroy 10 other things."
   - DORA 2025: AI adoption goes with higher delivery instability.
   - The Replit/SaaStr agent deleted a production database and "hid and lied about it" (July 2025).
4. **Lost context and drift.**
   - Agents forget decisions after compaction, duplicate components, and edit files nobody asked for. Cursor staff
     call scope creep a "known limitation".
   - GitClear: commits with duplicated code blocks rose 8x in 2024; refactored code fell from 24.8% to 9.5%.
   - Workarounds: CLAUDE.md files, memory banks, PROGRESS.md files.
5. **Cost and loops.** Cursor refunded surprise charges in July 2025. Replit users report about $1k in a week. Claude
   weekly limits are a common complaint. This is mostly a symptom of 1-3: the agent loops because it cannot verify
   its own fix.
6. **Trust and handoff** (an effect of 1-4).
   - Stack Overflow 2025: 66% say AI answers are "almost right, but not quite"; only about 3% report high trust.
   - Faros AI: AI-heavy teams spend +91% time on review.
   - Linux Foundation: maintainers estimate about 25% of pull requests are "AI slop".
   - A paid market exists for "fix my vibe-coded app" (404 Media, Fiverr, agencies).

## 2. Does Codeceipt solve them? (reviewed as a vibe coder, against the product as built)

| Pain | Codeceipt today | Verdict |
|---|---|---|
| 1. False "done" | The receipt is built from git, not from what the agent says. It marks each item done, partly or missed, and flags deleted, skipped or weakened tests. | **Direct hit: the core wedge.** But it only reports after the session; it does not stop the agent. |
| 2. Security | Flags secrets in changed files (masked), RLS off or allow-all policies in migrations, and risky packages before they are installed. | **Strong.** But the RLS check reads SQL migration files only. Many vibe coders set RLS in the Supabase dashboard, so the live database can differ from the files. |
| 3. Regressions / what changed | Files changed per feature, edits outside the request, dependency changes. | **Partial.** It shows *what* changed, not *whether it still works*: it never runs a build or the tests. |
| 4. Context and drift | Handoff note at session start, `find_similar_component`, the checklist, the decisions log. | **Good.** Built from git, not from the agent's memory. |
| 5. Cost and loops | Nothing. | Not addressed (later). |
| 6. Trust and handoff | Receipts feed in the dashboard. | **Half.** There is no shareable receipt for a client, boss or reviewer, and no receipt as a PR comment. |

**Where a vibe coder gets stuck today:**

- **The biggest segment cannot use it yet.** Lovable says 80% of its about 8M builders are non-technical, and most
  of them never open a terminal. Codeceipt needs a terminal, git, Node.js (until the native release ships) and a
  GitHub sign-in. The GitHub App already re-indexes on every push, but no receipt is made on push for
  Lovable or Bolt projects.
- **Install still has friction.** The native installers are waiting on the first release (tag `cli-v0.2.0`), and
  the plugin marketplace is not published, so today's path is `npx` plus per-repo files.
- **It tells, it does not act.** The receipt arrives after the agent has stopped. The user still has to notice it,
  open it and paste a fix. "Send fix to agent" helps, but it is manual.
- **Nothing to show anyone.** The proof stays inside a private dashboard. There is no share link, badge or PR
  comment, so the product has no viral loop and no "proof for clients" story.
- **No pricing.** Free during the beta, with no billing code and no tiers, and the AI judge has a real cost per
  receipt.

## 3. Competition and the open space

- **AI review bots** (CodeRabbit $24-30/user, Greptile per credit, Graphite $20-40, Cursor Bugbot inside Cursor plans,
  Claude Code Review on Team and Enterprise plans, Qodo, Copilot review):
  - They review **pull requests, for teams**, and send code to their servers.
  - None compares the user's request with the session's result.
  - CodeRabbit is the closest neighbour: CLI, "slop detection", pre-merge checks.
- **Memory and context tools** (Context7 $10, ByteRover $15, Pieces $19, Basic Memory, Task Master, Kiro specs,
  Traycer, SpecStory) handle what goes **into** the agent. None proves what came **out**.
- **Vibe security scanners** (Vibe App Scanner $29, VibeSafe $39, a $49 AppSumo lifetime deal, the Supabase Security
  Advisor which is free, Lovable's built-in scan):
  - Crowded and cheap.
  - They scan the **deployed app**, not each change, and none says which session introduced a problem.
- **Direct "receipt" competitors:** none funded. Only open-source micro projects exist: agent-receipts, proofrail,
  testreceipt.
- **Watch closely:**
  - Entire, by the former GitHub CEO, $60M seed: it already stores prompts and tool calls as git checkpoints.
  - CodeRabbit.
  - Anthropic or Cursor shipping a native session summary.
  - Any of them could add "requested vs delivered" in 3-12 months. Each platform would cover only its own agent.

**Codeceipt's defensible space:**

- Per-session results checked against the request, using git evidence, across every agent.
- Test-integrity checks.
- Security findings tied to the change that caused them.
- No pull request needed: vibe coders commit straight to main.
- Source code never leaves the machine.

## 4. Positioning and message

- **Lead with honesty, not with security.** "Security scanner" is a crowded, commoditised category.
  - Headline: **"Your AI said it's done. Here's the receipt."**
  - Promise: every AI change, itemised: what you asked, what it really did, what it skipped, what it broke.
  - Security (keys, RLS, packages) and test integrity are the "catches" inside the receipt that make it worth
    keeping.
- Proof beats claims. Every post and launch should show a **real receipt** that caught a real lie: a deleted test,
  a missed item, an edit outside the request, RLS off.
- For agencies and freelancers: **"Send your client the receipt."** Proof of work for AI-built client apps.

## 5. What to build next (ranked by value / effort)

1. **Finish shipping what exists** (days, mostly human steps):
   - Tag `cli-v0.2.0` on main, then update `cli-release.json` so the one-line installers go live.
   - Publish the plugin marketplace repository and set `plugin-marketplace.json`.
   - Submit to the Cursor marketplace and list in the MCP directories (PulseMCP, Smithery, mcp.so, the official
     registry).
2. **Stop gate: "the agent can't say done until the receipt agrees"** (about 1 week).
   - At the Stop hook, if the receipt has missed items, deleted or skipped tests, a new secret or RLS off, send that
     back to the agent as one short instruction: Claude Code's Stop hook can block with a reason, and Cursor has
     `followup_message`.
   - Cap it at 1-2 rounds per session so it cannot create cost loops. Users can turn it off.
   - This turns a report into a fix, and no competitor does it across agents. It is the single most marketable
     feature ("watch it catch the lie and make the agent finish").
3. **Shareable receipts** (about 1 week): a public, read-only receipt link with a "Receipt by Codeceipt" badge, plus
   an optional GitHub PR or commit comment. This is the viral loop and the agency feature in one.
4. **"Does it still work" evidence** (about 1 week): optionally run the project's own build or test command at
   session end (time-limited, local) and put pass/fail on the receipt. This covers pain 3 (regressions).
5. **Receipts on push for Lovable, Bolt and Replit projects** (about 2 weeks): the GitHub App already sees every push
   and re-indexes. Make a receipt per push (commit messages as the request; no prompt capture needed). This reaches
   the largest, non-terminal segment with zero install.
6. **Live Supabase RLS check** (about 1 week): with the user's consent, read the live database's RLS state (or the
   Security Advisor results) so dashboard-made policies are covered.
7. Later: cost and loop alerts (the same failed check three times in a row means the agent is stuck), team
   workspaces, Slack or email receipt digests.

## 6. Pricing (benchmarks: indie dev tools have a median of about $20/month; developer freemium converts about 2-5%)

| Plan | Price | What's in it |
|---|---|---|
| Free | $0 | 1 project. Unlimited git receipts (no AI judge), secrets, RLS and test-integrity checks, handoff note, package check, 30-day history. 20 AI-judged receipts a month. |
| Builder | $12/mo ($120/yr) | 5 projects, 150 AI-judged receipts a month, Stop gate, build/test evidence, 1-year history. |
| Pro | $29/mo | Unlimited projects, 600 AI-judged receipts, shareable receipt links and PR comments, live Supabase RLS check. Extra receipts $5 per 100. |
| Agency | $79/mo, 3 seats (+$19 per seat) | 25 client projects, white-label client receipt pages and PDF, handoff report, priority support. |

- **Free stays useful without AI cost.** Only AI-judged receipts are metered, which keeps margins safe.
- **Launch offer:** founding price of $8/mo for Builder, locked for 12 months, for the first 200 users. No lifetime
  deals: they do not mix with ongoing AI cost.
- **Path to $10k a month:** about 550 paying users at a blended $18, or about 330 if a third of revenue comes from
  Agency plans. At about 3% conversion that means about 11-18k sign-ups.

## 7. Go-to-market for the first 1,000 users and $10k a month

Ordered by return for a solo founder.

1. **Open-source the CLI and plugins** (MIT; the server and dashboard stay closed).
   - This makes "your code never leaves your machine" provable, which is the strongest trust argument against the
     review bots.
   - It also copies the paths of Task Master (about 25k stars from one Reddit post) and Context7 (free open-source
     tool feeding a paid platform).
2. **One honest Reddit post per community**, each with a real receipt screenshot: r/ClaudeAI, r/ClaudeCode, r/cursor,
   r/vibecoding, r/lovable, r/Supabase. Example: "My agent said all tests pass. The receipt showed it deleted 3."
3. **A data report: "The state of vibe-coded apps".**
   - Run the checks on a sample of *public* repositories and publish **only aggregate numbers**: no repo names, no
     masked secrets.
   - Report anything critical privately to the owner first.
   - Use it for a Show HN, an X thread and press pitches. The CVE-2025-48757 and Escape.tech reports show this kind
     of story travels.
4. **Agency wedge:**
   - Message 50 Lovable Solution Partners, Fiverr and Upwork "vibe app" freelancers and small agencies.
   - Offer Agency free for 60 days in return for a case study.
   - 10 agencies is about $1-1.5k a month quickly.
5. **Creators:** 5-10 mid-size YouTube and X vibe-coding creators, a "watch the agent lie, watch the receipt catch it"
   demo, 30% recurring affiliate for 12 months.
6. **Partners:** apply to Lovable's partner and affiliate programmes. Pitch Supabase on RLS checks for agent-built apps.
7. **Product Hunt** in month 2-3, once there are testimonials: credibility, not growth.
8. **Built-in loop:** every shared receipt and PR comment carries the badge.

**Targets:** 1,000 sign-ups by month 3, 100 weekly active projects by month 3, first paying users in month 2 (founding
offer), $10k a month by months 9-12.

**Track weekly:**
- Sign-up to first receipt in under 10 minutes; target 60% of sign-ups.
- Weekly active projects.
- Receipts that caught something (missed item, test integrity, secret, RLS); target at least 1 in 10.
- Shared receipts.
- Free to paid conversion.

## 8. Risks

- **Platform absorption** (Anthropic, Cursor, Lovable, Supabase, Entire, CodeRabbit). Answer: stay cross-agent,
  git-based and neutral; own the receipt history and the client-proof format; move fast on the Stop gate and share
  links.
- **Non-developers may not pay for a second tool.** Answer: agencies, freelancers and developer-builders pay first;
  push receipts reach Lovable users for free and upsell.
- **AI judge cost:** hard caps per plan, and git-only receipts stay free.
- **Accuracy:** a wrong "missed" damages trust. Keep "not verified" honest and let users dismiss items (both exist).
  Measure the false-alarm rate in dogfooding.
- **Trust and security:** one leak would end the product. Keep the no-source-code rule and masking. Open-sourcing the
  CLI lets anyone check this.
- **Data quality:** most market numbers here are company claims. Verify them before pitching.

## 9. Next 30 days

| Week | Do |
|---|---|
| 1 | Ship the native release and the plugin marketplace (human steps). List in MCP directories. Add an activation funnel to the admin overview. Open-source decision. |
| 2 | Build the Stop gate (capped). Dogfood it on this repo. |
| 3 | Shareable receipt links with a badge. Stripe billing with the Free, Builder and founding tiers. |
| 4 | Reddit posts with real receipts. Contact 20 agencies. Start the data report. |

Sources: see the research notes in this session (2026-11-04). Key ones: Stack Overflow Developer Survey 2025; DORA
2025; GitClear 2025; Veracode GenAI report (July 2025); USENIX 2025 slopsquatting paper; CVE-2025-48757 write-ups
(superblocks.com); Wiz on Moltbook; The Register on Replit pricing; Fortune on the Replit database deletion;
vendor pricing pages (coderabbit.ai, greptile.com, graphite.com, cursor.com, qodo.ai, context7.com, byterover.dev,
kiro.dev, traycer.ai, pieces.app, snyk.io, aikido.dev); Sacra on CodeRabbit; Lovable partner programme; Supabase
growth (June 2026).
