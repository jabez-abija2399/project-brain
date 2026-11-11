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
