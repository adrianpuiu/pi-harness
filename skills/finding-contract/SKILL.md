---
name: finding-contract
description: >-
    Use when producing or consuming structured bug-hunt findings. Defines the shared output contract, severity rubric, finding format, per-hunter report template, and final triage report structure that all hunter agents must follow and the bug-triage agent enforces. Triggers: Trigger for any bug-hunter specialist agent (logic, concurrency, resource, boundary) producing findings, or the bug-triage agent aggregating and deduplicating findings into a final hunt report. Also use when reviewing or validating structured hunt reports.
---

# Finding Contract

Every hunter agent in the bug-hunter plugin produces findings in this exact
format. The bug-triage agent enforces this contract when aggregating.

## Bug Classes

The hunter specialist set is fixed: **logic, concurrency, resource, boundary**.
This is the single source of truth for the class set — the `/hunt` command
dispatches one hunter per class, the `Class` field below enumerates the same
values, and bug-triage expects one report per dispatched class. Adding or
removing a class means updating this section, the `Class` field, the command's
dispatch list, and the matching hunter agent.

## Individual Finding Format

```markdown
- **[BLOCKER|IMPORTANT|SUGGESTION]** `path/to/file.py:42` -- one-line summary
  - **Class**: logic|concurrency|resource|boundary
  - **Bug**: the latent defect, stated as fact
  - **Trigger**: exact condition/input/interleaving that manifests it
  - **Consequence**: crash | wrong result | leak | corruption | hang
  - **Repro**: deterministic manifestation path (see Repro Field below)
  - **Blast radius**: N direct callers, M transitive importers
  - **Fix**: concrete one-line direction (do NOT implement)
  - **Confidence**: 0-100
```

### Required Fields

Every finding MUST include all eight fields. Omitting any field is a contract
violation. Confidence MUST be an integer from 0 to 100. If blast radius data
is unavailable (no graph built), write:
`Blast radius: graph unavailable — severity based on code analysis only`.

## The Iron Law

> NO FINDING WITHOUT A REPRODUCTION PATH. NO SEVERITY WITHOUT BLAST RADIUS.

Every finding cites a `file:line`. Every IMPORTANT finding checks blast radius
before finalizing severity, applying the elevation rule below.

## Repro Field Design

A static hunter cannot execute code, so `Repro` is a **deterministic
manifestation path**, not a test run. Use the tightest applicable form:

- **Input-driven**: `Call f(x=-1) → x+1=0 @L42 → ZeroDivisionError`. Name the
  entry point, exact argument values, and the line-by-line chain to failure.
- **Interleaving-driven** (concurrency): `Thread A reads balance @L10, Thread B
  reads balance @L10, both write @L12 → lost update`. Express as an ordered
  step list.
- **Scale-driven** (resource): `Each call appends to module-level _cache @L20
  with no eviction → unbounded growth → OOM after ~N requests`. State the
  growth function.
- **State-driven** (boundary): `Empty list input → max(items) @L8 raises
  ValueError`. State the exact edge value.

A Repro MUST name the entry point, the exact triggering value or ordering, and
the failing line. "Could fail under load" with no path is **not** a valid Repro
and the finding must be filtered by triage.

## Confidence Rubric

- `90–100`: Direct evidence in the code, clear consequence, likely actionable.
- `80–89`: Strong evidence with a small assumption about runtime or caller
  behavior.
- `70–79`: Plausible and worth surfacing for IMPORTANT or BLOCKER findings, but
  missing one piece of context.
- `<70`: Do not emit as a finding unless it is a BLOCKER candidate that
  bug-triage must see.
- **Hunter-specific cap**: confidence is capped at 79 if the Repro lacks a
  concrete triggering value (the entry point or exact trigger is unknown).

## Severity Rubric

### BLOCKER

Will crash, corrupt state, lose data, hang, or leak unboundedly on a reachable
input or interleaving. The change is not shippable with a BLOCKER finding.

**Examples:**

- Null dereference on a hot path with 50+ callers
- Lost-update race on shared financial state
- Unbounded cache causing OOM under production load
- Deadlock from inconsistent lock acquisition order
- `await`-less coroutine silently dropping work

### IMPORTANT

Latent risk that manifests under realistic but non-default conditions, or that
materially harms correctness at scale. Shippable with a tracked follow-up.

**Examples:**

- Off-by-one only at collection boundary
- Blocking I/O on the async event loop (latency degradation, not crash)
- O(n²) loop over a collection that will grow
- Bare `except` swallowing a real error
- Missing timeout on an external call

### SUGGESTION

Defensive hardening, low-likelihood edge case, or robustness nit. Non-blocking.

**Examples:**

- Unhandled theoretical Unicode edge the type system nearly prevents
- Missing `None` guard where callers currently always pass a value
- Micro-leak bounded by request lifetime
- Minor code duplication that introduces a latent divergence risk

## Severity Elevation Rule

A finding graded IMPORTANT whose blast radius (via `get_impact_radius_tool`)
shows **50+ transitive importers** is automatically elevated to BLOCKER. The
hunter MUST check blast radius before finalizing severity for every IMPORTANT
finding (graph permitting).

## Per-Hunter Report Template

Each hunter produces exactly this structure:

```markdown
# <Class> Hunt — <target>

## Findings

### BLOCKER

<findings or _None_>

### IMPORTANT

<findings or _None_>

### SUGGESTION

<findings or _None_>

## Coverage

<1–2 sentences: what code paths were walked, what was deliberately out of
scope, and whether the code-review-graph was available for blast-radius
analysis.>

## Summary

<2–3 sentence class-scoped verdict. State what was reviewed, the key risk
areas, and whether the target is safe from this class's perspective.>
```

## Final Triage Report Template

The bug-triage agent produces this structure after receiving all hunter
reports:

```markdown
# Bug Hunt — <target>

## Summary

<3–5 sentences. Scope, languages, hunters run, finding counts by severity,
graph availability, and overall risk assessment.>

## Blast Radius

| Changed Symbol | Direct Callers | Transitive Importers | Flows |
|----------------|----------------|----------------------|-------|
| …              | …              | …                    | …     |

## Findings by Severity

### BLOCKER

<merged/deduped findings across all classes, tagged with Class>

### IMPORTANT

<merged/deduped findings across all classes>

### SUGGESTION

<merged/deduped findings across all classes>

## Cross-Class Observations

<Findings where multiple hunters flagged the same location or pattern. Cite
both classes and explain the compound risk — e.g., a race (concurrency) on
an unbounded structure (resource) compounds into inevitable OOM.>

## Fix Plan

<Numbered, dependency-ordered. Group by file to minimise edit passes. State
which fixes unblock others.>

## Verdict

<CLEAN | SHIP WITH FOLLOWUPS | DO NOT SHIP>

<Top 3–5 actions in priority order.>
```

## Verdict Rules

- Any BLOCKER present → **DO NOT SHIP**
- Only IMPORTANT findings (no BLOCKERs) → **SHIP WITH FOLLOWUPS**
- Only SUGGESTION findings, or no findings → **CLEAN**

## Deduplication Rules (bug-triage)

When multiple hunters flag the same `file:line`:

1. **Same root cause**: merge into one finding, keep the highest severity, cite
   all classes in the finding, union the Trigger and Consequence fields.
2. **Different root causes**: keep as separate findings, note the co-location
   in Cross-Class Observations.
3. **Conflicting severity, same root cause**: use the higher severity and note
   the disagreement.

## Filtering Rules (bug-triage)

Drop findings that:

- Lack a concrete `file:line` citation (the Iron Law).
- Lack a valid Repro (no named entry point or triggering value/order).
- Are tagged SUGGESTION with `Confidence < 80`.
- Are tagged IMPORTANT with `Confidence < 70`.
- Are exact duplicates of a higher-severity finding at the same location.

Never drop: any BLOCKER regardless of confidence — bug-triage must see it.
