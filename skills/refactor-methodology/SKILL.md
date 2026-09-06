---
name: refactor-methodology
description: >-
    Use when proactively analyzing code for behavior-preserving refactoring opportunities through static reading: examining code paths to find structural, type, performance, and readability improvements without running the code. A seven-phase methodology from mapping the target to reporting proposals with behavior-preservation arguments. Triggers: Trigger for "refactor this", "clean up this code", "improve the design", "reduce complexity", "tighten the types", "this is a code smell", "make this more maintainable", "is there a better pattern here", or any task where the goal is proposing behavior-preserving improvements by reading code rather than changing behavior.
---

# Refactoring Methodology — Static Analysis

## The Iron Law

> NO PROPOSAL WITHOUT A BEHAVIOR-PRESERVATION ARGUMENT.
> NO PRIORITY WITHOUT BLAST RADIUS.

A refactoring is a behavior-preserving transformation of code structure. A
proposal requires a concrete named technique AND an argument for why observable
behavior is unchanged — not a vague "this is cleaner", not a pattern match, not
a stylistic preference. If you cannot state the named refactoring and argue
behavior preservation, you do not have a proposal.

This law has two parts. The first ("no proposal without a preservation
argument") prevents disguised rewrites that quietly change behavior. The second
("no priority without blast radius") prevents over-rating a tidy local change
and under-rating a structural fix that unblocks many call sites.

## Refactoring vs Rewriting vs Bug-Fixing

Refactoring is *not* any change to code. Keep these distinct — only the first
is in scope:

| Activity | What it does | In scope? |
|----------|--------------|-----------|
| **Refactoring** | Changes structure, preserves observable behavior | **Yes** |
| **Rewriting** | Replaces an implementation, behavior may shift | No |
| **Bug-fixing** | Changes behavior to be correct | No → bug-hunter |
| **Feature work** | Adds new observable behavior | No |
| **Re-formatting** | Whitespace/style a linter handles | No → linter |

If a proposed change makes a previously-failing input now succeed, or alters a
return value, side effect, ordering, or error raised, it is **not** a
refactoring. Note it as out of scope and move on. The discipline is the same as
debugging — you read code paths — but the goal is structural improvement under
an invariant, not finding defects.

## Phase 1 — Map the Target

1. **Resolve the scope**: diff, file, range, branch, or module. Be precise
   about what is in scope and what is not.
2. **Identify the public surface**: which functions, classes, and types are
   called from outside the target. A refactoring must keep this surface's
   observable behavior identical; internal structure is free to change.
3. **Identify high-traffic and high-churn paths**: code on the critical path or
   edited often. Refactoring here has the highest leverage and the highest
   blast radius.
4. **Probe the knowledge graph**: `list_graph_stats_tool` to confirm graph
   availability; `get_impact_radius_tool` on the target symbols to understand
   blast radius before proposing anything.

Do not refactor blind. A proposal on a dead-code path has zero blast radius and
should be a LOW at most.

## Phase 2 — Read Every Path

For each unit in scope, read:

- Every **responsibility**: what distinct jobs a function or class does. Mixed
  responsibilities are the design seam.
- Every **type boundary**: parameters, return types, and where `Any`/`unknown`
  or untyped data enters and defeats checking downstream.
- Every **hot loop and allocation**: nested iteration, repeated work that could
  be hoisted, materialization that could be streamed, recomputation.
- Every **duplication and complexity hotspot**: copy-pasted blocks, deep
  nesting, long methods, magic values, dead code.
- Every **call site**: how the unit is used constrains which refactorings
  preserve behavior.

Do not skim only the obvious smell. The highest-leverage refactoring is often a
structural seam you only see after reading how the unit is called.

## Phase 3 — Identify the Smell

For each candidate, name the **concrete problem**, stated as fact:

> "Function X at line Z does A, B, and C — three responsibilities in one unit."

A problem without a name is a vibe, not a smell. "This feels messy" is not a
smell — "this 45-line method mixes parsing, validation, and persistence" is.
Keep reading until you can name the specific smell, or drop it below the emit
threshold.

## Phase 4 — Select the Named Refactoring

Map the smell to a **named, catalogued refactoring** with a known target shape:

- Extract Method / Extract Function — for long methods doing several jobs.
- Replace Conditional with Polymorphism — for type-switch ladders.
- Introduce Parameter Object — for long parameter lists.
- Replace Primitive with Domain Type — for primitive obsession.
- Pull Up / Push Down / Extract Class — for misplaced responsibility.
- Replace Loop with set/dict lookup — for O(n²) membership scans.

Name the technique and sketch `Before→After` (per `refactor-contract`). If you
cannot name a catalogued technique, you have a complaint, not a proposal.

## Phase 5 — Argue Behavior Preservation

This is the analogue of constructing a reproduction in bug-hunting — it is the
load-bearing step. For each proposal, state **why observable behavior is
unchanged and what proves it**:

- **Mechanical/pure-rename**: the transformation is name-only or a tool-grade
  Extract Method — no logic moves. Highest confidence.
- **Test-backed**: existing tests exercise the unit and would catch a behavior
  change. Cite them.
- **Type-checker-backed**: a type-only change (annotation, narrowing) with no
  runtime effect; the checker proves soundness.
- **Equivalence reasoning**: argue step-by-step that inputs map to identical
  outputs, side effects, ordering, and raised errors.

If preservation rests only on unverified reasoning (no test, no type-checker, no
mechanical guarantee), confidence is **capped at 79** (per the
`refactor-contract` confidence rubric). If you cannot argue preservation at all,
the change is a rewrite or a bug fix — drop it.

## Phase 6 — Prioritize by Blast Radius and Effort

Apply the priority rubric from `refactor-contract` in order:

1. **Is the code live and churning?** Dead or frozen code → LOW at most.
2. **What is the leverage?** Removes a structural hazard / unblocks future work
   / eliminates active maintainability cost → HIGH candidate. Local improvement
   → MEDIUM. Polish → LOW.
3. **What is the blast radius?** Query `get_impact_radius_tool`. Apply the
   elevation rule: MEDIUM with 50+ transitive importers → HIGH.
4. **What is the effort?** Estimate S/M/L. A HIGH-leverage / S-effort proposal
   leads the plan; a HIGH-leverage / L-effort proposal is sequenced as staged
   steps.
5. **Degrade gracefully** if no graph is built: base priority on code analysis
   alone and write `Blast radius: graph unavailable` in the proposal.

## Phase 7 — Report

Produce the per-specialist report in the exact template from
`refactor-contract`.

**Coverage section discipline**: state what code you read AND what you
deliberately did not examine (generated code, vendored dependencies, files
outside the declared scope). A Coverage section that claims completeness it did
not achieve is worse than a narrow, honest one.

**One proposal per refactoring**: if the same refactoring applies at multiple
sites (e.g. the same duplicated block in five files), report it once and list
all affected `file:line` locations.

**Relay proposals verbatim to triage**: the refactor-triage agent aggregates;
do not pre-filter or pre-summarize. Emit everything above the confidence
threshold and let triage apply the dedup and filter rules.

## Anti-Patterns

**No behavior-changing "refactors".** If the change alters a return value, side
effect, ordering, or raised error, it is a bug fix or a feature — out of scope.
The invariant is sacred: observable behavior in, observable behavior out.

**No speculative restructuring.** "This might be cleaner with a factory" without
a named smell and a preservation argument is not a proposal. Name the smell and
the technique first; if you cannot, do not emit.

**No editing code.** The refactorers do not have Write or Edit tools. Put the
target shape in the `Before→After` field and the technique in `Refactoring`; do
not attempt to implement.

**No narrating your thought process** in the report. The report is for the
reader. State proposals; do not transcribe your analysis.

**No duplicate proposal spam.** One refactoring → one proposal. List all
affected sites in the proposal; do not emit one proposal per site.

**No priority inflation.** If preservation rests on unverified reasoning, cap
confidence at 79. If the blast radius is unavailable, state it. Never upgrade a
local polish to HIGH because the code "feels bad".

**No taste-only proposals.** A refactoring must reduce a concrete cost
(coupling, type-unsafety, complexity, duplication, hot-path waste), not merely
match your stylistic preference.
