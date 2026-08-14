# Axis: architecture

Finding prefix: `ARCH`. This is a **synthesis** axis: it runs last, and its prompt is distilled from the evidence
axes' reports. The distilled prompt adds the repository's specifics; this file is the invariant part.

You are judging the **design**, not the code. The question is not "does this work today" — assume it does — but "is
this the right shape, and what will it cost to live with for the next two years".

The evidence reports handed to you are a list of **symptoms**. Your job is to find the decisions that generated them,
plus the ones that have not produced a symptom yet.

## The filter

A finding qualifies only if fixing it changes at least one of:

- a **public contract** — API shape, resource model, schema, wire format, configuration surface;
- a **boundary** between this component and another — who calls whom, with what guarantees;
- the **identity or data model** — what uniquely names a thing, what state lives where;
- the **authority model** — which component is the source of truth, who arbitrates conflicts;
- the **control-flow model** — synchronous versus asynchronous, push versus poll, level-triggered versus
  edge-triggered, who owns retries;
- the **failure domain** — what shares fate with what;
- the **lifecycle model** — install, upgrade, migration, coexistence with what this replaces.

Two tests before you write anything up:

1. **The patch test.** Could a competent engineer fix this in one commit without touching a contract, a schema, or a
   boundary? If yes, it is not an architecture finding.
2. **The recurrence test.** If this exact defect were fixed tomorrow, would the same design keep producing defects of
   the same family? If yes, describe the design, not the defect.

Restating an evidence finding at higher volume is rejected. Citing one as proof that a design pressure is already
leaking into practice is exactly right.

## Method

Do steps 1 and 2 **before** forming opinions about the code, so the implementation does not anchor you.

1. **Enumerate the forces.** Independently of this repository, list what a component of this kind has to survive:
   scale, concurrency, restart, partial failure, an external system that is itself a source of truth, version skew,
   migration from a predecessor, extension by third parties, disaster recovery. Write the list down first.
2. **Reconstruct the implicit ADRs.** The team wrote no decision records. Recover them: for each load-bearing
   decision, name it, cite where it is encoded, and state what it buys and what it costs. Roughly 12–20. This
   inventory is a deliverable in its own right.
3. **Map authority.** For every piece of state, say who owns it, who caches it, how divergence is detected, and how
   it is repaired. Divergences that nothing detects are the highest-value findings in this review.
4. **Pressure-test with change.** For each force from step 1, and for each scenario in the distilled prompt, trace
   what the design makes you do. Cheap absorption means the design is right; a change that touches four layers means
   it is not.
5. **Check the genre.** This component belongs to a well-explored family. Compare its answers against how that family
   normally solves these problems, and where it deviates, say whether the deviation is justified by the domain or is
   an accident. Use prior art as a source of solved problems — do not propose adopting any of it wholesale.
6. **Rank by reversibility.** Separate one-way doors — published API, persisted formats, identity semantics,
   packaging, anything a consumer already depends on — from decisions that can be revisited later.

## Report additions

On top of the standard format, this axis produces:

**Verdict** — at most fifteen lines. Is the architecture fit to carry this system for two years? Name the three
decisions that most need revisiting, and the single one-way door that will be most expensive to walk back.

**Decision inventory:**

| # | Decision | Encoded in | Buys | Costs | Reversible? |
| --- | --- | --- | --- | --- | --- |

**Findings**, using this block instead of the standard one:

```markdown
### ARCH-01 <the decision, stated as a decision> — BLOCKER

- **Decision:** what was chosen, in one sentence
- **Encoded in:** `path:line`, and the other places that assume it
- **Force it fails under:** the requirement, scale, or change that breaks it
- **Consequence:** what the consumer, the operator, or the next maintainer experiences
- **Alternative:** what to do instead, and what that trades away
- **Cost to change:** now versus after the next release
- **Symptoms already visible:** evidence findings that this decision generated, by id
- **Проверка:** `executed` / `traced` / `inferred`, plus the artifact — and what would settle the rest
```

Severity on this axis: `BLOCKER` (a one-way door that is wrong, or a design that loses data under normal operation),
`MAJOR` (will force a painful change within a year, or makes a required capability unreachable), `MINOR` (friction
that compounds), `ACCEPTED-DEBT` (a defensible trade-off that is merely undocumented — say what to write down).

**Pressure-test table** — one row per scenario: what the architecture makes you do, whether it absorbs the change, and
the cost.
