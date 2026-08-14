---
name: issue-pipeline
description: Drive GitHub issues through an autonomous plan → implement → test → pull request pipeline, using stage:* labels as state. Use when the user asks to plan queued issues, work the issue queue, take an issue to a pull request, or check where the pipeline left off — for example "прогони очередь issues", "спланируй #836", "доведи #836 до PR", "что застряло в пайплайне".
---

# Issue pipeline

Two workflows move GitHub issues from a filed report to an open pull request. Labels carry the state, so a run can be
interrupted and resumed, and two runs never pick up the same issue. The workflows work in any repository with a GitHub
remote; project-specific knowledge lives in a per-repository profile.

```text
                    ┌─────────────(human rejects)<───────────┐
                    ▼                                        │
stage:replan ──> stage:planning ──> stage:plan-review ────────┴──(approves)──> stage:implement
                    ▲    │                                                            │
stage:plan ─────────┘    └───────> stage:needs-human <────────┐                       ▼
                                                              │                stage:working
                                  stage:done <──(PR opened)── stage:testing ──────────┘
```

The main human gate is `stage:plan-review`, and it has two exits: `stage:implement` to proceed, `stage:replan` to
send the plan back. A plan that leaves an open question skips that gate and goes to `stage:needs-human` instead, where
the user answers in a comment rather than approving or rejecting. One label sits outside this flow: `stage:review`
marks a pull request that was handed to the pipeline, which has code to review rather than an issue to plan.

## Running it

**You must call the `Workflow` tool for this skill** — that is what the skill is for. Both scripts live in
`~/.claude/workflows/` and are invoked by name.

Plan the queue:

```text
Workflow({ name: 'issue-plan', args: { limit: 3 } })
```

Ship approved plans:

```text
Workflow({ name: 'issue-ship', args: { limit: 3 } })
```

Both run in the background and return a task ID. Tell the user they can watch progress with `/workflows`, and report
the result when the completion notification arrives.

### Arguments

| Argument | Default | Meaning |
|---|---|---|
| `limit` | `3` | How many issues one run takes from the queue |
| `maxRounds` | `3` | Review rounds per stage before the issue goes to `stage:needs-human` |
| `issues` | — | Explicit issue numbers, bypassing queue order: `{ issues: [836, 840] }` |
| `draft` | `true` | `issue-ship` only: open the pull request as a draft |
| `codex` | `true` | `issue-ship` only: run the Codex CLI as a second reviewer over the first version of the diff |

Pass `args` as a real object — `args: { issues: [867] }`, not a JSON-encoded string. Both scripts normalize whatever
arrives anyway (a JSON string, a bare number, an array, `"#867, #868"`), so a mis-typed argument no longer silently
drains the queue instead of planning the issue you named. Check the first `log()` line of a run to confirm what it
understood: it reports either the issue numbers or the queue mode before spawning anything.

A value with no digits in it — `"plan the ui issue"` — yields no issue list and falls back to queue mode. If the user
named an issue and the run reports queue mode, the argument did not survive; fix the call rather than the script.

### Cost

`issue-plan` spends 3 to 8 agents per issue; `issue-ship` spends 3 to 15. A three-issue ship run can therefore approach
45 agents, well above the usual workflow size guideline. That is deliberate — the round budget is the cost ceiling. When
the user wants a cheaper run, lower `limit` first, then `maxRounds`.

Not every stage needs the session model. The scripts already route by how much judgment a stage actually requires:

| Stage | Routing | Why |
|---|---|---|
| planner, reviewer, implementer, tester | session model, session effort | reading code and judging it is the whole point |
| queue, claim | session model, `effort: 'low'` | mostly `gh` calls, but the branches that exist (fork detection, replan mode) are expensive to get wrong |
| codex leg (ship) | `model: 'sonnet'`, `effort: 'low'` | runs one prepared command and relays the JSON it prints |
| publish (plan) | `model: 'sonnet'`, `effort: 'low'` | runs one prepared command and reports its output |
| publish (ship) | `model: 'sonnet'` | writes the pull request body — the one piece of prose in the mechanical stages |

Keep publish at one command. The reason is reliability rather than cost: when the step was a four-item checklist in a
prompt, an agent could skip `status clear` and leave two contradictory reports on the issue.

Three parallel issues also mean three concurrent builds on one machine. Drop to `limit: 2` if the machine struggles.

## How a review round converges

Both scripts run the same loop: produce an artifact, review it, feed the findings back, repeat until nothing above
`minor` remains or `maxRounds` runs out. Three things shape what that loop costs.

**Every finding names the assumption it rests on.** `dependsOnPremise` is one sentence the planner or implementer can
refute with one file reference. A finding whose assumption is buried in its prose takes a whole round to argue with;
one that states it can be retired in a paragraph of the fix report.

**A deadlock ends the loop early.** The reviewer classifies each finding it keeps: `new`, `unfixed`,
`refutes_rebuttal`, or `restated`. `restated` means it was rebutted, the reviewer has no new mechanism, and it still
disagrees. When every blocking finding is `restated`, the round budget can only replay the same exchange, so the script
stops there and parks the issue at `stage:needs-human` with the disagreement named. A run that ends this way says
`deadlocked` rather than `did not converge` — the two need different things from a human.

**Coverage travels with the result.** `checkedWithoutFindings` and `preexisting` never block. They reach the run result,
and `issue-ship` copies them into the report it posts when an issue gets stuck, so whoever picks it up knows what was
already examined and what was wrong next door before they start.

### The second reviewer in `issue-ship`

`issue-ship` reviews code no human has read, so it runs the Codex CLI alongside the Claude reviewer on round 1 and
merges both sets of findings. `scripts/codex_review.py` is that leg: it runs `codex exec review --base`, normalizes the
result into the workflow's finding shape, and reports a `status` of `ok`, `unavailable`, `timeout`, or `failed`.
Anything but `ok` degrades the round to one reviewer and is logged — it never fails the issue.

Findings merged from Codex carry `reviewer` and `agreement`. `agreement: "both"` means the two reviewers landed within
20 lines of each other in the same file without seeing each other's output, which is the one signal neither can produce
alone. The pairing only annotates; no finding is ever dropped because of it.

Codex looks once, at the first version of the diff. Re-running it each round would need the rejection ledger that the
`cross-review` skill keeps and this pipeline deliberately does not, so a later round would
re-file whatever the implementer had already rebutted. What Codex found on round 1 goes through the same fix loop as
everything else, and the Claude reviewer re-checks it from round 2 on.

Two operational notes. The script needs the cross-review skill installed, because that is where the Codex stream reader
is maintained against the CLI. And its default timeout is 540 seconds, chosen to stay under the ten-minute ceiling on a
foreground `Bash` call; a review that runs longer comes back as `timeout`.

## Where the plan lives

The **plan comment on the issue is the plan of record**. It survives a clean clone, is reachable from any machine, and
carries its own last-updated timestamp. `.claude/pipeline/runs/issue-<N>/plan.md` is a local cache of it, git-ignored
and disposable.

Both workflows read the comment, never the cache: the claim step of `issue-ship` and the replan path of `issue-plan`
refresh `plan.md` from the comment before anything else runs, even when a local copy already exists.

Each issue accumulates at most two pipeline comments, updated in place rather than appended:

| Comment | Holds |
|---|---|
| plan | the current plan, plus non-blocking reviewer notes |
| status | the latest outcome — pull request URL, or why the pipeline stopped |

`scripts/pipeline_comment.py` in this skill owns all of it, so no agent has to stitch `gh` calls together or decide
which copy wins:

```bash
python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py plan get <N> --out <path>
python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py plan put <N> --file <path> [--notes <path>]
python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py status put <N> --file <path>
python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py status clear <N>
python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py feedback <N>
python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py publish <N> [--plan P] [--findings JSON|FILE] \
    [--stuck REASON] [--detail FILE] [--stage stage:NAME]
```

Three of these are composites, and they are what the workflows call — one invocation per workflow step:

| Command | Replaces |
|---|---|
| `setup` | creating `stage:*` labels, checking and appending `.git/info/exclude` |
| `prepare <N> --out P` | `mkdir -p` + `plan get` + `feedback` + interpreting two exit codes to pick the mode |
| `publish <N> …` | rendering findings + `plan put` / `status put` + `status clear` + `gh issue edit` |

`prepare` prints JSON with `planFile` (absolute), `hasPlan`, `mode`, `feedback`, `labels`, and `stage`, so the mode
arrives already decided. `publish --findings` takes inline JSON or a path, so a large finding set need not fit on a
command line. Both are idempotent and safe to re-run.

The low-level commands stay for interactive use — reading a plan, clearing a stale status by hand. Reach for a
composite inside a workflow and a low-level command when working with the user.

Granularity here follows the workflow step, not the individual action. An agent that assembles four commands and reads
two exit codes has four chances to get it wrong, and it re-derives the same sequence on every run.

Exit code 3 means "nothing there" — no plan comment for `plan get`, no newer human comment for `feedback`. Treat it as
a normal branch, not an error. `--repo` defaults to whatever `gh` resolves in the working directory.

Use these commands yourself when the user asks to read or change a plan outside a run. Editing `plan.md` alone changes
nothing the pipeline will see — the edit has to reach the comment.

## The project profile

`.claude/issue-pipeline.md` in the repository root carries everything the pipeline cannot infer: which labels map to
which subsystem, which documents are normative, which build and test commands are canonical, which directions the
maintainers have already settled, and where pull requests are published. Every role reads it.

Without the profile the pipeline still runs — agents derive the repository from `gh repo view`, the push target from
`git remote -v` plus the authenticated login, and build commands from CI files — but the planner loses the project's
settled decisions, which no amount of reading the code recovers. When a repository has no profile, offer to write one
after the first run, using what the agents had to guess.

Everything else the pipeline needs is created on demand: the `stage:*` labels, the run directories, and the
`.git/info/exclude` entries for `.claude/pipeline/runs/` and `.claude/worktrees/`.

## When the user rejects a plan

At the `stage:plan-review` gate the user has three ways forward. Recommend the one that fits the size of their
objection rather than defaulting to a rerun:

1. **Small correction** — edit `.claude/pipeline/runs/issue-<N>/plan.md`, push it back to the plan comment, then label
   the issue `stage:implement`:

   ```bash
   python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py plan put <N> --file <path-to-plan.md>
   ```

   Planning does not run again at all, so this is the cheapest path — right for a wrong file path or a missing test
   case. The `plan put` step is not optional: `issue-ship` reads the comment, so an edit that stays local is silently
   discarded.
2. **Real disagreement** — the user comments on the issue saying what is wrong, then labels it `stage:replan`. The next
   `issue-plan` run picks those comments up, reworks the existing plan against them, and returns the issue to
   `stage:plan-review`. Use this when the approach itself needs to change.
3. **Start over** — label it `stage:plan` with no comment. The planner writes a fresh plan and ignores the old one.
   Rarely what the user wants; suggest option 2 first.

In `stage:replan` mode the human feedback outranks the reviewer: the planner treats it as the requirement, and the
reviewer is told not to file findings against changes made to satisfy it. A reviewer that could still veto the
maintainer would just burn the round budget and hand back the same plan.

`stage:replan` with no human comment newer than the plan has nothing to act on. The queue step downgrades it to a
normal plan and reports it under `skipped`.

"Newer than the plan" is measured against the plan comment's `updated_at`. Because the plan is edited in place,
feedback the planner has already folded in falls behind that timestamp on the next update and is not re-applied. Say
this when a user wonders why an old comment stopped being picked up.

## When a plan needs a decision

A plan can pass review and still not be implementable, because the work turns out to hinge on a choice only a
maintainer can make — a coverage service that cannot aggregate across languages, two fixes an order of magnitude apart
in cost. The planner writes that choice under **Open questions**, the reviewer reports the section verbatim, and
`issue-plan` publishes the plan but parks the issue at `stage:needs-human` instead of `stage:plan-review`. The question
lands in the status comment, so `gh issue list --label stage:needs-human` is the queue of decisions waiting on a human,
and the run reports those issues under `needsDecision` rather than `planned`.

The user answers in an issue comment. A targeted `issue-plan` then picks the issue up from `stage:needs-human`, reads
the comment as feedback, and reworks the plan against it — the same path as `stage:replan`, with no relabelling by
hand. Once the decision is settled for good, it belongs in the profile's **Settled decisions**, or the next planner
reopens it.

`stage:needs-human` therefore carries two different situations, and the status comment says which: a decision waiting
on the user, or a run that failed (the planner produced nothing, review did not converge). The first needs an answer,
the second needs a rerun.

## Running it for specific issues

Pass the numbers and the queue order is bypassed entirely:

```text
Workflow({ name: 'issue-plan', args: { issues: [836, 840] } })
```

**A brand-new issue needs no label.** Naming it is the request, so `stage:plan` is only for filling the queue that an
unattended run drains. Do not tell the user to label an issue they just pointed you at.

Naming an issue also lets a targeted run accept states the queue would not: `stage:replan` and `stage:needs-human`
alongside `stage:plan`. The mode is decided from the issue's actual state — a plan comment plus a human comment newer
than it means rework; anything else means plan from scratch. An issue parked in `stage:needs-human` therefore
continues as soon as the user answers the open question, with no relabelling by hand.

**Shipping is the exception: it is never implied by naming an issue.** `stage:implement` is how a human expresses
approval of the plan, and that gate is the point. A targeted `issue-ship` on an unlabelled issue reports back whether
a plan comment exists — if it does, the user only needs to apply `stage:implement`; if not, it needs planning first.

**A pull request among the numbers is routed, not worked.** Issues and pull requests share one numbering space, so
both workflows classify every number they are given and treat anything whose url contains `/pull/` as code that already
exists: they move the pull request to `stage:review`, drop whichever `stage:*` label it carried, and report it under
`pullRequests`. Nothing else happens to it — no plan, no run directory, no branch or worktree. `stage:review` is a
queue marker for a human or a review workflow; this pipeline never picks up from it.

A targeted run also refuses, reporting each under `skipped`:

- an issue another run owns right now (`stage:planning`, `stage:working`, `stage:testing`);
- an issue with an open pull request against it — one that lists the issue under `closingIssuesReferences`, or whose
  branch is `issue-<N>-*`. Both workflows refuse, in queue mode too, and a draft counts the same as a ready pull
  request. For `issue-plan` the code already exists, so there is nothing a plan can change; for `issue-ship` a second
  run would open a second pull request for one issue. When the branch is `issue-<N>-*` the pipeline itself shipped it,
  and further changes belong in that pull request: the worktree is still there, and a push to the same branch updates
  it. Otherwise a human is working on the issue by hand;
- for `issue-plan`, an issue already at `stage:implement`, `stage:plan-review`, or `stage:done` — replanning would
  discard a plan that is approved or already shipped;
- for `issue-plan`, a `stage:needs-human` issue that already has a branch with commits. That is a stalled
  implementation, not a stalled plan: it belongs to `issue-ship`, which reuses the worktree and re-runs review and
  tests over what is there.

**One run covers several issues only when they need the same workflow.** Mixed states split into two calls:

| The user has | Runs |
|---|---|
| one waiting to be planned, one answered in `stage:needs-human` after planning | one `issue-plan` with both numbers |
| one waiting to be planned, one answered in `stage:needs-human` after implementation | `issue-plan` for the first, `issue-ship` for the second |
| several with approved plans | one `issue-ship` with all the numbers |

When the user asks for a mixed set, check each issue's label and whether it has a branch, say which workflow each one
lands in, and launch both rather than silently dropping half the request.

## Choosing which workflow to run

- The user says "plan", "спланируй", or names issues that are not yet planned → `issue-plan`.
- The user says "implement", "доведи до PR", or the issues already carry `stage:implement` → `issue-ship`.
- The issues carry `stage:replan` → `issue-plan`; it serves that queue first.
- The user says "прогони очередь" without qualification → check the queues with
  `gh issue list --label stage:plan`, `--label stage:replan`, and `--label stage:implement`, report what is in each,
  and ask which to run rather than guessing. Running `issue-ship` on an unapproved plan defeats the human gate.

Before the first `issue-plan` run in a repository, confirm the queue is not empty. An empty queue usually means the
user has not applied `stage:plan` to anything yet — say so instead of running a workflow that returns nothing.

## Reading the result

Both workflows return `{ shipped | planned, stuck, pullRequests, skipped }`; `issue-plan` adds `needsDecision`. Report
to the user:

- what landed, with issue numbers and — for `issue-ship` — the pull request URLs;
- every issue under `needsDecision`, with the question itself. These are waiting on the user, and a plan they never
  read is a plan that never ships;
- what went to `stage:needs-human` and why, since that is the part needing their attention;
- anything the queue skipped, and for `issue-ship`, the `publishNote` describing where it pushed;
- any number that turned out to be a pull request and now sits in `stage:review`.

The per-agent transcript is in the run's journal, which the Workflow result points at. Read it before explaining why a
run produced nothing — do not guess from the return value alone.

## Recovering a stuck run

If a run is killed mid-flight, issues keep their in-progress label (`stage:planning`, `stage:working`,
`stage:testing`), and nothing picks them up again. That is intentional: resuming into a half-finished worktree is worse
than a human look. To restart one:

```bash
gh issue edit <N> --remove-label stage:planning --add-label stage:plan
```

For a killed ship run, check `.claude/worktrees/issue-<N>` first — the branch may already hold usable commits. Remove
the worktree with `git worktree remove` before re-claiming the issue, otherwise the claim step reuses it.

`Workflow({ scriptPath, resumeFromRunId })` also works: an unchanged prefix of agent calls returns from cache and only
the rest re-runs. Prefer that over a cold restart when the script itself was not the problem.

## Customizing a run

The two scripts are the skeleton, not a fixed program. For a one-off shape — say, a plan-only pass over a whole area
label, or a ship run that stops before publishing — copy the script into the scratchpad directory, edit it there, and
run the copy:

```text
Workflow({ scriptPath: '<scratchpad>/issue-ship-variant.js' })
```

Keep the edits in the scratchpad. Change `~/.claude/workflows/*.js` only when the user wants the standing behavior to
change in every repository.

The roles the scripts drive live in `~/.claude/agents/issue-{planner,reviewer,implementer,tester}.md`. Behavior that is
about *how* an agent works — what a reviewer treats as a blocker, how the tester proves a test fails without the fix —
belongs in those files. Behavior specific to one repository belongs in that repository's profile.

Two constraints the scripts have to respect:

- **Never pass `opts.agentType`.** A role in `~/.claude/agents/` reached through `agentType` arrives with no tools at
  all: with a schema the subagent gets only `StructuredOutput`, without one it gets nothing and starts narrating tool
  calls as text while reporting success. Load the role by prompt instead — that is what `ROLE(name)` does in both
  scripts. (Roles in a project's own `.claude/agents/` did work through `agentType`, which is why moving a working
  pipeline into `~/.claude/` breaks it silently.)
- **Absolute paths only.** Stages run with different working directories, so the claim step resolves every plan file
  and worktree path against `pwd` and passes it on. A relative path in a prompt reaches an agent that cannot find it.

When a run reports success but nothing landed — no file written, no comment posted — check the filesystem before
believing the transcript. An agent left without tools describes the work confidently instead of doing it.

## Boundaries

The pipeline never merges a pull request, never pushes to a remote other than the one the claim step resolved, and
never applies `stage:done` to an issue whose pull request does not exist. When the authenticated user has a fork, the
branch goes there and the pull request is opened with `--head <fork-owner>:<branch>`; otherwise it goes to the
upstream remote.

Run artifacts land in `.claude/pipeline/runs/issue-<N>/`, worktrees in `.claude/worktrees/issue-<N>/`. Both are
git-ignored. Worktrees survive the run on purpose, so the branch stays inspectable after a pull request is open.
