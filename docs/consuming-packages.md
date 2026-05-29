# Consuming packages

This repository, `Netcracker/qubership-ai-packages`, publishes an APM marketplace: a curated index of agent packages (skills, instructions, agents, and umbrella packages) that you install with the `apm` CLI. Register the marketplace once, then install packages by name.

> Testing against a fork? Replace `Netcracker/qubership-ai-packages` with your fork, for example `vlsi/qubership-ai-packages`.

## Prerequisites

- APM 0.16.0 or newer. Check with `apm --version`; upgrade with `apm self-update`. Install steps are in [the APM installation guide](https://microsoft.github.io/apm/getting-started/installation/).
- Network access to `github.com`. The marketplace index and every package are fetched over git.

<!-- group doccmd[verify]: start -->

## Register the marketplace

```bash
apm marketplace add Netcracker/qubership-ai-packages --ref v0.1.0
```

`--ref` pins the whole marketplace, and every package in it, to a release tag, so every machine and CI run resolves the same bytes. Omit `--ref` to track `main` and always resolve the latest (`apm marketplace add Netcracker/qubership-ai-packages`).

Confirm the registration:

```bash
apm marketplace list
```

## Find a package

```bash
apm marketplace browse qubership-ai-packages
apm search authoring@qubership-ai-packages
```

`apm list` does not list packages — it lists the `scripts:` in your own `apm.yml`. Use `browse` or `search` to explore the marketplace, and `apm deps list` to see what you have installed.

## Install a package

```bash
apm install apm-authoring@qubership-ai-packages
```

The install deploys the package's primitives (skills, instructions, and the rest) into your agent harness folders (`.github/`, `.claude/`, `.cursor/`, and so on), records the resolved commit and content hash in `apm.lock.yaml`, and adds the dependency to `apm.yml`. Commit both `apm.yml` and `apm.lock.yaml` so the install reproduces on every machine.

Inspect what you installed:

```bash
apm deps list
apm deps tree
```

`apm deps list` shows per-package primitive counts; `apm deps tree` shows the full graph, including transitive dependencies. Umbrella packages such as `go-microservice-dev-kit` pull in other packages, which the tree lists.

## Remove a package

```bash
apm uninstall apm-authoring@qubership-ai-packages
```

This removes the package from `apm.yml` and `apm.lock.yaml`, deletes every file it deployed, and prunes transitive dependencies that nothing else needs.

<!-- group doccmd[verify]: end -->

Unregister the marketplace itself:

<!-- skip doccmd[all]: next -->

```bash
apm marketplace remove qubership-ai-packages
```

## Staying up to date

A release is a new repository tag. Move to it by re-registering at the new tag — re-adding under the same name updates the pin:

<!-- skip doccmd[all]: next -->

```bash
apm marketplace add Netcracker/qubership-ai-packages --ref v0.2.0
```

If you track `main` instead of a tag, refresh the cached copy and reinstall:

<!-- skip doccmd[all]: next -->

```bash
apm marketplace update qubership-ai-packages
apm install apm-authoring@qubership-ai-packages
```

To re-resolve every dependency at once, run `apm update`. It prints an added, updated, and removed plan and asks before writing the lockfile.

## How CI verifies this guide

The commands from "Register the marketplace" through "Remove a package" run on every pull request via [`.github/workflows/marketplace.yml`](../.github/workflows/marketplace.yml). CI extracts the code blocks in the [doccmd](https://github.com/adamtheturtle/doccmd) `verify` group and runs them against the revision under review, so this guide cannot silently drift from what the CLI does. The "Staying up to date" commands need a second release, so they are marked to skip.

## Reference

- [Installing from marketplaces](https://microsoft.github.io/apm/consumer/installing-from-marketplaces/) — the full consumer surface and the native install paths for Claude Code, Copilot, and Cursor.
- [Manage dependencies](https://microsoft.github.io/apm/consumer/manage-dependencies/) — update, audit, and the lockfile workflow.
