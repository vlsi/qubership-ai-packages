export const meta = {
  name: 'issue-ship',
  description: 'Implement approved issue plans in isolated worktrees, review and test them, then open pull requests',
  whenToUse:
    'Run over issues labeled stage:implement, after a human approved the plan that issue-plan posted as a comment.',
  phases: [
    { title: 'Claim', detail: 'resolve repo and publish target, pick issues, create a worktree and branch for each' },
    { title: 'Implement', detail: 'implement the approved plan, then fix reviewer findings' },
    { title: 'Review', detail: 'adversarial review of the diff, up to maxRounds per issue' },
    { title: 'Test', detail: 'regression tests, build, and documentation drift' },
    { title: 'Publish', detail: 'push to the resolved remote and open a pull request' },
  ],
}

// `args` reaches the script however the caller passed it: an object, a JSON string, a bare number, "#867, #868".
// Normalizing here beats documenting the one correct form, because a mis-typed argument silently ships nothing.
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

  // "false"/"0"/"no" all mean a real pull request; anything else absent leaves the safe default.
  if (typeof out.draft === 'string') out.draft = !/^(false|0|no)$/i.test(out.draft.trim())
  else if (typeof out.draft !== 'boolean') out.draft = undefined
  return out
}

const A = readArgs(args)

const LIMIT = A.limit ?? 3
const MAX_ROUNDS = A.maxRounds ?? 3
const ONLY = A.issues
const DRAFT = A.draft ?? true
// The Codex leg reviews the first version of every diff, alongside the Claude reviewer. Pass `codex: false` to skip it
// on a machine where the CLI is absent or slow; the script it calls already degrades to a status the round can survive.
const CODEX = A.codex ?? true
const BUDGET_FLOOR = 400_000 // shipping an issue costs far more than planning one

const CLAIM_SCHEMA = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'owner/name of the upstream repository' },
    baseBranch: { type: 'string', description: 'the branch pull requests target, e.g. main' },
    pushRemote: { type: 'string', description: 'git remote to push branches to' },
    headPrefix: {
      type: 'string',
      description: 'prefix for gh pr create --head: "<fork-owner>:" when pushing to a fork, empty string otherwise',
    },
    publishNote: { type: 'string', description: 'how the push target was resolved' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          number: { type: 'integer' },
          title: { type: 'string' },
          branch: { type: 'string' },
          worktree: { type: 'string', description: 'absolute path of the worktree' },
          planFile: { type: 'string', description: 'absolute path of the plan file' },
          ready: { type: 'boolean', description: 'false when no approved plan could be recovered' },
          note: { type: 'string' },
        },
        required: ['number', 'title', 'branch', 'worktree', 'planFile', 'ready'],
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
      description: 'named numbers that turned out to be pull requests; they are routed, never shipped',
    },
    skipped: { type: 'array', items: { type: 'string' } },
  },
  required: ['repo', 'baseBranch', 'pushRemote', 'headPrefix', 'issues'],
  additionalProperties: false,
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    artifactMissing: {
      type: 'boolean',
      description: 'true when there is nothing to review: the diff against the base branch is empty',
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          why: { type: 'string', description: 'the concrete failure: command, input, state, or sequence' },
          suggestion: { type: 'string' },
          anchor: { type: 'string', description: 'file:line the finding applies to' },
          dependsOnPremise: {
            type: ['string', 'null'],
            description:
              'the assumption the finding rests on, in one sentence; refute it and the finding is gone. null when the finding stands on the diff alone',
          },
          history: {
            type: 'string',
            enum: ['new', 'unfixed', 'refutes_rebuttal', 'restated'],
            description:
              'new: not filed before. unfixed: filed before and neither fixed nor answered. refutes_rebuttal: filed before, rebutted, and "why" now names the mechanism that defeats the rebuttal. restated: filed before, rebutted, and no new mechanism. Omit it and the finding counts as new',
          },
        },
        required: ['severity', 'summary', 'why', 'suggestion'],
        additionalProperties: false,
      },
    },
    checkedWithoutFindings: {
      type: 'string',
      description: 'what was examined or run and found sound; the only record of coverage a human ever sees',
    },
    preexisting: {
      type: 'array',
      items: { type: 'string' },
      description: 'problems the diff sits next to but does not cause, one line each; these never block',
    },
  },
  required: ['verdict', 'findings'],
  additionalProperties: false,
}

// The Codex leg. `codex_review.py` normalizes the CLI's output into the finding shape above and reports its own status,
// so a missing Codex degrades the round to one reviewer instead of failing it.
const CODEX_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'unavailable', 'timeout', 'failed'] },
    note: { type: 'string' },
    count: { type: 'integer', description: 'the "count" the script printed, copied as-is' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          why: { type: 'string' },
          suggestion: { type: 'string' },
          anchor: { type: 'string' },
        },
        required: ['severity', 'summary', 'why', 'suggestion', 'anchor'],
        additionalProperties: false,
      },
    },
  },
  required: ['status', 'count', 'findings'],
  additionalProperties: false,
}

// Roles are loaded by prompt, not through agentType. An agentType pointing at ~/.claude/agents/ leaves the subagent
// with no tools at all — it then narrates tool calls as text and writes nothing. Verified 2026-07-25: planner and
// reviewer both came back empty-handed under agentType, while the same task ran fine without it.
const ROLE = (name) =>
  `Read ~/.claude/agents/${name}.md first (\`cat ~/.claude/agents/${name}.md\`). That file is your role definition:
follow it as your operating instructions for everything below, including its response contract.

`

const blocking = (review) => (review?.findings ?? []).filter((f) => f.severity !== 'minor')

// A blocking set made entirely of findings the reviewer itself marks `restated` is a disagreement, not a defect queue:
// the implementer rebutted them, the reviewer has no new mechanism, and every remaining round replays the same
// exchange. Handing it to a human immediately is both cheaper and the same outcome the round budget would reach.
const deadlocked = (items) => items.length > 0 && items.every((f) => f.history === 'restated')

// What the reviewer looked at and found sound, plus what it found next door. Neither belongs in the findings list —
// one blocks nothing and the other is not a finding at all — so both ride out with the result, where the human who
// picks up a stuck issue can read them.
const coverageOf = (review) => ({
  checked: review?.checkedWithoutFindings ?? null,
  preexisting: review?.preexisting ?? [],
})

// The reviewer and the tester cover different ground, and a human reading a stuck issue wants both.
const mergeCoverage = (reviewCoverage, tested) => {
  const fromTester = coverageOf(tested)
  return {
    checked: [reviewCoverage.checked, fromTester.checked].filter(Boolean).join('\n\n') || null,
    preexisting: [...reviewCoverage.preexisting, ...fromTester.preexisting],
  }
}

// ---------------------------------------------------------------- merging the two review legs

const SEVERITY_RANK = { blocker: 0, major: 1, minor: 2 }

const site = (anchor, worktree) => {
  const text = String(anchor ?? '')
    .replace(worktree + '/', '')
    .replace(/^\.\//, '')
  const m = /^([^\s:]+):(\d+)/.exec(text)
  return m ? { path: m[1], line: Number(m[2]) } : { path: text.split(':')[0], line: null }
}

// Two anchors 20 lines apart in one file are usually the same defect described twice; two in different files never
// are. The pairing only annotates — nothing is dropped on the strength of it — so a wrong guess costs a label, not a
// finding.
const samePlace = (a, b, worktree) => {
  const x = site(a.anchor, worktree)
  const y = site(b.anchor, worktree)
  if (!x.path || x.path !== y.path) return false
  return x.line === null || y.line === null || Math.abs(x.line - y.line) <= 20
}

// Agreement between two reviewers who never saw each other's output is the one signal neither can produce alone, so it
// travels with the finding into the fix prompt.
const mergeLegs = (claudeFindings, codexFindings, worktree) => {
  const corroborated = new Set()
  const fromCodex = codexFindings.map((c) => {
    const hit = claudeFindings.find((f) => samePlace(f, c, worktree))
    if (hit) corroborated.add(hit)
    return { ...c, history: 'new', reviewer: 'codex', agreement: hit ? 'both' : 'codex' }
  })
  return [
    ...claudeFindings.map((f) => ({ ...f, reviewer: 'claude', agreement: corroborated.has(f) ? 'both' : 'claude' })),
    ...fromCodex,
  ].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3))
}

// ---------------------------------------------------------------- claim

phase('Claim')

log(
  ONLY
    ? `Shipping only ${ONLY.map((n) => '#' + n).join(', ')} (${DRAFT ? 'draft' : 'ready'} PR, max ${MAX_ROUNDS} rounds)`
    : `Draining the implement queue, up to ${LIMIT} issues (${DRAFT ? 'draft' : 'ready'} PR)`,
)

const claimPrompt = `You are claiming GitHub issues for an autonomous implementation pipeline, and preparing a worktree
for each one.

First resolve where this pipeline publishes. Read .claude/issue-pipeline.md if it exists — an explicit publishing rule
there wins over everything below. Otherwise:

1. \`gh repo view --json nameWithOwner,defaultBranchRef\` gives "repo" and "baseBranch".
2. \`gh api user -q .login\` gives your login. Look through \`git remote -v\` for a remote whose owner is that login
   and whose repository is a fork of the upstream. If one exists, that is "pushRemote", and "headPrefix" is that
   owner followed by a colon.
3. If no fork remote exists, push to the remote that tracks the upstream (usually origin) and set "headPrefix" to an
   empty string.

Record how you decided in "publishNote". Never treat a remote as a fork without checking its owner.

${
  ONLY
    ? `Then work on exactly these numbers, in this order: ${ONLY.join(', ')}.

Issues and pull requests share one numbering space, so classify every number before you touch it. This read is safe to
do first:
  gh issue view <N> --json number,title,url

A url containing /pull/ means the number is a pull request. A pull request is code that already exists: it has no plan
to ship, so it belongs in the review queue instead. After the setup step below has created the stage:* labels, move it
there:
  gh pr edit <N> --add-label stage:review \\
    --remove-label stage:implement --remove-label stage:working --remove-label stage:testing \\
    --remove-label stage:needs-human

Report each one under "pullRequests" with the note "moved to stage:review", and leave it out of "issues". Do not run
prepare on it, do not claim it as stage:working, and do not create a branch or a worktree for it. A pull request
already carrying stage:review is the same case: report it, change nothing.

Naming an issue explicitly is the user's intent, so accept both stage:implement and stage:needs-human. A
stage:needs-human issue that already has a worktree and commits is a stalled implementation: reuse them and let the
review and test stages run again over what is there.

Unlike planning, shipping is never implied by naming an issue: the whole point of the gate is that a human approved
the plan, and stage:implement is how that approval is expressed. Skip an issue in these cases, each with the reason
under "skipped":

- It carries stage:working or stage:testing — another run owns it right now.
- It carries stage:plan, stage:replan, or stage:plan-review, or it has no stage:* label at all. Its plan is not
  approved, and shipping it would defeat the human gate. Say whether the issue has a plan comment yet: if it does, the
  user only needs to label it stage:implement; if it does not, it needs issue-plan first.
- It is closed.`
    : `Then list open issues labeled stage:implement:
  gh issue list --state open --label stage:implement --limit 100 --json number,title,labels

Order them by priority label: priority:critical, then priority:high, then priority:medium, then priority:low, then
issues with no priority label. Break ties by the lower issue number. Take the first ${LIMIT}.`
}

Whatever brought an issue this far, drop it when a pull request is already open against it. One call lists them all:

  gh pr list --state open --limit 200 --json number,url,headRefName,closingIssuesReferences

An issue belongs to an open pull request when that pull request lists it under closingIssuesReferences, or when its
headRefName is issue-<N>-* — the branch name this pipeline gives its own work. Report it under "skipped" naming the
pull request, and claim nothing. The publish stage of this pipeline runs \`gh pr create\`, so a second run either dies
on the duplicate branch or opens a second pull request for one issue. A draft counts the same as a ready one.

The two cases differ in what the user does next, so say which one you found:

- the branch is issue-<N>-*, so this pipeline already shipped the work. Further changes belong in that pull request —
  the worktree at .claude/worktrees/issue-<N> is still in place, and a push to the same branch updates the pull
  request.
- the branch is anything else, so a human is working on the issue by hand. Their pull request wins until they close it
  or say otherwise.

For each issue you take:

1. Claim it so a parallel run cannot pick it up:
     gh issue edit <N> --remove-label stage:implement --remove-label stage:needs-human --add-label stage:working

2. Recover the approved plan from the plan comment, which is the plan of record, with one command:
     python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py prepare <N> \\
       --out .claude/pipeline/runs/issue-<N>/plan.md

   It creates the run directory and refreshes the cache from the comment even when plan.md already exists, because the
   local copy may be stale or from another machine. Read "hasPlan" from its JSON: false means the issue has no plan
   comment, so set "ready" to false with an explanatory "note". Never invent a plan, and never fall back to a local
   file the command did not write.

3. Create the branch and worktree from a fresh base:
     git fetch <pushRemote-or-origin> <baseBranch>
     git worktree add .claude/worktrees/issue-<N> -b issue-<N>-<slug> origin/<baseBranch>
   The slug is a kebab-case summary of the title, at most five words, lowercase, ASCII only. If the branch or worktree
   already exists from an earlier run, reuse it instead of failing, and say so in "note".

Before claiming anything, run \`python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py setup\` once: it
creates any missing stage:* labels and git-ignores the pipeline's scratch paths, and is a no-op when they exist.

Return "worktree" and "planFile" as absolute paths: run \`pwd\` once from the repository root and join it with the
relative paths above. Later stages run with a different working directory, so relative paths there would break.

Do not read the plan in depth, do not change any product file, and do not comment on the issue.`

const claim = await agent(claimPrompt, { schema: CLAIM_SCHEMA, label: 'claim', effort: 'low' })

const REPO = claim?.repo
const BASE = claim?.baseBranch
const PUSH_REMOTE = claim?.pushRemote
const HEAD_PREFIX = claim?.headPrefix ?? ''

let tracks = (claim?.issues ?? []).filter((i) => i.ready)
const notReady = (claim?.issues ?? []).filter((i) => !i.ready)
const pullRequests = claim?.pullRequests ?? []

if (pullRequests.length) {
  log(`Not shipping ${pullRequests.map((p) => '#' + p.number).join(', ')}: pull requests, moved to stage:review`)
}

if (budget.total) {
  const affordable = Math.max(1, Math.floor(budget.remaining() / BUDGET_FLOOR))
  if (tracks.length > affordable) {
    log(`Token budget allows ${affordable} of ${tracks.length} claimed issues; the rest stay in stage:working`)
    tracks = tracks.slice(0, affordable)
  }
}

if (!REPO || !tracks.length) {
  log(
    !REPO
      ? 'Could not resolve the repository'
      : ONLY
        ? `Nothing to ship: ${ONLY.map((n) => '#' + n).join(', ')} were routed, skipped, or had no approved plan`
        : 'No issues in the stage:implement queue are ready to ship',
  )
  return { shipped: [], stuck: notReady, pullRequests, skipped: claim?.skipped ?? [], requested: ONLY ?? null }
}

log(`Shipping ${tracks.map((t) => '#' + t.number).join(', ')} in ${REPO} (${claim?.publishNote ?? 'no publish note'})`)

// ---------------------------------------------------------------- one issue, end to end

const context = (t) =>
  `Repository: ${REPO}
Issue #${t.number}: "${t.title}".
Worktree: ${t.worktree}
Branch: ${t.branch}
Base branch: origin/${BASE}
Plan file: ${t.planFile}`

// One `codex exec review` over the same diff the Claude reviewer reads. The script writes its result next to the plan
// and prints it, so the agent here only relays it — it never reviews anything itself.
const codexLeg = (t) => {
  const out = t.planFile.replace(/\/plan\.md$/, '/codex-findings.json')
  return agent(
    `Run exactly this command, giving the Bash call a 600000 ms timeout because the review can take several minutes:

python3 ~/.claude/skills/issue-pipeline/scripts/codex_review.py \\
  --worktree ${t.worktree} --base origin/${BASE} --out ${out} --title ${JSON.stringify(`issue-ship #${t.number}`)}

It prints one line of JSON and writes the same JSON to ${out}. Return that JSON as your structured output, copying
"status", "note", "count", and every finding field for field.

Do not review the code yourself, do not add, merge, reword, drop, or reorder a finding, and do not re-run the command
when it reports a status other than "ok" — that status is the answer, and the workflow knows what to do with it.`,
    { phase: 'Review', label: `codex:#${t.number}`, schema: CODEX_SCHEMA, model: 'sonnet', effort: 'low' },
  )
}

const shipTrack = async (t) => {
  const n = t.number
  const fail = (why, findings, coverage) => ({ track: t, stuck: why, findings: findings ?? [], coverage: coverage ?? null })

  // --- implement -------------------------------------------------
  const built = await agent(
    ROLE('issue-implementer') +
      `${context(t)}

Mode: implement. Implement the plan's Change section inside the worktree.`,
    { phase: 'Implement', label: `implement:#${n}` },
  )
  if (built === null) return fail('the implementer failed')

  // --- code review loop ------------------------------------------
  let review = null
  let converged = false
  let fixReport = null

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const prev = review
    const reviewLeg = () =>
      agent(
        ROLE('issue-reviewer') +
          `${context(t)}

Review mode: implementation. Round ${round} of ${MAX_ROUNDS}.
Read the diff with: git -C ${t.worktree} diff origin/${BASE}...HEAD
If that diff is empty, the implementer committed nothing: set "artifactMissing" to true and return a single blocker
saying so. The orchestrator stops on that flag rather than spending the remaining rounds reviewing nothing.
${
  prev
    ? `
Your findings from the previous round were:
${JSON.stringify(prev.findings ?? [], null, 2)}

This is what the implementer reported back. Treat it as claims, not facts — check each one against the diff, and look
for defects the fix itself introduced:

--- implementer's report ---
${(fixReport ?? '(the implementer returned no report)').slice(0, 4000)}
--- end implementer's report ---

Set "history" on every finding you keep. A rebuttal you cannot defeat with a mechanism makes the finding "restated",
not "refutes_rebuttal": the workflow stops on a set of restated blockers and hands the disagreement to a human, which
is what a deadlock deserves.`
    : ''
}`,
        { phase: 'Review', label: `review:#${n} r${round}`, schema: REVIEW_SCHEMA },
      )

    // Codex looks once, at the first version of the diff, and whatever it finds then travels through the same fix loop
    // as everything else. Re-running it every round would need the rejection ledger this workflow deliberately does not
    // keep, so a later round would re-file what the implementer already rebutted.
    const legs = round === 1 && CODEX ? await parallel([reviewLeg, () => codexLeg(t)]) : [await reviewLeg(), null]

    review = legs[0]
    const codex = legs[1]

    if (review === null) return fail('the reviewer failed')

    // Nothing was committed: name the implementer as the failure instead of burning the budget on an empty diff.
    if (review.artifactMissing) {
      log(`#${n}: the implementer committed nothing; stopping instead of reviewing an empty diff`)
      return fail(`the implementer committed nothing to ${t.branch}`, review.findings, coverageOf(review))
    }

    if (codex && codex.status !== 'ok') {
      log(`#${n}: the Codex leg did not run (${codex.status}${codex.note ? `: ${codex.note}` : ''}); one reviewer only`)
    } else if (codex) {
      const relayed = codex.findings ?? []
      // The script's own count against what reached us: the JSON crossed an agent boundary to get here.
      if (codex.count !== relayed.length) {
        log(`#${n}: the Codex leg found ${codex.count} finding(s) but relayed ${relayed.length}`)
      }
      const merged = mergeLegs(review.findings ?? [], relayed, t.worktree)
      const agreed = merged.filter((f) => f.reviewer === 'codex' && f.agreement === 'both').length
      log(`#${n}: Codex returned ${relayed.length} finding(s), ${agreed} of them where the reviewer looked too`)
      review = { ...review, findings: merged }
    }

    const blockers = blocking(review)

    if (!blockers.length) {
      log(`#${n}: implementation approved in round ${round}`)
      converged = true
      break
    }

    if (deadlocked(blockers)) {
      log(`#${n}: every blocking finding is a restatement the implementer already rebutted; stopping at round ${round}`)
      return fail(
        `reviewer and implementer deadlocked on ${blockers.length} finding(s) in round ${round}: restated without new evidence`,
        review.findings,
        coverageOf(review),
      )
    }

    if (round === MAX_ROUNDS) break

    const fixed = await agent(
      ROLE('issue-implementer') +
        `${context(t)}

Mode: fix. Round ${round} of ${MAX_ROUNDS}. Reviewer findings:
${JSON.stringify(review.findings, null, 2)}${
          codex && codex.status === 'ok'
            ? `

Two reviewers looked at this diff independently. "agreement": "both" means they landed on the same place without
seeing each other's work; "reviewer": "codex" findings carry no premise and no suggested remedy, so weigh them on the
mechanism in "why" alone.`
            : ''
        }`,
      { phase: 'Implement', label: `fix:#${n} r${round}` },
    )
    if (fixed === null) return fail('the implementer failed while fixing review findings', review.findings, coverageOf(review))
    fixReport = fixed
  }

  if (!converged)
    return fail(`code review did not converge in ${MAX_ROUNDS} rounds`, review?.findings, coverageOf(review))

  const reviewNotes = (review?.findings ?? []).filter((f) => f.severity === 'minor')
  const reviewCoverage = coverageOf(review)

  // --- test and documentation loop -------------------------------
  let tested = null
  let green = false

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    tested = await agent(
      ROLE('issue-tester') +
        `${context(t)}

Round ${round} of ${MAX_ROUNDS}.
${
  round === 1
    ? `Before you start, move the stage label:
  gh issue edit ${n} --repo ${REPO} --remove-label stage:working --add-label stage:testing

Then write the regression test, run the checks, and reconcile the documentation.`
    : `The implementer has addressed your previous findings:
${JSON.stringify(tested?.findings ?? [], null, 2)}

Re-run the checks and re-verify. Do not move any label this round.`
}`,
      { phase: 'Test', label: `test:#${n} r${round}`, schema: REVIEW_SCHEMA },
    )
    if (tested === null) return fail('the tester failed', [], reviewCoverage)

    if (!blocking(tested).length) {
      log(`#${n}: tests and docs green in round ${round}`)
      green = true
      break
    }

    if (round === MAX_ROUNDS) break

    const repaired = await agent(
      ROLE('issue-implementer') +
        `${context(t)}

Mode: fix. Round ${round} of ${MAX_ROUNDS}. The tester reported build or test failures:
${JSON.stringify(tested.findings, null, 2)}

Fix the product code. Do not weaken or skip the tests.`,
      { phase: 'Implement', label: `repair:#${n} r${round}` },
    )
    if (repaired === null)
      return fail('the implementer failed while fixing test findings', tested.findings, mergeCoverage(reviewCoverage, tested))
  }

  if (!green)
    return fail(`tests did not go green in ${MAX_ROUNDS} rounds`, tested?.findings, mergeCoverage(reviewCoverage, tested))

  return {
    track: t,
    notes: [...reviewNotes, ...(tested?.findings ?? []).filter((f) => f.severity === 'minor')],
    coverage: mergeCoverage(reviewCoverage, tested),
  }
}

// ---------------------------------------------------------------- publish

const publishTrack = async (r) => {
  if (!r) return null
  const t = r.track
  const n = t.number

  // A stuck track carries its unresolved findings; a shipped one carries the minor notes neither loop had to act on.
  const findings = JSON.stringify(r.findings ?? r.notes ?? [])
  const coverage = r.coverage ?? { checked: null, preexisting: [] }
  // --repo is a global option of the tool: after the subcommand argparse rejects the whole call.
  const publishCmd = (stage, extra) =>
    `python3 ~/.claude/skills/issue-pipeline/scripts/pipeline_comment.py --repo ${REPO} publish ${n} \\
    --stage ${stage} --findings ${JSON.stringify(findings)}${extra}`

  const prompt = r.stuck
    ? `Issue #${n} of ${REPO} could not be shipped: ${r.stuck}.

1. Write a short report to <file>: what happened, and what is left in the worktree ${t.worktree} on branch
   ${t.branch}. Summarize the commits with: git -C ${t.worktree} log --oneline origin/${BASE}..HEAD
${
  coverage.checked
    ? `
   Close the report with a "What was checked" section, copying this verbatim — it is the only account of coverage the
   human picking this up will get:

   ${coverage.checked.replace(/\n/g, '\n   ')}
`
    : ''
}${
      coverage.preexisting.length
        ? `
   Then a "Pre-existing, not caused by this change" list, one item per line, copied verbatim:

${coverage.preexisting.map((p) => `   - ${p}`).join('\n')}
`
        : ''
    }

2. Publish it and move the label with one command:
     ${publishCmd('stage:needs-human', ` --stuck ${JSON.stringify(r.stuck)} --detail <file>`)}

Do not push anything. Do not open a pull request. Do not edit labels yourself.`
    : `Issue #${n} of ${REPO} is implemented, reviewed, and green. Publish it.

1. Push the branch to the resolved remote:
     git -C ${t.worktree} push -u ${PUSH_REMOTE} ${t.branch}

2. Write the pull request body to a file. This is the one part that needs judgment: read the plan at ${t.planFile} and
   the diff (git -C ${t.worktree} diff origin/${BASE}...HEAD), then write three sections — Why (the problem from the
   issue), What (the change), How to verify (the commands and test names that prove it). Put "Fixes #${n}" on its own
   line. Say the branch was produced by the autonomous pipeline${DRAFT ? ' and is opened as a draft for human review' : ''}.

3. Open the pull request:
     gh pr create --repo ${REPO} --head ${HEAD_PREFIX}${t.branch} --base ${BASE}${DRAFT ? ' --draft' : ''} \\
       --title "<conventional-commit style title>" --body-file <body-file>

4. Write a two-line status note naming the pull request URL and the branch, then record it and move the label with one
   command:
     ${publishCmd('stage:done', ' --detail <status-file>')}

Push only to ${PUSH_REMOTE}. Never merge the pull request. Leave the worktree in place. Do not touch the plan comment
and do not edit labels yourself — step 4 does both.`

  await agent(prompt, { phase: 'Publish', label: `publish:#${n}`, model: 'sonnet' })
  return {
    number: n,
    title: t.title,
    branch: t.branch,
    stuck: r.stuck ?? null,
    checked: coverage.checked,
    preexisting: coverage.preexisting,
  }
}

const results = (await pipeline(tracks, shipTrack, publishTrack)).filter(Boolean)

return {
  repo: REPO,
  publishNote: claim?.publishNote ?? null,
  shipped: results.filter((r) => !r.stuck),
  stuck: results.filter((r) => r.stuck),
  notReady,
  pullRequests,
  skipped: claim?.skipped ?? [],
}
