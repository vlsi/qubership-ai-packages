#!/usr/bin/env python3
"""Manage the issue-pipeline comments on a GitHub issue.

The plan comment is the pipeline's source of truth: it survives a clean clone, is reachable from any machine, and
carries its own last-updated timestamp. The local `plan.md` is a cache of it.

There is at most one plan comment per issue and at most one status comment. Both are updated in place rather than
appended, so an issue thread stays readable however many times the pipeline runs.

Commands:
  plan get <issue>                    print the plan body; exit 3 when the issue has no plan comment
  plan put <issue> --file PLAN        create or update the plan comment; print its URL
  status put <issue> --file REPORT    create or update the status comment; print its URL
  status clear <issue>                delete the status comment; exit 0 when there was none
  feedback <issue>                    print human comments posted after the plan was last updated
  publish <issue> ...                 one call for a whole publish step: comments, findings, and stage label
  setup                               create missing stage:* labels and git-ignore the pipeline's scratch paths
  prepare <issue> --out PLAN          one call per issue before planning: mkdir, plan cache, feedback, mode

The low-level commands stay for interactive use; `prepare`, `publish`, and `setup` are what the workflows call, so a
whole step is one invocation instead of a sequence an agent has to reassemble each run.

Options common to every command:
  --repo OWNER/NAME   defaults to the repository `gh` resolves in the working directory

Requires the `gh` CLI, authenticated. No third-party Python packages.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

PLAN_MARKER = "<!-- issue-pipeline:plan -->"
BODY_OPEN = "<!-- issue-pipeline:plan-body -->"
BODY_CLOSE = "<!-- /issue-pipeline:plan-body -->"
STATUS_MARKER = "<!-- issue-pipeline:status -->"
ANY_MARKER = "<!-- issue-pipeline:"

EXIT_NOT_FOUND = 3


def gh(args: list[str], payload: dict | None = None) -> str:
    """Run a gh command, sending `payload` as a JSON body on stdin when given."""
    kwargs: dict = {"capture_output": True, "text": True}
    if payload is not None:
        args = args + ["--input", "-"]
        kwargs["input"] = json.dumps(payload)
    done = subprocess.run(["gh"] + args, **kwargs)
    if done.returncode != 0:
        sys.exit(f"gh {' '.join(args)} failed: {done.stderr.strip()}")
    return done.stdout


def resolve_repo(repo: str | None) -> str:
    if repo:
        return repo
    return gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).strip()


def comments(repo: str, issue: int) -> list[dict]:
    raw = gh(["api", f"repos/{repo}/issues/{issue}/comments", "--paginate"])
    # --paginate concatenates one JSON array per page; splice them back together.
    out: list[dict] = []
    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(raw):
        while idx < len(raw) and raw[idx].isspace():
            idx += 1
        if idx >= len(raw):
            break
        page, end = decoder.raw_decode(raw, idx)
        out.extend(page)
        idx = end
    return out


def find(repo: str, issue: int, marker: str) -> dict | None:
    for c in comments(repo, issue):
        if marker in (c.get("body") or ""):
            return c
    return None


def upsert(repo: str, issue: int, marker: str, body: str) -> str:
    existing = find(repo, issue, marker)
    if existing:
        result = gh(["api", "-X", "PATCH", f"repos/{repo}/issues/comments/{existing['id']}"], {"body": body})
    else:
        result = gh(["api", "-X", "POST", f"repos/{repo}/issues/{issue}/comments"], {"body": body})
    return json.loads(result)["html_url"]


def read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read().strip()


def cmd_plan_get(args) -> int:
    repo = resolve_repo(args.repo)
    found = find(repo, args.issue, PLAN_MARKER)
    if not found:
        print(f"no plan comment on {repo}#{args.issue}", file=sys.stderr)
        return EXIT_NOT_FOUND
    body = found["body"]
    start, end = body.find(BODY_OPEN), body.find(BODY_CLOSE)
    if start == -1 or end == -1:
        print(f"plan comment on {repo}#{args.issue} has no body markers", file=sys.stderr)
        return EXIT_NOT_FOUND
    plan = body[start + len(BODY_OPEN) : end].strip()
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(plan + "\n")
        print(args.out)
    else:
        print(plan)
    return 0


def cmd_plan_put(args) -> int:
    repo = resolve_repo(args.repo)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    parts = [
        PLAN_MARKER,
        "**Implementation plan — produced and reviewed by the autonomous issue pipeline.**",
        "",
        f"This comment is the plan of record and is updated in place. Last updated {stamp}.",
        "",
        BODY_OPEN,
        read(args.file),
        BODY_CLOSE,
    ]
    if args.notes:
        parts += ["", "### Reviewer notes (non-blocking)", "", read(args.notes)]
    print(upsert(repo, args.issue, PLAN_MARKER, "\n".join(parts)))
    return 0


def cmd_status_put(args) -> int:
    repo = resolve_repo(args.repo)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    body = "\n".join([STATUS_MARKER, read(args.file), "", f"_Pipeline status, updated {stamp}._"])
    print(upsert(repo, args.issue, STATUS_MARKER, body))
    return 0


def cmd_status_clear(args) -> int:
    """Remove the status comment.

    A status report describes a problem that stopped the pipeline. Once the issue moves on, leaving it in place puts two
    contradictory bot reports on the same thread, so success clears it.
    """
    repo = resolve_repo(args.repo)
    found = find(repo, args.issue, STATUS_MARKER)
    if not found:
        return 0
    gh(["api", "-X", "DELETE", f"repos/{repo}/issues/comments/{found['id']}"])
    print(f"cleared status comment {found['id']}")
    return 0


def cmd_feedback(args) -> int:
    """Print human comments written after the plan was last updated.

    Anything the pipeline itself wrote is excluded by marker, and `updated_at` is the cutoff precisely because the plan
    comment is edited in place: feedback the planner already folded in moves behind the timestamp on the next update.
    """
    repo = resolve_repo(args.repo)
    plan = find(repo, args.issue, PLAN_MARKER)
    if not plan:
        print(f"no plan comment on {repo}#{args.issue}", file=sys.stderr)
        return EXIT_NOT_FOUND
    cutoff = plan["updated_at"]
    human = [
        c
        for c in comments(repo, args.issue)
        if c["created_at"] > cutoff and ANY_MARKER not in (c.get("body") or "")
    ]
    if not human:
        return EXIT_NOT_FOUND
    for c in human:
        print(f"--- {c['user']['login']} at {c['created_at']} ---")
        print((c.get("body") or "").strip())
        print()
    return 0


STAGE_LABELS = {
    "stage:plan": ("ededed", "Queued for the autonomous pipeline: waiting for a plan"),
    "stage:replan": ("ededed", "Plan rejected by a human: rework it against the feedback in the comments"),
    "stage:planning": ("a371f7", "Pipeline is planning this issue; do not edit the plan by hand"),
    "stage:plan-review": ("f9d0c4", "Plan posted; waiting for a human to approve it or send it back"),
    "stage:implement": ("d3d3d3", "Plan approved; queued for implementation"),
    "stage:working": ("a371f7", "Pipeline is implementing this issue in its own worktree"),
    "stage:testing": ("a371f7", "Pipeline is writing tests and checking documentation drift"),
    "stage:done": ("2ea043", "Pipeline opened a pull request for this issue"),
    "stage:needs-human": ("b60205", "Pipeline stopped: review did not converge or a step failed"),
    "stage:review": ("f9d0c4", "Pull request queued for review; there is nothing here to plan"),
}

IGNORE_PATHS = ["**/.claude/pipeline/runs/", "**/.claude/worktrees/"]


def cmd_setup(args) -> int:
    """Make a repository ready for the pipeline: stage labels and ignored scratch paths.

    Idempotent, and cheap enough to run at the start of every workflow — one label listing plus whatever is missing.
    """
    repo = resolve_repo(args.repo)
    existing = {line.split("\t")[0] for line in gh(["label", "list", "--repo", repo, "--limit", "200"]).splitlines()}
    created = []
    for name, (color, description) in STAGE_LABELS.items():
        if name not in existing:
            gh(["label", "create", name, "--repo", repo, "--color", color, "--description", description])
            created.append(name)

    root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    ).stdout.strip()
    ignored = []
    if root:
        exclude = os.path.join(root, ".git", "info", "exclude")
        current = ""
        if os.path.exists(exclude):
            with open(exclude, encoding="utf-8") as fh:
                current = fh.read()
        missing = [p for p in IGNORE_PATHS if p not in current]
        # A tracked .gitignore may already cover them; check before appending our own copy.
        missing = [p for p in missing if subprocess.run(
            ["git", "-C", root, "check-ignore", "-q", p.replace("**/", "")], capture_output=True
        ).returncode != 0]
        if missing:
            with open(exclude, "a", encoding="utf-8") as fh:
                if current and not current.endswith("\n"):
                    fh.write("\n")
                fh.write("\n".join(missing) + "\n")
            ignored = missing

    print(json.dumps({"repo": repo, "labelsCreated": created, "pathsIgnored": ignored}, indent=2))
    return 0


def cmd_prepare(args) -> int:
    """Everything one issue needs before planning starts, in one call.

    Replaces `mkdir -p … && plan get …; echo $?; feedback …; echo $?` and the exit-code interpretation that went with
    it: the mode comes back decided.
    """
    repo = resolve_repo(args.repo)
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)

    plan = find(repo, args.issue, PLAN_MARKER)
    has_plan = False
    if plan:
        body = plan["body"]
        start, end = body.find(BODY_OPEN), body.find(BODY_CLOSE)
        if start != -1 and end != -1:
            with open(out, "w", encoding="utf-8") as fh:
                fh.write(body[start + len(BODY_OPEN) : end].strip() + "\n")
            has_plan = True

    feedback = ""
    if plan:
        cutoff = plan["updated_at"]
        human = [
            c
            for c in comments(repo, args.issue)
            if c["created_at"] > cutoff and ANY_MARKER not in (c.get("body") or "")
        ]
        feedback = "\n\n".join(
            f"--- {c['user']['login']} at {c['created_at']} ---\n{(c.get('body') or '').strip()}" for c in human
        )

    labels = [c["name"] for c in json.loads(
        gh(["issue", "view", str(args.issue), "--repo", repo, "--json", "labels"])
    )["labels"]]

    print(json.dumps({
        "issue": args.issue,
        "repo": repo,
        "planFile": out,
        "hasPlan": has_plan,
        "mode": "replan" if (has_plan and feedback) else "plan",
        "feedback": feedback,
        "labels": labels,
        "stage": next((l for l in labels if l.startswith("stage:")), None),
    }, indent=2))
    return 0


SEVERITY_ORDER = {"blocker": 0, "major": 1, "minor": 2}


def render_findings(findings: list[dict], heading: str) -> str:
    """Render reviewer findings as Markdown, most severe first."""
    if not findings:
        return ""
    rows = sorted(findings, key=lambda f: SEVERITY_ORDER.get(f.get("severity", "minor"), 3))
    out = [f"### {heading}", ""]
    for f in rows:
        out.append(f"- **{f.get('severity', 'minor')}** — {f.get('summary', '').strip()}")
        if f.get("anchor"):
            out.append(f"  - Anchor: `{f['anchor']}`")
        if f.get("why"):
            out.append(f"  - Why: {f['why'].strip()}")
        if f.get("suggestion"):
            out.append(f"  - Suggested: {f['suggestion'].strip()}")
    return "\n".join(out)


def load_findings(raw: str | None) -> list[dict]:
    if not raw:
        return []
    text = raw.strip()
    if not text:
        return []
    # Accept either inline JSON or a path to a JSON file.
    if not text.lstrip().startswith("["):
        with open(text, encoding="utf-8") as fh:
            text = fh.read()
    parsed = json.loads(text)
    return parsed if isinstance(parsed, list) else []


def set_stage(repo: str, issue: int, label: str) -> None:
    """Move the issue to exactly one stage:* label, dropping whichever it had."""
    current = [c["name"] for c in json.loads(gh(["issue", "view", str(issue), "--repo", repo, "--json", "labels"]))["labels"]]
    flags = []
    for name in current:
        if name.startswith("stage:") and name != label:
            flags += ["--remove-label", name]
    if label not in current:
        flags += ["--add-label", label]
    if not flags:  # already exactly right; gh rejects an edit with no field flags
        return
    gh(["issue", "edit", str(issue), "--repo", repo] + flags)


def cmd_publish(args) -> int:
    """Perform an entire publish step in one call.

    The orchestrator used to spell these steps out in a prompt and hope the agent ran all of them; forgetting
    `status clear` alone left two contradictory reports on the issue. Doing it here makes the sequence deterministic.
    """
    repo = resolve_repo(args.repo)
    findings = load_findings(args.findings)
    urls = []

    if args.plan:
        notes = [f for f in findings if f.get("severity") == "minor"] if args.stuck is None else []
        body = read(args.plan)
        parts = [
            PLAN_MARKER,
            "**Implementation plan — produced and reviewed by the autonomous issue pipeline.**",
            "",
            f"This comment is the plan of record and is updated in place. Last updated "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}.",
            "",
            BODY_OPEN,
            body,
            BODY_CLOSE,
        ]
        rendered = render_findings(notes, "Reviewer notes (non-blocking)")
        if rendered:
            parts += ["", rendered]
        urls.append(upsert(repo, args.issue, PLAN_MARKER, "\n".join(parts)))

    if args.stuck:
        report = [STATUS_MARKER, f"# Pipeline stopped: {args.stuck}", ""]
        if args.detail:
            report += [read(args.detail), ""]
        rendered = render_findings(findings, "Unresolved findings")
        if rendered:
            report += [rendered, ""]
        report.append(f"_Pipeline status, updated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}._")
        urls.append(upsert(repo, args.issue, STATUS_MARKER, "\n".join(report)))
    elif args.detail:
        report = [STATUS_MARKER, read(args.detail), ""]
        # Nothing stopped the pipeline, so whatever findings came along are notes the loops chose not to act on.
        rendered = render_findings(findings, "Reviewer notes (non-blocking)")
        if rendered:
            report += [rendered, ""]
        report.append(f"_Pipeline status, updated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}._")
        urls.append(upsert(repo, args.issue, STATUS_MARKER, "\n".join(report)))
    else:
        # Success with nothing to report: a stale failure notice must not outlive the failure.
        existing = find(repo, args.issue, STATUS_MARKER)
        if existing:
            gh(["api", "-X", "DELETE", f"repos/{repo}/issues/comments/{existing['id']}"])

    if args.stage:
        set_stage(repo, args.issue, args.stage)

    for u in urls:
        print(u)
    print(f"stage={args.stage or 'unchanged'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", help="OWNER/NAME; defaults to the repository gh resolves here")
    subs = parser.add_subparsers(dest="command", required=True)

    plan = subs.add_parser("plan", help="read or upsert the plan comment").add_subparsers(dest="action", required=True)

    get = plan.add_parser("get", help="print the plan body")
    get.add_argument("issue", type=int)
    get.add_argument("--out", help="write the plan to this file instead of stdout")
    get.set_defaults(func=cmd_plan_get)

    put = plan.add_parser("put", help="create or update the plan comment")
    put.add_argument("issue", type=int)
    put.add_argument("--file", required=True, help="path to the plan Markdown")
    put.add_argument("--notes", help="path to non-blocking reviewer notes")
    put.set_defaults(func=cmd_plan_put)

    status = subs.add_parser("status", help="upsert the status comment").add_subparsers(dest="action", required=True)
    sput = status.add_parser("put", help="create or update the status comment")
    sput.add_argument("issue", type=int)
    sput.add_argument("--file", required=True, help="path to the status report Markdown")
    sput.set_defaults(func=cmd_status_put)

    sclear = status.add_parser("clear", help="delete the status comment if one exists")
    sclear.add_argument("issue", type=int)
    sclear.set_defaults(func=cmd_status_clear)

    fb = subs.add_parser("feedback", help="print human comments newer than the plan")
    fb.add_argument("issue", type=int)
    fb.set_defaults(func=cmd_feedback)

    pub = subs.add_parser("publish", help="run a whole publish step: comments, findings, and stage label")
    pub.add_argument("issue", type=int)
    pub.add_argument("--plan", help="path to the plan Markdown to publish as the plan of record")
    pub.add_argument("--findings", help="reviewer findings as inline JSON or a path to a JSON file")
    pub.add_argument("--stuck", help="short reason the pipeline stopped; omit on success")
    pub.add_argument("--detail", help="path to extra Markdown for the status comment")
    pub.add_argument("--stage", help="stage:* label the issue should end up with")
    pub.set_defaults(func=cmd_publish)

    setup = subs.add_parser("setup", help="create missing stage:* labels and ignore the pipeline's scratch paths")
    setup.set_defaults(func=cmd_setup)

    prep = subs.add_parser("prepare", help="prepare one issue for planning: cache the plan, collect feedback, pick mode")
    prep.add_argument("issue", type=int)
    prep.add_argument("--out", required=True, help="path to write the plan cache to; parent directories are created")
    prep.set_defaults(func=cmd_prepare)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
