---
name: type-taxonomy
description: >-
    Checklist of type-strictness refactoring opportunities for the type-refactorer agent. Do not invoke directly — force-preloaded into type-refactorer at startup. Triggers: Loaded automatically into the type-refactorer agent. Covers any/unknown leakage, weak generics, missing narrowing and exhaustiveness, nullability, and primitive obsession.
---

# Type-Strictness Refactoring Taxonomy

Checklist for the `type-refactorer` agent. Work through every section in order;
do not skip a section. Every confirmed opportunity must be emitted as a proposal
in the format defined by `refactor-contract`. Type-only changes are usually the
highest-confidence refactorings (the type-checker proves preservation) — but a
tightening that changes runtime behavior (e.g. adding a runtime cast that
raises) is a behavior change, not a refactoring.

## 1. `Any` / `unknown` / Untyped Leakage

- **`Any`/`Any`-typed parameter or return**: defeats checking for every
  downstream caller. Refactoring: annotate the precise type; validate at the
  boundary.
- **`cast(Any, ...)` / `as any`**: silences the checker. Refactoring: replace
  with a real type plus a narrowing guard.
- **Untyped third-party value flowing inward**: Refactoring: parse/validate into
  a typed model at the entry point (e.g. a dataclass / Pydantic / zod schema).
- **Implicit `Any` from missing annotation**: Refactoring: add the inferred
  annotation; enable stricter checker settings locally.

## 2. Weak or Missing Generics

- **Container typed as `list`/`dict` without parameters**: Refactoring:
  parameterize — `list[Order]`, `dict[str, Account]`.
- **Function that should be generic but is over-narrow or `Any`**: Refactoring:
  **Introduce TypeVar** so the input type flows to the output.
- **Unbounded TypeVar that should be bounded**: Refactoring: add a `bound=` to
  capture the real contract.
- **Generic class collapsed to a concrete type**: Refactoring: restore the type
  parameter so callers retain element types.

## 3. Narrowing and Exhaustiveness

- **Union handled without narrowing**: accessing a member valid for only one
  arm. Refactoring: add an explicit `isinstance` / discriminant check.
- **Non-exhaustive match over a closed union/enum**: missing case silently
  falls through. Refactoring: add an exhaustiveness assertion (`assert_never`
  / `never`).
- **Discriminated union modeled as flat optional fields**: Refactoring: model as
  a tagged union so illegal states are unrepresentable.
- **Boolean-blindness (multiple bools encoding a state)**: Refactoring: replace
  with an enum / literal union.

## 4. Nullability

- **`Optional[T]` flowing far before the `None` check**: Refactoring: narrow
  early; push the `Optional` to the boundary and pass `T` inward.
- **`Optional` used where the value is always present**: Refactoring: tighten to
  `T` and remove dead guards.
- **Missing `Optional` where `None` is actually returned**: this is a *type
  correctness* gap — annotate it `Optional[T]` (preserves runtime behavior,
  makes the existing behavior honest).
- **Sentinel value standing in for absence (`-1`, `""`)**: Refactoring: replace
  with `Optional` / a real domain type.

## 5. Primitive Obsession → Domain Types

- **Raw `str`/`int` carrying domain meaning** (`user_id: str`, `cents: int`):
  Refactoring: **Replace Primitive with Domain Type** (NewType, value object).
- **Tuple/dict as an ad-hoc record**: Refactoring: **Introduce
  Dataclass/Record/Struct** with named, typed fields.
- **Stringly-typed enums** (`status: str` with known values): Refactoring:
  replace with an `Enum` / literal union.
- **Units encoded in names not types** (`timeout_ms`, `size_kb`): Refactoring:
  wrap in a typed quantity to prevent unit-mix errors.

## 6. Signature and Contract Tightening

- **Over-broad parameter type** (`Sequence` taken but only `list` ops used, or
  vice versa): Refactoring: pick the precise protocol/type.
- **Mutable type accepted where read-only suffices**: Refactoring: accept
  `Sequence`/`Mapping`/`Readonly<>` to document and enforce no mutation.
- **Return type wider than reality** (`-> object`/`-> Any`): Refactoring: narrow
  to the actual returned type.
- **Keyword/positional contract unclear**: Refactoring: mark keyword-only / add
  overloads so misuse is a type error.
