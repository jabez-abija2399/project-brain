# Codeceipt portfolio images

These images come from the real Codeceipt app (production build) and the real CLI. Both ran against a local demo database with one invented project, "salon-booking", and no real user data. Every image is 1600x1200 (4:3). The only secret shown is the masked demo value `sk_l***`.

| Image | Caption (paste into Upwork) |
|---|---|
| 01-cover.png | Codeceipt: a receipt for every AI change, showing what you asked, what changed and what was missed, built from git and not from the agent's word. |
| 02-landing.png | Landing page: the product explained in one screen, with a live sample receipt. |
| 03-receipt.png | One receipt with every state: done, done with no test proving it, missed, postponed, a question, a file outside the request, a masked secret, a skipped test and a new dependency with its safety check. |
| 04-overview.png | Project overview: what needs attention this week, four key numbers, a 14-day activity chart and the receipts to look at first. |
| 05-features.png | Feature board: every part of the app with its status, progress, open items and last receipt. |
| 06-start.png | Guided start page: three steps to the first receipt, all done, with the receipt explained right below. |
| 07-terminal-last.png | The `codeceipt last` command: the latest receipt summarised in the terminal, right after the agent session. |
| 08-receipt-dark.png | The same receipt in dark mode. The receipt paper stays white, so it reads like a printed receipt. |
| 09-overview-dark.png | Project overview in dark mode. |
| 10-terminal-evidence.png | `codeceipt last --evidence`: exactly what the AI judge saw for each file, as line counts and symbol names only, never source code. |

Regenerate everything with `pnpm portfolio:images` (see packages/portfolio). In the terminal images, the demo project and receipt ids in the "Full receipt" link are replaced with "…".
