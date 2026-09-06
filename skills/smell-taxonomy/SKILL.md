---
name: smell-taxonomy
description: >-
    Checklist of code-smell and readability refactoring opportunities for the smell-refactorer agent. Do not invoke directly — force-preloaded into smell-refactorer at startup. Triggers: Loaded automatically into the smell-refactorer agent. Covers long methods, duplication, dead code, naming, deep nesting, magic values, and complexity hotspots.
---

# Code-Smell Refactoring Taxonomy

Checklist for the `smell-refactorer` agent. Work through every section in order;
do not skip a section. Every confirmed opportunity must be emitted as a proposal
in the format defined by `refactor-contract`, with a named refactoring and a
behavior-preservation argument. Stay out of the design-refactorer's lane
(architecture/SOLID) — your focus is local readability and complexity.

## 1. Long Methods and Functions

- **Long method doing several steps**: a function whose body has labeled
  sections / comment headers. Refactoring: **Extract Method** per section, with
  intention-revealing names. Same call order, same side effects.
- **Long parameter list**: 4+ parameters, especially same-typed. Refactoring:
  **Introduce Parameter Object** or split the function.
- **Deeply nested function**: arrow-shaped code. Refactoring: **Replace Nested
  Conditional with Guard Clauses**; **Extract Method** for inner blocks.

## 2. Duplication

- **Copy-pasted block in multiple places**: Refactoring: **Extract Function**
  and call it from each site. Report once, list all sites.
- **Duplicated logic with minor variation**: Refactoring: extract with a
  parameter for the varying part.
- **Parallel inheritance / switch duplicated across files**: Refactoring:
  consolidate the conditional (coordinate with design dimension if structural).
- **Duplicated literal/expression**: Refactoring: **Extract Variable** /
  named constant.

## 3. Dead and Unreachable Code

- **Unused private function/variable/import**: Refactoring: remove (confirm no
  reflection/dynamic use first).
- **Unreachable branch**: code after an unconditional return/raise, or a
  condition that is always true/false. Refactoring: remove the dead branch.
- **Commented-out code**: Refactoring: delete — version control is the history.
- **Redundant computation whose result is never used**: Refactoring: remove.

## 4. Naming and Intent

- **Non-revealing name**: `data`, `tmp`, `x`, `do_stuff`. Refactoring: **Rename**
  to reveal intent (pure rename — highest-confidence, behavior-identical).
- **Misleading name**: a `get_*` that mutates, an `is_*` that returns non-bool.
  Refactoring: rename to match actual behavior (do not change the behavior).
- **Inconsistent vocabulary**: `fetch`/`get`/`load` for the same concept.
  Refactoring: standardize the term.
- **Magic number / string**: an unexplained literal. Refactoring: **Extract
  Constant** with a meaningful name.

## 5. Conditional Complexity

- **Complex boolean expression**: a long `and`/`or` chain. Refactoring:
  **Extract Variable** / **Decompose Conditional** into named predicates.
- **Repeated condition**: the same test in several places. Refactoring: extract
  a predicate function.
- **Nested ternaries / arrow code**: Refactoring: guard clauses, early returns.
- **Switch/if-ladder on a value**: Refactoring: a lookup table/dict when the
  arms are uniform (coordinate with design if it is type-based).

## 6. Comments and Structure

- **Comment explaining *what* (not *why*)**: a comment that paraphrases code.
  Refactoring: **Extract Method** with a name that makes the comment redundant.
- **Stale/contradictory comment (comment rot)**: a comment that no longer
  matches the code. Refactoring: update or delete it.
- **Large data clump passed around together**: same group of fields travels
  together. Refactoring: **Introduce Parameter Object** / record.
- **Inconsistent formatting that obscures structure**: defer to the linter; only
  propose if it materially hides a bug-prone seam.
