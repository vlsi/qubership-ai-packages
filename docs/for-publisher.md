# Publisher guide

This repository is an APM marketplace. Each package lives under `agent-packages/<name>/`; the index is the `marketplace:` block in the root `apm.yml`, compiled to `.claude-plugin/marketplace.json` by `apm pack`. Both files are committed. Releases are git tags (`vX.Y.Z`) that consumers pin.

## Conventions in this repository

- One package per directory under `agent-packages/<name>/`, each with its own `apm.yml` and `.apm/` source tree.
- Packages are listed in the root `apm.yml` `marketplace:` block as local-path entries (`source: ./agent-packages/<name>`).
- `.claude-plugin/marketplace.json` is generated, never hand-edited. Regenerate it with `apm pack` and commit the result.
- Every change lands through a pull request. A maintainer cuts the release tag after merge.

## Prerequisites

- APM 0.16.0 or newer (`apm --version`, `apm self-update`).
- `gh` authenticated, for opening pull requests.

## Publish a new package

1. Create the package under `agent-packages/<name>/`. At minimum it needs an `apm.yml` (`name`, `version`, `description`) and an `.apm/` tree with your primitives. The layout is described in [the APM package anatomy](https://microsoft.github.io/apm/concepts/package-anatomy/).

   ```text
   agent-packages/<name>/
     apm.yml
     .apm/
       skills/<name>/SKILL.md
       instructions/<name>.instructions.md
   ```

2. Add the package to the root `apm.yml` `marketplace:` block:

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

5. After merge, a maintainer cuts the release:

   ```bash
   git tag v<X.Y.Z>
   git push origin v<X.Y.Z>
   ```

## Release a new version of a package

1. Bump `version:` in `agent-packages/<name>/apm.yml`.
2. Bump the matching `version:` in the root `apm.yml` marketplace entry.
3. Regenerate the index and open a pull request:

   ```bash
   apm pack
   ```

4. After merge, cut a new repository tag (`v<X.Y.Z>`).

Consumers move forward by re-registering at the new tag; see [the consumer guide](./for-consumer.md).

## Validate before you open a pull request

```bash
apm pack --check-versions --check-clean --dry-run
```

This checks two things without writing to disk: every package declares a version consistent with `marketplace.versioning.strategy` (`--check-versions`), and the committed `.claude-plugin/marketplace.json` matches what `apm.yml` would produce (`--check-clean`). The `--dry-run` flag is required: without it, `apm pack` rewrites `marketplace.json` first, so the drift check always passes.

CI runs the same command on every pull request — see [`.github/workflows/marketplace.yml`](../.github/workflows/marketplace.yml). Do not use `apm marketplace check` as the gate here: it probes entries as git remotes and reports local-path entries as unreachable.

## What to commit

- `agent-packages/<name>/` — the package source.
- `apm.yml` — the marketplace index (the `marketplace:` block).
- `.claude-plugin/marketplace.json` — the generated artifact. Keep it tracked: if `*.json` is gitignored, add `!.claude-plugin/marketplace.json`.

## Reference

- [Publish to a marketplace](https://microsoft.github.io/apm/producer/publish-to-a-marketplace/) — the authoring surface and the registry schema.
- [Releasing from any CI](https://microsoft.github.io/apm/producer/releasing-from-any-ci/) — release gates and the `microsoft/apm-action` wrapper for tag-driven releases.
