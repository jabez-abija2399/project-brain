# Switching from a build kit to Codeceipt

For a project that already uses an AI build kit (a `features.json` with acceptance criteria, an AGENTS.md with
rules, hooks that stop the agent from weakening tests). Codeceipt does the same jobs with less in the repository:
the plan lives in your Codeceipt project, the checks run through one installed command, and you approve changes on a
web page instead of editing files.

You do not have to switch all at once. Each step below works on its own, and the kit keeps working next to it.

Needs: Codeceipt CLI 0.3.7 or later.

## 1. Connect the repository (2 minutes)
```bash
npx codeceipt
```
Follow the code shown in the terminal. This links the repo to a project, indexes it (file names and symbols only,
never your code) and sets up your agent.

## 2. Bring your plan over (5 minutes)
```bash
codeceipt import --from kit
```
This reads `agent/features.json` on your machine and sends the features and criteria as a **draft**. Nothing changes
until you approve it: open the link it prints, read the draft, and approve. Other sources work the same way:
`--from speckit`, `--from kiro`, `--from openspec`, `--from agents` (rules in AGENTS.md or CLAUDE.md), `--from readme`.

What comes over: feature names, their order, criteria and rules. What does not: pass records and test evidence
(Codeceipt builds its own from your next sessions).

## 3. Check the plan is safe
On the project's **Blueprint** tab, Codeceipt flags criteria that are vague or contradict each other, and features
with no "must never" rule. Fix them there, or click "Fix with my agent".

## 4. Let your agent follow it
Nothing to do: from the next session your agent gets a short start note (what is next, the rules, what is open), and
when you ask for something it gets that request's definition of done. At the end you get a **receipt**: what was
done, what was missed, and what the agent claimed that the change does not show.

## 5. Turn on the checks, one at a time
| The kit did this | Turn on in Codeceipt |
|---|---|
| Stops the agent ending with work unfinished | The done gate, gentle or strict: `codeceipt config` (see [actions.md](actions.md)) |
| Blocks edits to protected files | Add protected paths on the Blueprint tab; the hook stops those edits before they happen |
| Fails a commit that deletes or weakens tests, or adds a secret | `codeceipt guard --staged` as your pre-commit hook (setup offers it) and `codeceipt guard --ci` in CI |
| Needs your approval for plan changes | The **Approvals** tab: pick Careful, Balanced or Fast |
| `/feature`, `/bugfix` workflows | `/codeceipt-feature`, `/codeceipt-fix`, `/codeceipt-review` |

Run a few sessions after each one before removing the kit's version of it.

## 6. Keep files in step (optional)
If people or tools still read AGENTS.md or spec files:
```bash
codeceipt export --to agents --write
```
writes the approved plan into a marked section of AGENTS.md (it never touches the rest). `--to openspec` and
`--to speckit` write spec files. `codeceipt export --to agents --check` fails when the file is out of date, which is
useful in CI.

## What Codeceipt does not replace yet
Keep these from your kit:
- one gate command that runs typecheck, lint, tests and scanners;
- blocking a commit that touches files outside the task's scope;
- blocking a package install before it happens, and the "wait 7 days" rule for new packages;
- blocking the agent from reading `.env` files, using `--no-verify` or force-pushing;
- an independent second review by another agent.

The full mapping, practice by practice, is in [kit-migration.md](kit-migration.md).

## Not sure what to do next?
```bash
codeceipt status
```
prints the one next step. The project's Overview page shows the same one.
