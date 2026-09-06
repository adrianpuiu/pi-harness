---
name: design-taxonomy
description: >-
    Checklist of design, architecture, and pattern refactoring opportunities for the design-refactorer agent. Do not invoke directly — force-preloaded into design-refactorer at startup. Triggers: Loaded automatically into the design-refactorer agent. Covers SOLID violations, coupling and cohesion, abstraction leaks, misplaced responsibility, dependency direction, and design-pattern fit and misuse.
---

# Design Refactoring Taxonomy

Checklist for the `design-refactorer` agent. Work through every section in
order; do not skip a section. Every confirmed opportunity must be emitted as a
proposal in the format defined by `refactor-contract`, with a named refactoring
and a behavior-preservation argument.

## 1. Single Responsibility and Cohesion

- **God class / god function**: one unit doing many unrelated jobs (parse +
  validate + persist + notify). Refactoring: **Extract Class** / **Extract
  Method** to split by responsibility.
- **Feature envy**: a method that mostly manipulates another object's data.
  Refactoring: **Move Method** to where the data lives.
- **Low cohesion**: fields/methods cluster into groups that don't interact.
  Refactoring: **Extract Class** along the cluster boundary.
- **Divergent change**: one class changes for many different reasons.
  Refactoring: split so each reason maps to one unit.

## 2. Coupling and Dependency Direction

- **Inappropriate intimacy**: two units reach into each other's internals.
  Refactoring: introduce a narrow interface; **Hide Delegate**.
- **Dependency points the wrong way**: a stable/abstract module depends on a
  volatile/concrete one. Refactoring: **Dependency Inversion** — depend on an
  abstraction.
- **Shotgun surgery**: one conceptual change forces edits across many files.
  Refactoring: consolidate the concept into one unit.
- **Concrete dependency where an abstraction is needed**: hard `new`/direct
  import of a concrete collaborator. Refactoring: inject the dependency.

## 3. Abstraction Leaks and Boundaries

- **Leaky abstraction**: implementation details (SQL, HTTP status, file paths)
  escape through a domain interface. Refactoring: translate at the boundary.
- **Primitive return where a type belongs**: returning a raw dict/tuple that
  callers must know the shape of. Refactoring: **Introduce Domain Type**.
- **Missing seam**: untestable code because a collaborator is hard-wired.
  Refactoring: extract an interface to create a seam.
- **Anemic boundary**: a "service" that is only pass-through with no value.
  Refactoring: **Inline** the needless indirection.

## 4. Open/Closed and Conditional Structure

- **Type-switch ladder**: repeated `if isinstance(...)` / `switch on type`
  across the codebase. Refactoring: **Replace Conditional with Polymorphism**.
- **Flag argument controlling behavior**: `f(..., mode="a")` with a big branch.
  Refactoring: **Replace Parameter with Explicit Methods** or strategy.
- **Adding a case requires editing many switches**: violates open/closed.
  Refactoring: polymorphism or a registry/strategy table.

## 5. Interface Segregation and Substitutability

- **Fat interface**: clients depend on methods they don't use. Refactoring:
  **Extract Interface** into role-specific interfaces.
- **Liskov violation**: a subclass weakens a precondition or strengthens a
  postcondition (overrides that throw / return `None`). Refactoring: rework the
  hierarchy or favor composition.
- **Refused bequest**: a subclass ignores most of its parent. Refactoring:
  **Replace Inheritance with Delegation**.

## 6. Design Pattern Fit and Misuse

- **Pattern that would simplify**: hand-rolled dispatch that is a Strategy;
  manual resource pairing that is a Context Manager / RAII. Refactoring:
  introduce the fitting pattern.
- **Over-engineered pattern**: a Factory/AbstractFactory/Singleton where a plain
  function or value would do. Refactoring: **Inline** the pattern.
- **Misused pattern**: a Singleton used as a global mutable, an Observer with
  hidden ordering dependencies. Refactoring: replace with explicit wiring.
- **Misplaced construction logic**: complex object assembly scattered across
  callers. Refactoring: **Extract Factory Method** / builder.
