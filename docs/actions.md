# Everything you can do, and where

Every Codeceipt action in one place: the command in the terminal, the page on the web and what to ask your agent.
Tests keep this page complete: every `codeceipt` command, every MCP tool and every project tab must appear here.

Not sure what to do next? Run `codeceipt status`, or open your project's **Overview** page. Both show the same one
next step.

## Get started
| You want to | In the terminal | On the web | Ask your agent |
|---|---|---|---|
| Connect this repo to a project | `codeceipt` or `codeceipt connect` | Connect tab | |
| Log in with a token from stdin | `codeceipt login` | Tokens tab (create a token) | |
| Set up your agents in this repo | `codeceipt init` | Connect tab | |
| Index the repo again | `codeceipt index` | | |
| Disconnect this repo | `codeceipt unlink` | Tokens tab (revoke the token) | |
| Check the install, login and hooks | `codeceipt doctor` | | |
| Update the app | `codeceipt update` | | |
| See the version | `codeceipt --version` | | |
| Know what to do next | `codeceipt status` | Overview tab | `where_did_we_stop` |

## Plan and describe your app
| You want to | In the terminal | On the web | Ask your agent |
|---|---|---|---|
| Plan a new project | | Plan tab (approve the draft) | `plan_project` |
| Bring in an existing spec | `codeceipt import` | Plan tab (approve the draft) | |
| See and edit what the app must and must never do | | Blueprint tab | `propose_blueprint` |
| Put the Blueprint into AGENTS.md, OpenSpec or Spec Kit | `codeceipt export` | | |
| See every feature and how far it is | | Features tab | `where_did_we_stop` with features |
| Review the feature map your agent suggested | | Proposals tab | |

## Build
| You want to | In the terminal | On the web | Ask your agent |
|---|---|---|---|
| Build one feature step by step | | | `/codeceipt-feature` |
| Fix one bug | | | `/codeceipt-fix` |
| Give the agent the right context | | | `get_context_pack`, `find_similar_component` |
| Keep a checklist of a request | | Features tab | `create_checklist`, `propose_checklist_change` |
| Check a package before installing it | | | `check_package` |
| Record a decision | | | `add_decision` |
| Save progress for the next session | `codeceipt receipt` | | `save_progress` |

## Check the work
| You want to | In the terminal | On the web | Ask your agent |
|---|---|---|---|
| See the last receipt | `codeceipt last` | Receipts tab | `generate_receipt` |
| Review a change against the build checklist | `codeceipt review` | | `/codeceipt-review` |
| Check changed files before a commit | `codeceipt guard` | | |
| Run only the tests for this change | `codeceipt prove` | | |
| Scan for secrets | `codeceipt scan-secrets` | | |
| Check a live Supabase database for open tables | `codeceipt rls` | | |
| Change settings (stop gate, Guard, check command, updates) | `codeceipt config` | | |

## Stay in control
| You want to | In the terminal | On the web | Ask your agent |
|---|---|---|---|
| Approve, reject or pause what agents ask for | `codeceipt approvals` (prints the link) | Approvals tab | Agents can only ask |
| Revoke a token | | Tokens tab | |

Old tool name kept for one release: `list_features` (use `where_did_we_stop` with features).
