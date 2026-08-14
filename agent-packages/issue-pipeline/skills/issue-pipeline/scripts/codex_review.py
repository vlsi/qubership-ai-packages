#!/usr/bin/env python3
"""Run the Codex CLI as a second, independent reviewer for one implementation diff.

`issue-ship` reviews code no human has read yet, which is where an independent second opinion earns its cost: two
reviewers who never saw each other's output agreeing on a finding is a signal neither one can produce alone.

The script is the whole Codex leg. It runs the review, normalizes the result into the finding shape the workflow's
schema already uses, and reports a status the caller can act on. A missing Codex, a sandbox refusal, and a timeout all
come back as an ordinary result with `status` set, never as a non-zero exit — the workflow degrades to the single
reviewer instead of failing the round.

Codex stream parsing lives in the cross-review skill, which is where it is maintained against the CLI. This script
imports it rather than keeping a second copy that ages separately.

Usage:

    python3 codex_review.py --worktree <abs-path> --base origin/main \\
        --out .claude/pipeline/runs/issue-<N>/codex/findings.json
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

CROSS_REVIEW_SCRIPTS = Path.home() / ".claude" / "skills" / "cross-review" / "scripts"

PRIORITY_PREFIX = re.compile(r"^\[P\d\]\s*")


def load_cross_review():
    """Import the cross-review helpers, or return None when that skill is not installed."""
    if not (CROSS_REVIEW_SCRIPTS / "review_run.py").exists():
        return None
    sys.path.insert(0, str(CROSS_REVIEW_SCRIPTS))
    import review_run  # noqa: PLC0415 — the path has to be set up first

    return review_run


def emit(out: Path, payload: dict) -> int:
    """Write the result to `out`, print it, and exit 0 whatever happened."""
    text = json.dumps(payload, ensure_ascii=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8")
    sys.stdout.write(text + "\n")
    return 0


def anchor_of(rel: str, start, end) -> str:
    if not rel:
        return ""
    if start is None:
        return rel
    if end is None or end == start:
        return f"{rel}:{start}"
    return f"{rel}:{start}-{end}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--worktree", required=True, help="absolute path of the worktree holding the branch under review")
    ap.add_argument("--base", required=True, help="ref the diff is measured against, for example origin/main")
    ap.add_argument("--out", required=True, help="where to write the normalized findings")
    ap.add_argument("--title", default="issue-ship review", help="review title Codex records with the session")
    ap.add_argument(
        "--timeout",
        type=int,
        default=540,
        help="seconds to give Codex; the default stays under the 10-minute ceiling on a foreground Bash tool call",
    )
    a = ap.parse_args()

    out = Path(a.out)
    work = out.parent
    repo = Path(a.worktree)

    if not repo.is_dir():
        return emit(out, {"status": "failed", "note": f"no worktree at {repo}", "count": 0, "findings": []})
    if shutil.which("codex") is None:
        return emit(out, {"status": "unavailable", "note": "codex is not on PATH", "count": 0, "findings": []})

    cross = load_cross_review()
    if cross is None:
        return emit(
            out,
            {
                "status": "unavailable",
                "note": "the cross-review skill is not installed, and it owns the Codex stream reader",
                "count": 0,
                "findings": [],
            },
        )

    work.mkdir(parents=True, exist_ok=True)
    stream = work / "codex.jsonl"
    stderr_file = work / "codex.stderr"
    cmd = [
        "codex", "exec", "-C", str(repo), "--json",
        "review", "--base", a.base, "--title", a.title,
        "-o", str(work / "codex.last.md"),
    ]

    with stream.open("wb") as so, stderr_file.open("wb") as se:
        try:
            code = subprocess.run(cmd, stdout=so, stderr=se, timeout=a.timeout, check=False).returncode
        except subprocess.TimeoutExpired:
            return emit(
                out,
                {"status": "timeout", "note": f"codex did not finish within {a.timeout}s", "count": 0, "findings": []},
            )
        except OSError as exc:
            return emit(out, {"status": "failed", "note": f"could not run codex: {exc}", "count": 0, "findings": []})

    session_id, review_output = cross.scan_codex_stream(stream)
    if review_output is None and session_id:
        # The payload sometimes reaches only the rollout file. Reading it is the difference between a review that
        # happened and a review the caller records as failed.
        rollout = cross.find_rollout(session_id)
        if rollout:
            _, review_output = cross.scan_codex_stream(rollout)

    if review_output is None:
        stderr_text = stderr_file.read_text("utf-8", "replace") if stderr_file.exists() else ""
        hit = next((s for s in cross.SANDBOX_SIGNATURES if s in stderr_text), None)
        note = (
            f"codex reported a sandbox problem ({hit})"
            if hit
            else f"codex exited {code} without a review payload: {stderr_text.strip()[-300:] or 'no stderr'}"
        )
        return emit(out, {"status": "failed", "note": note, "count": 0, "findings": []})

    findings = []
    for f in review_output.get("findings") or []:
        location = f.get("code_location") or {}
        line_range = location.get("line_range") or {}
        rel = cross.relativize(location.get("absolute_file_path") or "", repo)
        findings.append(
            {
                "severity": cross.CODEX_PRIORITY_TO_SEVERITY.get(f.get("priority"), "major"),
                "summary": PRIORITY_PREFIX.sub("", f.get("title") or "").strip(),
                "why": (f.get("body") or "").strip(),
                # Codex reports one body per finding and no separate remedy, so the suggestion stays empty rather than
                # repeating the same text under a second heading.
                "suggestion": "",
                "anchor": anchor_of(rel, line_range.get("start"), line_range.get("end")),
                "history": "new",
                "dependsOnPremise": None,
            }
        )

    return emit(
        out,
        {
            "status": "ok",
            "note": (review_output.get("overall_explanation") or "").strip()[:600],
            "count": len(findings),
            "findings": findings,
        },
    )


if __name__ == "__main__":
    sys.exit(main())
