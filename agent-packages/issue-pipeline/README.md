# Issue pipeline

Take a GitHub issue from a filed report to an open pull request, with one human gate in the middle. A planner writes an
implementation plan and an adversarial reviewer attacks it until the two converge; a human approves the plan; an
implementer builds it in a dedicated git worktree; a reviewer and a tester go over the diff; the run opens the pull
request and reports back.

State lives in `stage:*` labels on the issue itself, not in a local file. A killed run leaves the issue where it was, a
second run never picks up an issue the first one owns, and the plan of record is a comment on the issue that survives a
clean clone.

```text
                    ┌─────────────(human rejects)<───────────┐
                    ▼                                        │
stage:replan ──> stage:planning ──> stage:plan-review ────────┴──(approves)──> stage:implement
                    ▲    │                                                            │
stage:plan ─────────┘    └───────> stage:needs-human <────────┐                       ▼
                                                              │                stage:working
                                  stage:done <──(PR opened)── stage:testing ──────────┘
```

Two commands drive it once installed:

```text
/issue-plan    plan the issues labeled stage:plan
/issue-ship    implement the plans a human approved with stage:implement
```

## What is in here

This is not an APM package. The tree mirrors `~/.claude/`, so installing means copying three directories into place —
which is also why the pieces are separable: the roles are plain Markdown, the scripts are plain Python over the `gh`
CLI, and only the two workflow scripts are specific to Claude Code.

| Path | What it is |
|---|---|
| `skills/issue-pipeline/SKILL.md` | The operating manual: when to run which workflow, what the labels mean, how to read a result, how to recover a stuck run. Read this one first. |
| `skills/issue-pipeline/scripts/pipeline_comment.py` | Owns every `gh` call the pipeline makes against an issue: the plan comment, the status comment, the labels, the run directory. |
| `skills/issue-pipeline/scripts/codex_review.py` | Optional second reviewer. Runs `codex exec review` and normalizes its output into the workflow's finding shape. |
| `agents/issue-planner.md` | The role that turns an issue into a plan, or reworks a plan against findings. |
| `agents/issue-reviewer.md` | The role that attacks a plan, a diff, or a test suite on the issue's terms. |
| `agents/issue-implementer.md` | The role that implements an approved plan in a worktree, and fixes what review finds. |
| `agents/issue-tester.md` | The role that writes regression tests, runs the build, and checks the docs for drift. |
| `workflows/issue-plan.js` | Orchestrates queue → plan → review rounds → publish. |
| `workflows/issue-ship.js` | Orchestrates claim → implement → review rounds → test → pull request. |

The two `.js` files are [dynamic workflows](https://code.claude.com/docs/en/workflows): scripts that spawn subagents
deterministically, so the control flow — how many review rounds, what runs in parallel, when a run gives up — is code
rather than a model's judgment.

## Requirements

- Claude Code v2.1.154 or later, with dynamic workflows enabled. On Pro, turn them on in `/config` → **Dynamic
  workflows**.
- The `gh` CLI, authenticated against the repository you point the pipeline at.
- `python3`. Both scripts use only the standard library.
- Optional, for the second reviewer in `issue-ship`: the `codex` CLI on `PATH` and a `cross-review` skill in
  `~/.claude/skills/cross-review/`, which owns the Codex stream reader the script imports. Without either one, the
  round runs with the Claude reviewer alone and says so in the log.

A run is not cheap: `issue-plan` spends 3 to 8 subagents per issue, `issue-ship` spends 3 to 15. Start with one issue.

## Install

```bash
mkdir -p ~/.claude/skills ~/.claude/agents ~/.claude/workflows
cp -R agent-packages/issue-pipeline/skills/issue-pipeline ~/.claude/skills/
cp -R agent-packages/issue-pipeline/agents/. ~/.claude/agents/
cp -R agent-packages/issue-pipeline/workflows/. ~/.claude/workflows/
```

If you set `CLAUDE_CONFIG_DIR`, copy into that directory instead of `~/.claude`. Start a new Claude Code session
afterwards — workflows and agents are read at startup. `/issue-plan` and `/issue-ship` in the command list mean the
copy worked.

The home directory is the only supported location. Both workflow scripts address the roles and the Python scripts by
absolute path, because a workflow's stages run with different working directories and a relative path reaches an agent
that cannot resolve it. Installing into a repository's `.claude/` or shipping this as a plugin means rewriting those
paths first: `grep -n '~/.claude' workflows/*.js` finds all of them, and `codex_review.py` looks up the `cross-review`
skill the same way.

Nothing else is installed and nothing is written to the repository you run it against, beyond the `stage:*` labels it
creates and the two comments it posts per issue.

## First run

1. Label one issue `stage:plan`, or just name the issue — a targeted run needs no label:

   ```text
   /issue-plan 123
   ```

1. The run posts the plan as a comment and moves the issue to `stage:plan-review`. Read the plan. This is the gate the
   pipeline exists for, and everything after it assumes a human looked.
1. Approve by labeling the issue `stage:implement`, then:

   ```text
   /issue-ship 123
   ```

1. The run implements the plan in `.claude/worktrees/issue-123/`, reviews and tests it, opens the pull request, and
   labels the issue `stage:done`. The worktree stays behind on purpose, so the branch is still there to inspect.

If the plan is wrong, do not rerun blindly: comment on the issue saying what is wrong and label it `stage:replan`. The
next planning run treats your comment as the requirement and reworks the existing plan rather than starting over. The
skill's *When the user rejects a plan* section covers all three exits from the gate.

## The per-repository profile

`.claude/issue-pipeline.md` in a target repository carries what the pipeline cannot infer: which labels map to which
subsystem, which documents are normative, which build and test commands are canonical, which directions the maintainers
have already settled, and where pull requests are published. Every role reads it.

Without the profile the pipeline still runs — agents derive the repository from `gh repo view`, the push target from
`git remote -v`, and build commands from the CI files — but the planner loses the project's settled decisions, and no
amount of reading the code recovers those. Write one after the first run, from whatever the agents had to guess.

## What it never does

It never merges a pull request, never pushes to a remote the claim step did not resolve, and never marks an issue
`stage:done` without a pull request to point at. When the authenticated user has a fork, the branch goes to the fork and
the pull request is opened with `--head <fork-owner>:<branch>`.

## Updating and removing

Updating is the same copy again; the files are self-contained and hold no state. To remove:

```bash
rm -rf ~/.claude/skills/issue-pipeline
rm -f ~/.claude/agents/issue-{planner,reviewer,implementer,tester}.md
rm -f ~/.claude/workflows/issue-{plan,ship}.js
```

Issues keep whatever `stage:*` label they carried. Delete the labels in the GitHub UI if you want them gone.

## Adapting it to another agent

The Claude-specific part is small. Both `.js` files depend on the `agent()`, `parallel()`, `pipeline()`, `phase()`, and
`log()` hooks of the dynamic-workflow runtime, and on `Workflow`'s structured-output schemas. Everything else ports:

- The four role files are ordinary Markdown prompts. Nothing reads their frontmatter except Claude Code's own agent
  loader, and the workflows deliberately load them as text rather than through `agentType`.
- `pipeline_comment.py` is a plain CLI over `gh`. Whatever drives your agent can call it, and the label protocol —
  claim by moving the label, publish through one command — is the part that makes concurrent runs safe.
- The state machine is the design, not the code. Labels as state, plan-as-comment, one human gate, an adversarial
  reviewer with a round budget, and a deadlock exit that parks the issue instead of burning the budget.

## Why this is not an APM package

APM deploys instructions, skills, prompts, agents, and hooks. It has no notion of a workflow, so `apm install` cannot
put `issue-plan.js` anywhere Claude Code will find it. Claude Code resolves a workflow by name only from
`~/.claude/workflows/`, a project's `.claude/workflows/`, or a plugin installed from a marketplace — a subdirectory of
a skill is not one of those, so a skill-shipped script can only be invoked by path, and `/issue-plan` would not exist.

Mirroring `~/.claude/` keeps the named invocation and costs one `cp` per directory.
