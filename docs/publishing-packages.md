# Publishing packages

This repository is an APM marketplace. The index is the `marketplace:` block in the root `apm.yml`, compiled to `.claude-plugin/marketplace.json` by `apm pack`. Both files are committed.

There are two kinds of work, and they stay separate:

- **Authoring** — add or update a package. You do this through a pull request, and your steps end at merge. The rest of this guide, except the last section, is for authors.
- **Releasing the marketplace** — cut the tag `vX.Y.Z` that consumers pin. This is automated; see [Releasing the marketplace](#releasing-the-marketplace). Authors never run it.

A package reaches the marketplace in one of two ways:

- **In this repository** — the package lives under `agent-packages/<name>/` and is listed as a local-path entry. Use this for packages this team owns.
- **In another repository** — the package lives and is released elsewhere; the marketplace holds only a remote entry that points at it. Use this to curate packages other repositories own.

## Conventions in this repository

- `.claude-plugin/marketplace.json` is generated, never hand-edited. Regenerate it with `apm pack` and commit the result.
- Local-path packages live one per directory under `agent-packages/<name>/`, each with its own `apm.yml` and `.apm/` source tree.
- Remote entries pin a tag or commit SHA, never a branch — `apm pack` rejects a mutable branch ref.
- Every change lands through a pull request.

## Prerequisites

- APM 0.16.0 or newer (`apm --version`, `apm self-update`).
- `gh` authenticated, for opening pull requests.

## Add a package that lives in this repository

1. Create the package under `agent-packages/<name>/`. At minimum it needs an `apm.yml` (`name`, `version`, `description`) and an `.apm/` tree with your primitives. The layout is described in [the APM package anatomy](https://microsoft.github.io/apm/concepts/package-anatomy/).

   ```text
   agent-packages/<name>/
     apm.yml
     .apm/
       skills/<name>/SKILL.md
       instructions/<name>.instructions.md
   ```

2. Add a local-path entry to the root `apm.yml` `marketplace:` block:

   ```yaml
   marketplace:
     packages:
       - name: <name>
         description: <one-line summary that consumers see>
         source: ./agent-packages/<name>
         version: <semver, matching the package's own apm.yml>
   ```

3. Regenerate the index:

   ```bash
   apm pack   # writes .claude-plugin/marketplace.json
   ```

4. Open a pull request with three things: the new `agent-packages/<name>/` tree, the updated root `apm.yml`, and the regenerated `.claude-plugin/marketplace.json`.

Once merged, the package is on `main`. It reaches consumers who pin a tag at the next [marketplace release](#releasing-the-marketplace).

## Add a package from another repository

The package is developed and released in its own repository (`owner/repo`). Here you add only a pointer; no package files land in this repository.

1. Pick the release to publish: a tag (or commit SHA) in `owner/repo`. A branch ref does not work — `apm pack` rejects it as mutable.

2. Add a remote entry to the root `apm.yml` `marketplace:` block:

   ```yaml
   marketplace:
     packages:
       - name: <name>
         description: <one-line summary that consumers see>
         source: <owner>/<repo>
         # subdir: <path/in/repo>   # only when the package sits in a subdirectory
         ref: v<X.Y.Z>             # a tag or commit SHA in <owner>/<repo>
   ```

3. Regenerate the index. `apm pack` resolves the remote ref through `git ls-remote`, so it needs network and read access to `owner/repo`:

   ```bash
   apm pack
   ```

4. Open a pull request with the updated `apm.yml` and the regenerated `.claude-plugin/marketplace.json` — no package source.

## Update a package

**A package in this repository.** Bump `version:` in `agent-packages/<name>/apm.yml` and the matching `version:` in the marketplace entry, regenerate, and open a pull request:

```bash
apm pack
```

**A package from another repository.** Find entries whose upstream has a newer matching tag, move the pointer, regenerate, and open a pull request:

```bash
apm marketplace outdated   # lists entries with newer upstream tags
# bump the entry's ref: (or version:) to the new upstream tag, then:
apm pack
```

## Validate before you open a pull request

```bash
apm pack --check-versions --check-clean --dry-run
```

This checks two things without writing to disk: every package declares a version consistent with `marketplace.versioning.strategy` (`--check-versions`), and the committed `.claude-plugin/marketplace.json` matches what `apm.yml` would produce (`--check-clean`). The `--dry-run` flag is required: without it, `apm pack` rewrites `marketplace.json` first, so the drift check always passes. The same run resolves every remote entry's ref, so a missing tag, a typo, or a mutable branch fails the gate.

CI runs the same command on every pull request — see [`.github/workflows/marketplace.yml`](../.github/workflows/marketplace.yml). Do not use `apm marketplace check` as the gate here: it probes entries as git remotes and reports local-path entries as unreachable.

## What to commit

- A package in this repository: `agent-packages/<name>/` (the source), `apm.yml` (the entry), and `.claude-plugin/marketplace.json`.
- A package from another repository: `apm.yml` (the entry) and `.claude-plugin/marketplace.json` — no package source.

Keep `.claude-plugin/marketplace.json` tracked: if `*.json` is gitignored, add `!.claude-plugin/marketplace.json`.

## Releasing the marketplace

A marketplace release is a git tag `vX.Y.Z`. Consumers pin it (`apm marketplace add … --ref vX.Y.Z`), so the tag — not a merge to `main` — is what ships authored changes to pinned consumers.

Releasing is automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml). Pushing a tag runs the workflow, which validates the index with `apm pack --check-versions --check-clean --dry-run` and publishes a GitHub Release carrying `marketplace.json` and its SHA-256 checksum. Package authors do not run any of this.

To cut a release, a maintainer pushes a tag from a green `main`:

```bash
git switch main && git pull
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

The tag must point at a commit whose `.claude-plugin/marketplace.json` is in sync; the release workflow fails closed otherwise.

## Reference

- [Publish to a marketplace](https://microsoft.github.io/apm/producer/publish-to-a-marketplace/) — the authoring surface and the registry schema.
- [Repo shapes](https://microsoft.github.io/apm/producer/repo-shapes/) — single-plugin, aggregator, and monorepo-hybrid layouts.
- [Releasing from any CI](https://microsoft.github.io/apm/producer/releasing-from-any-ci/) — the release recipe this repository's `release` workflow is built on.
