# Backlog work (after the roadmap)

Owner, 2026-11-11: build everything possible from `agent/later.md`; optional migrations allowed (owner actions);
merge each pull request on green CI. Items that need the owner stay in [../owner-actions.md](../owner-actions.md).

## Wave A: security (branch `backlog/wave-a-security`)
| Test | Fix |
|---|---|
| BL-01, BL-02, BL-12 | GitHub App install: the code must belong to one of the signed-in person's GitHub sign-ins; the one-time token is revoked (at most 2 s) |
| BL-03 | Queued GitHub jobs skip a project, or an owner, suspended since |
| BL-04 | Checklist prompt: no run of `<` or `>` can close the data block |
| BL-05 | Rate-limit address: on Vercel the platform's own client headers come first |
| BL-06, BL-11, BL-11b | Project creation under a per-owner lock in one transaction: the plan limit holds for parallel creates; racing device approvals leave no empty project |
| BL-07 | Device approval page says when the code was requested, defaults to a new project, and explains a full plan |
| BL-08, BL-08b, BL-09 | `npx codeceipt` revokes the per-project token it replaces (never the default login), through a self-revoke route |
| BL-10 | Hooks read up to 2 MB: a long final message keeps the session and its claims |

Security review (fresh context): no HIGH; the MEDIUM (lock not pinned by a test) and five LOW findings fixed; two
notes added to `agent/later.md`. Already done before this wave (found while checking): checklist confirm names the
exact proposal; app-wide Origin check.

## Wave B: bugs and robustness (branch `backlog/wave-b-bugs`)
| Test | Fix |
|---|---|
| BL-13, BL-14 | App Router detection: page.js/page.ts too; an `app/` folder inside components/, lib/, features/ and similar is not the router; projects in any subfolder keep their routes |
| BL-15 | /api/health reuses one answer for 5 s per database address, and concurrent requests share one check |
| BL-16, BL-17 | A suspended GitHub App installation, or repositories removed from it, unlink their projects (signed events only, in chunks) |
| BL-18 | Creating project tokens is limited to 30 a minute per user |
| BL-19 | Active tokens always come first in the token list |
| BL-20 | A start note that looks like JSON is labelled, so Claude Code never reads it as hook control |
| BL-21 | Worktrees use the main checkout's check command; a hand-written `.git` file naming another repo does not |
| BL-22 | A concurrent file move gets its own 409, not "name taken" |
| BL-23 | `codeceipt guard` holds at most 64 MB of text; files past it are reported, never passed |
| BL-24 | A request matched to a feature moves it from todo to in progress |
| BL-25 | The indexer walk stops at 20,000 files (and lists 5,000 skipped paths at most); a stopped walk deletes nothing on the server |
| BL-26 | Secret masking runs in linear time |

Also: `checkDb` clears its timer and never waits for the connection to close; `/mcp` gets `maxDuration` 60 s;
`init --remove-repo-files` reads and rewrites through no-follow, non-blocking descriptors; an unused test helper left
the production auth module; the indexer's react-import test is unconditional.

Not built on purpose (reasons in `agent/later.md`): a Stop-hook receipt debounce (it would skip the done gate); a
sign-out case in the Origin test (better-auth's own route).

Security review (fresh context): no HIGH; both MEDIUM findings (a crafted `.git` file borrowing another repo's check
command; routes lost in subfolder projects) and four LOW findings fixed; the rest recorded in `agent/later.md`.

## Wave C: small screens and fixes (branch `backlog/wave-c-ux`)
| Test | Change |
|---|---|
| BL-27 | Connect tab: a "Connect GitHub" button when the App is set up and the repository is not connected; the repository's name once it is |
| BL-28 | Project page: "Delete this project", enabled only once the project's name is typed |
| BL-29, BL-30 | Proposals page: rules an agent proposed, with Confirm and Dismiss (dismiss is its own DELETE route, so AC-010-07's "only active" stays as it is); proposals older than 30 days are no longer offered |

Also: the start page's live status refreshes in place instead of reloading; the Plan tab explains a plan that would
make the Blueprint too large. Not done on purpose (reasons in `agent/later.md`): deleting start blobs; renaming "Your
first receipt" (wording only, pinned by three tests).

