export const meta = {
  name: 'issue-plan',
  description: 'Plan queued GitHub issues: a planner and an adversarial reviewer converge, then the plan is posted',
  whenToUse:
    'Run over issues labeled stage:plan to produce a reviewed implementation plan and hand it to a human for approval.',
  phases: [
    { title: 'Queue', detail: 'resolve the repository, pick the most important stage:plan issues, claim them' },
    { title: 'Plan', detail: 'one planner per issue, writing to .claude/pipeline/runs/issue-<N>/plan.md' },
    { title: 'Review', detail: 'adversarial review, up to maxRounds per issue' },
    { title: 'Publish', detail: 'post the plan as an issue comment and move the stage label' },
  ],
}

// `args` reaches the script however the caller passed it: an object, a JSON string, a bare number, "#867, #868".
// Normalizing here beats documenting the one correct form, because a mis-typed argument silently plans nothing.
function readArgs(raw) {
  let a = raw
  if (typeof a === 'string') {
    const text = a.trim()
    if (!text) return {}
    try {
      a = JSON.parse(text)
    } catch {
      a = { issues: text }
    }
  }
  if (typeof a === 'number') return { issues: [a] }
  if (Array.isArray(a)) a = { issues: a }
  if (!a || typeof a !== 'object') return {}

  const out = { ...a }
  const nums = (v) => {
    if (typeof v === 'number') return [v]
    if (typeof v === 'string') return (v.match(/\d+/g) ?? []).map(Number)
    if (Array.isArray(v)) return v.flatMap(nums)
    return []
  }
  const issues = nums(out.issues)
  out.issues = issues.length ? [...new Set(issues)] : undefined

  const int = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined)
  out.limit = int(out.limit)
  out.maxRounds = int(out.maxRounds)
  return out
}

const A = readArgs(args)

const LIMIT = A.limit ?? 3
const MAX_ROUNDS = A.maxRounds ?? 3
const ONLY = A.issues // optional explicit list of issue numbers, bypasses the queue order
const BUDGET_FLOOR = 150_000 // stop taking new issues below this many remaining output tokens

const QUEUE_SCHEMA = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name of the upstream repository' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          priority: { type: 'string' },
          area: { type: 'string' },
          slug: { type: 'string', description: 'kebab-case summary of the title, at most 5 words' },
          planFile: { type: 'string', description: 'absolute path of the plan file to create' },
          mode: {
            type: 'string',
            enum: ['plan', 'replan'],
            description: 'replan when the issue carried stage:replan and a human rejected the previous plan',
          },
          feedback: {
            type: 'string',
            description: 'in replan mode, the human comments posted after the last pipeline plan, verbatim',
          },
        },
        required: ['number', 'title', 'slug', 'planFile', 'mode'],
        additionalProperties: false,
      },
    },
    pullRequests: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          note: { type: 'string', description: 'what was done with it, e.g. moved to stage:review' },
        },
        required: ['number', 'note'],
        additionalProperties: false,
      },
      description: 'named numbers that turned out to be pull requests; they are routed, never planned',
    },
    skipped: {
      type: 'array',
      items: { type: 'string' },
      description: 'issues that matched the label but were not claimed, with the reason',
    },
  },
  required: ['repo', 'issues'],
  additionalProperties: false,
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    artifactMissing: {
      type: 'boolean',
      description: 'true when the plan file does not exist or is empty, so there was nothing to review',
    },
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'the decisions the plan lists under "Open questions", one per item, each a single line; empty when that section is empty or says none',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          why: { type: 'string', description: 'the concrete failure: input, state, or sequence producing it' },
          suggestion: { type: 'string' },
          anchor: { type: 'string', description: 'file:line or plan section the finding applies to' },
          dependsOnPremise: {
            type: ['string', 'null'],
            description:
              'the assumption the finding rests on, in one sentence; refute it and the finding is gone. null when the finding stands on the plan alone',
          },
          history: {
            type: 'string',
            enum: ['new', 'unfixed', 'refutes_rebuttal', 'restated'],
            description:
              'new: not filed before. unfixed: filed before and neither changed nor answered. refutes_rebuttal: filed before, rebutted, and "why" now names the mechanism that defeats the rebuttal. restated: filed before, rebutted, and no new mechanism',
          },
        },
        required: ['severity', 'summary', 'why', 'suggestion', 'history'],
        additionalProperties: false,
      },
    },
    checkedWithoutFindings: {
      type: 'string',
      description: 'what the reviewer examined and found sound; this is the only record of coverage a human ever sees',
    },
    preexisting: {
      type: 'array',
      items: { type: 'string' },
      description: 'problems the plan sits next to but does not cause, one line each; these never block',
    },
  },
  required: ['verdict', 'findings'],
  additionalProperties: false,
}

const blocking = (review) => (review?.findings ?? []).filter((f) => f.severity !== 'minor')

// A blocking set made entirely of findings the reviewer itself marks `restated` is a disagreement, not a defect queue:
// the planner rebutted them, the reviewer has no new mechanism, and every remaining round replays the same exchange.
// Handing it to a human immediately is both cheaper and the same outcome the round budget would reach.
const deadlocked = (items) => items.length > 0 && items.every((f) => f.history === 'restated')

// What the reviewer looked at and found sound, plus what it found next door. Neither belongs in the findings list —
// one blocks nothing and the other is not a finding at all — so both ride out in the run result, where the human who
// approves the plan can read them.
const coverageOf = (review) => ({
  checked: review?.checkedWithoutFindings ?? null,
  preexisting: review?.preexisting ?? [],
})

// The plan comment on the issue is the plan of record; plan.md is a local cache of it. This script owns both
// directions, so no agent has to stitch gh calls together or decide which copy wins.
const TOOL = 'python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py'

// Roles are loaded by prompt, not through agentType. An agentType pointing at ~/.claude/agents/ leaves the subagent
// with no tools at all — it then narrates tool calls as text and writes nothing. Verified 2026-07-25: planner and
// reviewer both came back empty-handed under agentType, while the same task ran fine without it.
const ROLE = (name) =>
  `Read ~/.claude/agents/${name}.md first (\`cat ~/.claude/agents/${name}.md\`). That file is your role definition:
follow it as your operating instructions for everything below, including its response contract.

`

// ---------------------------------------------------------------- queue

phase('Queue')

log(
  ONLY
    ? `Planning only ${ONLY.map((n) => '#' + n).join(', ')} (max ${MAX_ROUNDS} review rounds)`
    : `Draining the plan queue, up to ${LIMIT} issues (max ${MAX_ROUNDS} review rounds)`,
)

const queuePrompt = `You are claiming GitHub issues for an autonomous planning pipeline.

First resolve the repository: \`gh repo view --json nameWithOwner\` from the repository root. Return it as "repo".

${
  ONLY
    ? `Then work on exactly these numbers, in this order: ${ONLY.join(', ')}.

Issues and pull requests share one numbering space, so classify every number before you touch it. This read is safe to
do first:
  gh issue view <N> --json number,title,url

A url containing /pull/ means the number is a pull request. A pull request has nothing to plan: it is code that already
exists, so it belongs in the review queue instead. After the setup step below has created the stage:* labels, move it
there:
  gh pr edit <N> --add-label stage:review \\
    --remove-label stage:plan --remove-label stage:replan --remove-label stage:planning \\
    --remove-label stage:needs-human

Report each one under "pullRequests" with the note "moved to stage:review", and leave it out of "issues". Do not run
prepare on it, do not claim it as stage:planning, and do not create a run directory for it. A pull request already
carrying stage:review is the same case: report it, change nothing.

Naming an issue explicitly is the user's intent, and it replaces the stage:plan label entirely: an issue with no
stage:* label at all is the normal case here, and you plan it. Accept stage:plan, stage:replan, and stage:needs-human
just the same, and decide the mode from the issue's actual state rather than from its label.

Skip an issue only in these cases, each with the reason under "skipped":

- It carries stage:planning, stage:working, or stage:testing — another run owns it right now.
- It carries stage:needs-human **and** a branch issue-<N>-* exists with commits beyond the base branch. That is a
  stalled implementation, not a stalled plan; the user wants issue-ship for it. Check with
  \`git branch --list 'issue-<N>-*'\` and \`git log --oneline <base>..<branch>\`.
- It carries stage:implement, stage:plan-review, or stage:done. Planning it again would throw away a plan that is
  already approved or already shipped. Say so; if the user wants it replanned, they can say that explicitly and you
  will see stage:replan next time.
- It is closed.`
    : `Then list open issues in both planning queues:
  gh issue list --state open --label stage:plan --limit 100 --json number,title,labels
  gh issue list --state open --label stage:replan --limit 100 --json number,title,labels

stage:replan issues come first as a group — a human is waiting on them. Within each group, order by priority label:
priority:critical, then priority:high, then priority:medium, then priority:low, then issues with no priority label.
Break ties by the lower issue number. Take the first ${LIMIT} overall.`
}

Whatever brought an issue this far, drop it when a pull request is already open against it. One call lists them all:

  gh pr list --state open --limit 200 --json number,url,headRefName,closingIssuesReferences

An issue belongs to an open pull request when that pull request lists it under closingIssuesReferences, or when its
headRefName is issue-<N>-* — the branch name this pipeline gives its own work. Either way the code exists already, and
a plan written now would be reviewed against a diff nobody is going to rewrite. Report it under "skipped" naming the
pull request, for example "#841: PR #908 is open against it", and claim nothing.

This holds in every mode, including an issue the user named explicitly and an issue carrying stage:replan. Reworking
the plan is not what changes an open pull request; the user closes it, or comments on it, or asks for issue-ship. A
draft pull request counts the same as a ready one.

Before claiming anything, make the repository ready. This creates any missing stage:* labels and git-ignores the
pipeline's scratch paths, and is a no-op when they already exist:

  ${TOOL} setup

Then, for each issue you take, run exactly one command — it creates the run directory, refreshes the local plan cache
from the plan comment, collects any human feedback newer than that plan, and decides the mode:

  ${TOOL} prepare <N> --out .claude/pipeline/runs/issue-<N>/plan.md

It prints JSON with "planFile" (absolute), "hasPlan", "mode", "feedback", "labels", and "stage". Copy those fields
straight into your result; do not re-derive the mode, and do not run plan get, feedback, mkdir, or gh label list
yourself. "mode" is "replan" when a plan exists and a human commented after it was last updated.

One case the command cannot judge for you: when the issue carried stage:replan but "feedback" comes back empty, the
user asked for rework and left nothing to act on. Keep the mode as "plan" and note it under "skipped".

Claim each issue so a parallel run cannot pick it up, removing whichever stage label it carried:
  gh issue edit <N> --remove-label stage:plan --remove-label stage:replan --remove-label stage:needs-human \\
    --add-label stage:planning

Then create its run directory: mkdir -p .claude/pipeline/runs/issue-<N>

Make sure the pipeline's scratch paths are git-ignored in this repository. If neither .gitignore nor .git/info/exclude
covers them, append these two lines to .git/info/exclude:
  **/.claude/pipeline/runs/
  **/.claude/worktrees/

Return "planFile" as an absolute path: run \`pwd\` once from the repository root and join it with
.claude/pipeline/runs/issue-<N>/plan.md. Later stages run with a different working directory, so a relative path there
would break.

Also produce a slug for each issue: a kebab-case summary of the title, at most five words, lowercase, ASCII only.
It is used as a branch name later, so it must be a valid git ref component.

Claim only the issues you return. Do not read the issue bodies, do not comment, do not plan anything.`

const queue = await agent(queuePrompt, { schema: QUEUE_SCHEMA, label: 'queue', effort: 'low' })

const REPO = queue?.repo
let issues = queue?.issues ?? []
const pullRequests = queue?.pullRequests ?? []

if (pullRequests.length) {
  log(`Not planning ${pullRequests.map((p) => '#' + p.number).join(', ')}: pull requests, moved to stage:review`)
}

if (budget.total) {
  const affordable = Math.max(1, Math.floor(budget.remaining() / BUDGET_FLOOR))
  if (issues.length > affordable) {
    log(`Token budget allows ${affordable} of ${issues.length} claimed issues; the rest stay in stage:planning`)
    issues = issues.slice(0, affordable)
  }
}

if (!REPO || !issues.length) {
  log(
    !REPO
      ? 'Could not resolve the repository'
      : ONLY
        ? `Nothing to plan: ${ONLY.map((n) => '#' + n).join(', ')} were routed or skipped — see "pullRequests" and "skipped"`
        : 'No issues in the stage:plan or stage:replan queues',
  )
  return { planned: [], stuck: [], pullRequests, skipped: queue?.skipped ?? [], requested: ONLY ?? null }
}

log(`Planning ${issues.map((i) => '#' + i.number).join(', ')} in ${REPO}`)

// ---------------------------------------------------------------- plan and review

const planTrack = async (issue) => {
  const n = issue.number
  const file = issue.planFile
  const feedback = issue.mode === 'replan' ? issue.feedback : null

  // Human feedback outranks the reviewer, so every prompt in this track carries it.
  const humanRequirement = feedback
    ? `

A human read the previous plan and rejected it. Their feedback is the requirement now — it outranks anything the
reviewer says, and a plan that ignores it is wrong no matter how well argued:

--- human feedback ---
${feedback}
--- end human feedback ---`
    : ''

  const planned = await agent(
    ROLE('issue-planner') +
      (feedback
      ? `Rework the plan in ${file} for issue #${n} of ${REPO}: "${issue.title}".

Mode: human feedback. The file already holds the plan the human rejected — read it and revise it in place rather than
starting over, so the parts they did not object to survive.${humanRequirement}

Read the issue for context: gh issue view ${n} --repo ${REPO} --json number,title,body,labels,comments

Rewrite ${file} with the Write tool. That file is the deliverable; your reply is never read as the plan. If the
feedback conflicts with the issue as filed, follow the feedback and record the conflict under Open questions.`
      : `Write the implementation plan for issue #${n} of ${REPO}: "${issue.title}".

Read the issue with: gh issue view ${n} --repo ${REPO} --json number,title,body,labels,comments

Write the plan to ${file} using the Write tool. That file is the deliverable: the reviewer reads it, and your reply is
never read as the plan. Confirm the file exists before you finish, and report its size.`),
    { phase: 'Plan', label: `${feedback ? 'replan' : 'plan'}:#${n}` },
  )

  if (planned === null) return { issue, file, stuck: 'the planner failed', findings: [] }

  let last = null

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const review = await agent(
      ROLE('issue-reviewer') +
        `Review the plan in ${file} against issue #${n} of ${REPO}: "${issue.title}".

Review mode: plan. Round ${round} of ${MAX_ROUNDS}.
Read that file first. If it does not exist or is empty, set "artifactMissing" to true and return a single blocker
saying so — do not review from memory and do not reconstruct the plan yourself. The orchestrator stops the loop on
that flag instead of spending the remaining rounds on an input that is not there.

Copy the plan's "Open questions" section into "openQuestions", one line per question, in the planner's own words. A
question there means the plan needs a maintainer's answer before anyone implements it, so the orchestrator routes the
issue to a human instead of to the approval gate. Report what the section says; do not add questions of your own, and
do not drop one because you think you know the answer. An empty section, or one that says there are none, is an empty
array.${
        feedback
          ? `

This plan was reworked after a human rejected the previous version. Their feedback is binding: treat it as part of the
requirement alongside the issue itself. Do not file a finding against a change the plan made to satisfy it — if you
believe the feedback leads somewhere harmful, say so as a "minor" finding addressed to the human, and let the plan
stand.

--- human feedback ---
${feedback}
--- end human feedback ---`
          : ''
      }
${
  last
    ? `
Your findings from the previous round were:
${JSON.stringify(last.findings, null, 2)}

The planner either addressed them or rebutted them under a "Review notes" section at the end of the plan. Read that
section before re-filing anything, and set "history" on every finding you keep. A rebuttal you cannot defeat with a
mechanism makes the finding "restated", not "refutes_rebuttal" — the workflow stops on a set of restated blockers and
gives the disagreement to a human, which is what a deadlock deserves.`
    : ''
}`,
      { phase: 'Review', label: `review:#${n} r${round}`, schema: REVIEW_SCHEMA },
    )

    if (review === null)
      return { issue, file, stuck: 'the reviewer failed', findings: last?.findings ?? [], coverage: coverageOf(last) }

    // A review cannot converge against a file that is not there, so spending the rest of the budget on it only buys a
    // misleading "review did not converge". Name the real failure — the planner — and stop after one round.
    if (review.artifactMissing) {
      log(`#${n}: the planner wrote no plan file; stopping instead of spending ${MAX_ROUNDS - round} more rounds`)
      return {
        issue,
        file,
        stuck: `the planner did not write ${file}`,
        findings: review.findings,
        coverage: coverageOf(review),
      }
    }

    last = review

    const blockers = blocking(review)

    if (!blockers.length) {
      const questions = review.openQuestions ?? []
      log(
        questions.length
          ? `#${n}: plan approved in round ${round}, but it leaves ${questions.length} open question(s) for a maintainer`
          : `#${n}: plan approved in round ${round}`,
      )
      return { issue, file, findings: review.findings, openQuestions: questions, coverage: coverageOf(review) }
    }

    if (deadlocked(blockers)) {
      log(`#${n}: every blocking finding is a restatement the planner already rebutted; stopping at round ${round}`)
      return {
        issue,
        file,
        stuck: `reviewer and planner deadlocked on ${blockers.length} finding(s) in round ${round}: restated without new evidence`,
        findings: review.findings,
        coverage: coverageOf(review),
      }
    }

    if (round === MAX_ROUNDS) {
      log(`#${n}: review did not converge in ${MAX_ROUNDS} rounds`)
      return {
        issue,
        file,
        stuck: `review did not converge in ${MAX_ROUNDS} rounds`,
        findings: review.findings,
        coverage: coverageOf(review),
      }
    }

    const revised = await agent(
      ROLE('issue-planner') +
        `Revise the plan in ${file} for issue #${n} of ${REPO}.

Mode: revise. Round ${round} of ${MAX_ROUNDS}. Rewrite that file in place; your reply is not read as the plan.${humanRequirement}

Reviewer findings:
${JSON.stringify(review.findings, null, 2)}`,
      { phase: 'Plan', label: `revise:#${n} r${round}` },
    )

    if (revised === null)
      return {
        issue,
        file,
        stuck: 'the planner failed while revising',
        findings: review.findings,
        coverage: coverageOf(review),
      }
  }

  return { issue, file, stuck: 'unreachable', findings: last?.findings ?? [] }
}

// ---------------------------------------------------------------- publish

const publishTrack = async (result) => {
  if (!result) return null
  const n = result.issue.number

  // One command does the whole step: plan comment, reviewer notes, stale-status cleanup, and the stage label. The
  // agent here is only a shell; splitting this across prompt steps is how `status clear` used to get skipped.
  const findings = JSON.stringify(result.findings ?? [])

  // A reviewed plan that still asks the maintainer something is not ready for the approval gate: approving it would
  // hand an implementer a choice only a human can make. It publishes as a plan and parks at stage:needs-human, so the
  // question is visible in the status comment and `gh issue list --label stage:needs-human` is the queue of decisions
  // waiting on a human. Keep the reason on one line — a newline inside --stuck reaches the comment as a literal \n.
  const questions = result.stuck ? [] : (result.openQuestions ?? [])
  const decision = questions.length ? `the plan needs a maintainer's decision: ${questions.join('; ')}` : null

  // --repo is a global option of the tool, so it goes before the subcommand. After it, argparse rejects the whole
  // call — which is exactly what happened to one publish step on 2026-08-11 while the other two agents improvised.
  const cmd = result.stuck || decision
    ? `${TOOL} --repo ${REPO} publish ${n} --stage stage:needs-human \\
    --stuck ${JSON.stringify(result.stuck ?? decision)} --findings ${JSON.stringify(findings)}${
        result.file ? ` --plan ${result.file}` : ''
      }`
    : `${TOOL} --repo ${REPO} publish ${n} --stage stage:plan-review \\
    --plan ${result.file} --findings ${JSON.stringify(findings)}`

  await agent(
    `Run exactly this command from the repository root, then report its output verbatim:

${cmd}

It publishes the plan of record, records any reviewer notes, clears a stale status report, and moves the stage label —
all of it. Do not post comments, edit labels, or run any other gh command yourself. If the command fails, report its
stderr and stop; do not improvise a recovery.`,
    { phase: 'Publish', label: `publish:#${n}`, model: 'sonnet', effort: 'low' },
  )
  return {
    number: n,
    title: result.issue.title,
    stuck: result.stuck ?? null,
    openQuestions: questions,
    checked: result.coverage?.checked ?? null,
    preexisting: result.coverage?.preexisting ?? [],
  }
}

const results = (await pipeline(issues, planTrack, publishTrack)).filter(Boolean)

return {
  repo: REPO,
  planned: results.filter((r) => !r.stuck && !r.openQuestions?.length),
  needsDecision: results.filter((r) => !r.stuck && r.openQuestions?.length),
  stuck: results.filter((r) => r.stuck),
  pullRequests,
  skipped: queue?.skipped ?? [],
}
