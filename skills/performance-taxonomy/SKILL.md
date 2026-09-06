---
name: performance-taxonomy
description: >-
    Checklist of behavior-preserving performance refactoring opportunities for the perf-refactorer agent. Do not invoke directly — force-preloaded into perf-refactorer at startup. Triggers: Loaded automatically into the perf-refactorer agent. Covers algorithmic complexity, allocations, redundant computation, hidden materialization, and caching — behavior-preserving only.
---

# Performance Refactoring Taxonomy

Checklist for the `perf-refactorer` agent. Work through every section in order;
do not skip a section. Every confirmed opportunity must be emitted as a proposal
in the format defined by `refactor-contract`.

**Behavior-preserving only.** A performance refactoring must return the same
results, raise the same errors, and produce the same observable side effects —
just faster or leaner. If the optimization changes results, ordering that
callers rely on, or precision, it is a behavior change and is **out of scope**.
State the equivalence explicitly in every proposal.

## 1. Algorithmic Complexity

- **O(n²) membership scan**: `x in list` inside a loop. Refactoring: build a
  `set`/`dict` once → O(1) lookup. Same membership results; only iteration order
  of the set differs, so confirm callers don't depend on order.
- **Repeated linear search in sorted data**: Refactoring: binary search /
  index map.
- **Nested loop join**: pairwise comparison of two collections. Refactoring:
  hash join keyed on the join field.
- **Sort inside a loop**: re-sorting on each iteration. Refactoring: sort once
  outside the loop.

## 2. Redundant Computation

- **Loop-invariant work inside a loop**: a value recomputed every iteration that
  never changes. Refactoring: **hoist** it out of the loop.
- **Repeated property/length/lookup**: `len(x)` or `obj.attr` recomputed in a
  hot path. Refactoring: bind to a local once.
- **Recomputation of a pure function on the same args**: Refactoring: memoize a
  pure, deterministic function (bounded cache — note eviction).
- **Double traversal**: two passes that could be fused into one. Refactoring:
  combine, preserving the same emitted order.

## 3. Hidden Materialization

- **`list(generator)` only to iterate once**: Refactoring: iterate the generator
  directly; same elements, same order, less memory.
- **`.fetchall()` / `.read()` / `.readlines()` of a large source**: Refactoring:
  stream/iterate in chunks where the consumer allows.
- **Building a full intermediate list between two transforms**: Refactoring:
  chain lazily (generator pipeline) when the result is consumed once.
- **`sorted(x)[0]` / `sorted(x)[-1]`**: Refactoring: `min`/`max` — same result,
  O(n) instead of O(n log n).

## 4. Allocation and Copying

- **String concatenation in a loop**: O(n²) churn. Refactoring: accumulate in a
  list and `"".join(...)` once — identical string.
- **Defensive copy that is never mutated**: Refactoring: drop the copy (after
  confirming no downstream mutation) or accept a read-only view.
- **Re-creating a constant structure per call**: Refactoring: hoist to a
  module-level constant (only if it is never mutated by callers).
- **Boxing/unboxing or repeated conversion**: Refactoring: convert once at the
  boundary.

## 5. Caching and Reuse (behavior-preserving)

- **Pure expensive call repeated with identical inputs**: Refactoring: add a
  bounded cache (`lru_cache(maxsize=...)`); confirm purity so cached results are
  indistinguishable from recomputation.
- **Connection/compiled-regex/parser rebuilt each call**: Refactoring: build
  once and reuse; preserve thread-safety assumptions.
- **Cache without bound** (a hazard, not a win): if you spot one, flag it — but
  unbounded growth is a resource bug; frame the *refactoring* as adding a bound,
  not as the optimization.

## 6. Data Structure Fit

- **Wrong container for the access pattern**: list used for frequent membership
  / dedup. Refactoring: `set`. Frequent keyed lookup over a list of records:
  `dict`. Preserve any order callers rely on (use `dict`/`OrderedDict` if so).
- **Repeated front-insertion on a list**: Refactoring: `deque`.
- **Counting by hand**: Refactoring: `collections.Counter` — same counts.
- **Linear `min`/`max`/top-k in a hot loop**: Refactoring: a heap when k ≪ n.
