---
name: refactor-contract
description: >-
    Use when producing or consuming structured refactoring proposals. Defines the shared output contract, priority rubric, proposal format, per-specialist report template, and final triage report structure that all refactorer agents must follow and the refactor-triage agent enforces. Triggers: Trigger for any refactor specialist agent (design, type, performance, smell) producing proposals, or the refactor-triage agent aggregating and deduplicating proposals into a final refactor report. Also use when reviewing or validating structured refactoring proposals.
---

# Refactor Contract

Every refactorer agent in the refactor plugin produces proposals in this exact
format. The refactor-triage agent enforces this contract when aggregating.

## Refactoring Dimensions

The refactorer specialist set is fixed: **design, type, performance, smell**.
This is the single source of truth for the dimension set — the `/refactor`
command dispatches one refactorer per dimension, the `Dimension` field below
enumerates the same values, and refactor-triage expects one report per
dispatched dimension. Adding or removing a dimension means updating this
section, the `Dimension` field, the command's dispatch list, and the matching
refactorer agent.

- **design** — SOLID, coupling/cohesion, abstraction leaks, misplaced
  responsibility, design-pattern fit/misuse, dependency direction.
- **type** — `any`/`Any`/`unknown` leakage, weak generics, missing narrowing
  and exhaustiveness, nullability, primitive obsession (domain types over raw
  primitives).
- **performance** — algorithmic complexity, allocations, redundant computation,
  hidden materialization, missing caching — **behavior-preserving only**.
- **smell** — long methods, duplication, dead code, naming, deep nesting, magic
  values, complexity hotspots, comment rot.

## The Iron Law

> NO PROPOSAL WITHOUT A BEHAVIOR-PRESERVATION ARGUMENT.
> NO PRIORITY WITHOUT BLAST RADIUS.

A refactoring is a behavior-preserving transformation. Every proposal cites a
`file:line`, states the named refactoring, and argues why the transformation
preserves observable behavior — what stays identical and what proves it (tests,
type-checker, equivalence reasoning). A change that alters behavior is not a
refactoring; it is a bug fix or a feature, and it is **out of scope**.

This law has two parts. The first ("no proposal without a preservation
argument") prevents disguised rewrites and behavior-changing "cleanups". The
second ("no priority without blast radius") prevents over-prioritizing a tidy
local change while under-prioritizing a structural fix that unblocks dozens of
call sites.

## Individual Proposal Format

```markdown
- **[HIGH|MEDIUM|LOW]** `path/to/file.py:42` -- one-line summary
  - **Dimension**: design|type|performance|smell
  - **Smell**: the current problem in the code, stated as fact
  - **Refactoring**: the named technique (e.g. Extract Method, Replace
    Conditional with Polymorphism, Introduce Parameter Object)
  - **Before→After**: short sketch of the current shape and the target shape
  - **Behavior preservation**: why observable behavior is unchanged + what
    proves it (existing tests, type-checker, pure-rename, equivalence reasoning)
  - **Blast radius**: N direct callers, M transitive importers
  - **Effort**: S | M | L
  - **Confidence**: 0-100
```

### Required Fields

Every proposal MUST include all eight fields. Omitting any field is a contract
violation. Confidence MUST be an integer from 0 to 100. If blast radius data
is unavailable (no graph built), write:
`Blast radius: graph unavailable — priority based on code analysis only`.

## Before→After Field Design

A static refactorer cannot execute code, so `Before→After` is a **concrete
transformation sketch**, not a diff that has been run. Use the tightest
applicable form:

- **Structural** (design): name the current arrangement and the target.
  `God-class OrderService (12 responsibilities) @L40 → extract PricingPolicy,
  TaxCalculator, and Notifier collaborators`.
- **Type-tightening** (type): name the loose type and the precise one.
  `def handle(event: Any) @L18 → handle(event: OrderEvent) with a discriminated
  union + exhaustive match`.
- **Algorithmic** (performance): name the current and target complexity.
  `O(n²) `x in list` lookup inside loop @L55 → build a set once → O(n); set is
  read-only so iteration order and results are identical`.
- **Local** (smell): name the technique and the seam.
  `45-line process() @L20 mixing parse/validate/persist → Extract Method into
  three named functions; same call order, same side effects`.

A `Before→After` MUST name the seam (the function/class/line being changed) and
the target shape. "Clean this up" with no named technique is **not** a valid
proposal and the proposal must be filtered by triage.

## Confidence Rubric

- `90–100`: Behavior preservation is provable (pure rename, mechanical Extract
  Method covered by tests, type annotation with no runtime effect). Clear win.
- `80–89`: Strong case with a small assumption about a caller or an untested
  path that the refactoring leaves observably unchanged.
- `70–79`: Plausible and worth surfacing, but the preservation argument leans on
  reasoning not backed by a test or the type-checker.
- `<70`: Do not emit unless it is a HIGH-priority structural proposal that
  refactor-triage should weigh.
- **Specialist-specific cap**: confidence is capped at 79 if the preservation
  argument cannot point to a test, the type-checker, or a purely mechanical
  transformation (i.e. behavior equivalence rests on unverified reasoning).

## Priority Rubric

### HIGH

High-leverage refactoring: removes a structural risk, unblocks future work, or
eliminates a hazard that is actively costing correctness/maintainability — and
the blast radius or recurrence is large.

**Examples:**

- Break a god-class touched by 50+ importers into cohesive collaborators
- Replace a sprawling `Any` boundary that defeats type-checking across a hot
  module
- Replace an O(n²) hot-path scan with an O(n) lookup on a growing collection
- De-duplicate a triplicated algorithm that has already diverged once

### MEDIUM

Worthwhile refactoring that improves a real area but is local in blast radius or
deferrable without accruing fast.

**Examples:**

- Extract a 40-line method into named steps in a moderately-called function
- Introduce a Parameter Object for a 6-argument constructor
- Narrow an `Optional` flowing through a single module
- Replace a magic-number cluster with named constants

### LOW

Polish, consistency, or defensive tidiness. Non-blocking.

**Examples:**

- Rename a locally-scoped variable for clarity
- Collapse a trivially nested conditional
- Remove a single dead private helper
- Tighten one annotation the type system nearly infers already

## Priority Elevation Rule

A proposal graded MEDIUM whose blast radius (via `get_impact_radius_tool`) shows
**50+ transitive importers** is automatically elevated to HIGH. The refactorer
MUST check blast radius before finalizing priority for every MEDIUM proposal
(graph permitting).

## Per-Specialist Report Template

Each refactorer produces exactly this structure:

```markdown
# <Dimension> Refactor — <target>

## Proposals

### HIGH

<proposals or _None_>

### MEDIUM

<proposals or _None_>

### LOW

<proposals or _None_>

## Coverage

<1–2 sentences: what code paths were read, what was deliberately out of scope,
and whether the code-review-graph was available for blast-radius analysis.>

## Summary

<2–3 sentence dimension-scoped verdict. State what was reviewed, the key
refactoring opportunities, and the overall health of the target from this
dimension's perspective.>
```

## Final Triage Report Template

The refactor-triage agent produces this structure after receiving all
specialist reports:

```markdown
# Refactor — <target>

## Summary

<3–5 sentences. Scope, languages, refactorers run, proposal counts by priority,
graph availability, and overall maintainability assessment.>

## Blast Radius

| Symbol / Module | Direct Callers | Transitive Importers | Flows |
|-----------------|----------------|----------------------|-------|
| …               | …              | …                    | …     |

## Proposals by Priority

### HIGH

<merged/deduped proposals across all dimensions, tagged with Dimension>

### MEDIUM

<merged/deduped proposals across all dimensions>

### LOW

<merged/deduped proposals across all dimensions>

## Cross-Dimension Observations

<Proposals where multiple refactorers flagged the same location or pattern. Cite
both dimensions and explain the combined leverage — e.g., a god-class (design)
whose methods are also the duplication hotspot (smell): one Extract addresses
both.>

## Refactor Plan

<Numbered, dependency-ordered. Group by file to minimise edit passes. State
which refactorings unblock or simplify others. Sequence so each step lands as a
small, independently verifiable, behavior-preserving change.>

## Verdict

<LEAVE AS-IS | WORTH SCHEDULING | REFACTOR NOW>

<Top 3–5 actions in priority order.>
```

## Verdict Rules

- Any HIGH proposal present → **REFACTOR NOW**
- Only MEDIUM proposals (no HIGH) → **WORTH SCHEDULING**
- Only LOW proposals, or no proposals → **LEAVE AS-IS**

## Deduplication Rules (refactor-triage)

When multiple refactorers flag the same `file:line`:

1. **Same underlying refactoring**: merge into one proposal, keep the highest
   priority, cite all dimensions, union the Smell and Before→After fields.
2. **Different refactorings**: keep as separate proposals, note the co-location
   in Cross-Dimension Observations.
3. **Conflicting priority, same refactoring**: use the higher priority and note
   the disagreement.

## Filtering Rules (refactor-triage)

Drop proposals that:

- Lack a concrete `file:line` citation (the Iron Law).
- Lack a behavior-preservation argument, or propose a change that alters
  observable behavior (that is a bug fix or feature, not a refactoring).
- Lack a named refactoring technique (vague "clean this up").
- Are tagged LOW with `Confidence < 80`.
- Are tagged MEDIUM with `Confidence < 70`.
- Are exact duplicates of a higher-priority proposal at the same location.

Never drop: any HIGH proposal regardless of confidence — refactor-triage must
see it.
