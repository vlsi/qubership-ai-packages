# Axis: dependencies and supply chain

Finding prefix: `DEP`.

What this repository drags into its consumers, and how it will age. Fast to run and it informs the other axes — put it
early.

## What to check

- **The actual tree, not the declared list.** Resolve it (`mvn dependency:tree`, `go mod graph`, `cargo tree`,
  `npm ls`, `pipdeptree`) and record its size. For a library, every transitive dependency is a constraint imposed on
  every consumer, and a version conflict in someone else's build is your defect.
- **Compile versus runtime versus test scope.** A test-only library leaking into the compile scope, or an optional
  feature's dependency being mandatory, is a finding.
- **Framework lock-in.** A library that forces a logging implementation, a DI container, a JSON library, or a
  concurrency framework onto its consumers. Facades are the exception: an SLF4J-style API is fine, a bound
  implementation is not.
- **Version pinning and floating.** Ranges that resolve differently over time, `latest` tags, snapshot dependencies,
  and unpinned CI actions and container base images. A build that is not reproducible today will fail on a day nobody
  chose.
- **Staleness.** For each direct dependency: current version, latest version, and whether the gap crosses a known
  security advisory or an end-of-life. Do not list every minor version behind — report the ones that matter and say
  why.
- **Abandoned and single-maintainer dependencies** on a critical path, and dependencies whose functionality is a few
  lines you could own.
- **Duplication.** Two libraries doing the same job (two JSON parsers, two HTTP clients), or the same library at two
  versions in one tree.
- **Licenses.** Anything copyleft or unusual in a distributed artifact, and any dependency whose license is unknown.
  Report the fact; do not give legal advice.
- **Provenance.** Are artifacts built reproducibly, signed, and published with an SBOM? Is there a lockfile and is it
  committed? Does CI verify checksums?
- **Vulnerability scan.** Run whatever the ecosystem offers (`mvn versions:display-dependency-updates` plus OWASP
  dependency-check, `govulncheck`, `cargo audit`, `npm audit`, `pip-audit`) and report findings that are actually
  reachable from this code. An advisory in an unused code path is `LOW`, and say so — a report full of unreachable
  CVEs trains the reader to ignore this axis.

## Rules

- Depth of exploitation belongs to `security`. Here, report exposure and hygiene.
- Every finding needs the version numbers. "Outdated dependency" without the current and target version is not a
  finding.
