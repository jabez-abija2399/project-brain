# Approval policies

Codeceipt decides, for every action that needs a decision, whether it may happen. The owner sets the policy; agents
can only ask. Source of truth: `packages/core/src/approvals.ts` (`APPROVAL_ACTIONS`, `PRESETS`, `decide`).

## Choices
| Choice | What happens |
|---|---|
| never | The action is refused. |
| ask | The owner is asked. The agent keeps working; the request expires after 24 hours (nothing happens). |
| auto, tell me | The action happens, and it shows in the daily summary with one-click undo. |
| auto | The action happens. |

**How a policy decides:**
1. Matching rules count first, `never` before `ask` before the automatic choices. Within a level, the first matching
   rule wins.
2. A rule can be scoped by action, feature, path pattern and agent.
3. Without a matching rule, the preset decides.

## Risk levels and actions
| Risk | Actions | Careful | Balanced (default) | Fast |
|---|---|---|---|---|
| low | fix wording, add a criterion, link a test, postpone or close an item, add a decision | auto, tell me | auto | auto |
| medium | change a criterion's meaning, add a dependency, add a protected path, rename or merge features, a new "prove it" command | ask | auto, tell me | auto |
| high | remove a criterion, delete a feature, approve a plan or an import, share publicly, edit a protected file, comment on a public PR | ask | ask | ask |
| locked | remove a security or must-never criterion, remove a protected path, turn off the done gate or Guard, change the approval policy | ask | ask | ask |

## Fixed safety rules
- **Locked actions are never automatic,** whatever the preset or a rule says. Only a stricter `never` rule changes
  them.
- **Pause** makes nothing automatic until it ends.
- **Only the owner changes the policy.** Loosening it asks for confirmation; tightening is instant.
- **Agents never decide:** they cannot approve, change or bypass a policy.
- **Every decision is kept in an append-only audit log.**
