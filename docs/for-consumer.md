# Consumer guide

This repository, `Netcracker/qubership-ai-packages`, publishes an APM marketplace: a curated index of agent packages (skills, instructions, agents, and umbrella packages) that you install with the `apm` CLI. Register the marketplace once, then install packages by name.

> Testing against a fork? Replace `Netcracker/qubership-ai-packages` with your fork, for example `vlsi/qubership-ai-packages`.

## Prerequisites

- APM 0.16.0 or newer. Check with `apm --version`; upgrade with `apm self-update`. Install steps are in [the APM installation guide](https://microsoft.github.io/apm/getting-started/installation/).
- Network access to `github.com`. The marketplace index and every package are fetched over git.

## 1. Register the marketplace

```bash
apm marketplace add Netcracker/qubership-ai-packages --ref v0.1.0
```

`--ref` pins the whole marketplace, and every package in it, to a release tag. Pin a tag: it gives every machine and CI run the same bytes. Omit `--ref` to track `main` and always resolve the latest:

```bash
apm marketplace add Netcracker/qubership-ai-packages
```

Confirm the registration:

```bash
apm marketplace list
```

## 2. Find a package

```bash
apm marketplace browse qubership-ai-packages   # list every package
apm search auth@qubership-ai-packages          # filter by name or description
```

`apm list` does not list packages — it lists the `scripts:` in your own `apm.yml`. Use `browse` or `search` to explore the marketplace, and `apm deps list` to see what you have already installed.

## 3. Install a package

```bash
apm install apm-authoring@qubership-ai-packages
```

The install deploys the package's primitives (skills, instructions, and the rest) into your agent harness folders (`.github/`, `.claude/`, `.cursor/`, and so on), records the resolved commit and content hash in `apm.lock.yaml`, and adds the dependency to `apm.yml`. Commit both `apm.yml` and `apm.lock.yaml` so the install reproduces on every machine.

Inspect what the package contributed:

```bash
apm deps list   # per-package counts: prompts, instructions, agents, skills
apm deps tree   # full graph, including transitive dependencies
```

Umbrella packages pull in other packages. `go-microservice-dev-kit`, for example, installs six cross-repository dependencies, which `apm deps tree` lists.

## 4. Update the marketplace

A release is a new repository tag. Move to it by re-registering at the new tag — re-adding under the same name updates the pin:

```bash
apm marketplace add Netcracker/qubership-ai-packages --ref v0.2.0
```

If you track `main` instead of a tag, refresh the cached copy:

```bash
apm marketplace update qubership-ai-packages
```

## 5. Update an installed package

After you move the marketplace pin (step 4), reinstall the package to pick up its new version:

```bash
apm install apm-authoring@qubership-ai-packages
```

To re-resolve every dependency at once, run `apm update`. It prints an added/updated/removed plan and asks before writing the lockfile.

## 6. Remove a package

```bash
apm uninstall apm-authoring@qubership-ai-packages
```

This removes the package from `apm.yml` and `apm.lock.yaml`, deletes every file it deployed across all harness folders, and prunes transitive dependencies that nothing else needs.

Unregister the marketplace itself:

```bash
apm marketplace remove qubership-ai-packages
```

## Reference

- [Installing from marketplaces](https://microsoft.github.io/apm/consumer/installing-from-marketplaces/) — the full consumer surface and the native install paths for Claude Code, Copilot, and Cursor.
- [Manage dependencies](https://microsoft.github.io/apm/consumer/manage-dependencies/) — update, audit, and the lockfile workflow.
