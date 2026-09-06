---
name: logic-taxonomy
description: >-
    Checklist of logic, type-safety, and API-contract bug patterns for the logic-hunter agent. Do not invoke directly — force-preloaded into logic-hunter at startup. Triggers: Loaded automatically into the logic-hunter agent. Covers off-by-one errors, arithmetic, boolean logic, control flow, type leakage, and API-contract and invariant violations.
---

# Logic Bug Taxonomy

Checklist for the `logic-hunter` agent. Work through every section in order;
do not skip a section. Every confirmed item must be emitted as a finding in the
format defined by `finding-contract`.

## 1. Off-by-One and Boundary Errors

- **Loop limit**: `<` vs `<=` — does the loop include or exclude the last
  element? Both sides: too few iterations and too many iterations.
- **Slice index**: 0-indexed vs 1-indexed confusion; are the start and stop
  of the slice correct for the intended semantics?
- **Range endpoint**: `range(n)` produces `0..n-1`; is `n+1` or `n-1`
  needed instead?
- **Length vs last valid index**: `len(items)` is one past the last valid
  index; using it as an index is always out of bounds.
- **Empty collection**: `max([])` / `min([])` / `items[0]` / `items[-1]` all
  raise on empty. Is the empty case guarded?
- **String slicing with negative indices**: Python wraps; other languages do
  not. Is negative-index behaviour intentional and correct?
- **Cursor advancement**: does the loop advance past the last item (skipping
  it) or re-process it?

## 2. Arithmetic and Numeric Errors

- **Integer overflow**: Python integers are unbounded; TypeScript/Go/Rust/C
  have fixed-width types. Does arithmetic on a fixed-width type overflow
  silently?
- **Float equality**: `a == b` on floats is almost always wrong. Is
  `abs(a - b) < epsilon` or `math.isclose` used where needed?
- **Division by zero**: can the denominator be zero on any reachable input
  path? Check both `/` and `%`.
- **Integer vs float division**: `a // b` (floor div) vs `a / b` (true div) —
  is the right operator used?
- **Modulo with negatives**: `(-7) % 3` is `2` in Python but `-1` in C/Java.
  Is cross-language consistency assumed?
- **Signed/unsigned mismatch**: passing a signed integer where an unsigned
  is required (or vice versa) in typed languages.

## 3. Boolean Logic Faults

- **Negation error**: `not (a and b)` vs `not a or not b` — are De Morgan's
  laws correctly applied?
- **Wrong logical operator**: `and` used where `or` is needed (or vice versa)
  in a guard or filter expression.
- **Short-circuit side effects**: does the right-hand side of `and`/`or` have
  a side effect that must always run? Short-circuit may silently skip it.
- **Truthy/falsy confusion**: `0`, `""`, `[]`, `{}`, `None` are all falsy in
  Python. Is `if x:` the right check, or should it be `if x is not None:` or
  `if len(x) > 0:`?
- **Comparison chaining**: `1 < x < 10` is correct Python. Watch for
  accidental `1 < x and 10 > x` that tests the same condition or
  `x < 1 or x > 10` that inverts the intent.

## 4. Control Flow Defects

- **Missing return**: does every branch of a function return a value when the
  function is not `None`-returning? Missing return in a branch silently
  returns `None`.
- **Return in wrong branch**: early return that skips necessary state
  updates, cleanup, or logging.
- **Wrong branch coverage**: does the `if` test the right condition, or is
  the logic inverted (positive/negative case swapped)?
- **Dead code after unconditional exit**: code after `return`, `break`,
  `continue`, or `raise` is never executed — indicates a logic error in the
  surrounding control flow.
- **Fall-through in match/switch**: languages with fall-through (C, Go
  `switch`) — is `break` or `fallthrough` used correctly?
- **Condition checked after side effect**: a check-then-act pattern where the
  state can change between the check and the act (TOCTOU for local state).

## 5. Type-Safety Violations

- **`Optional[T]` dereferenced without `None` check**: attribute access,
  subscript, or arithmetic on a value that may be `None`.
- **`Any` leakage**: untyped third-party code or `cast(Any, ...)` infects
  type safety downstream. Is the result validated at the boundary?
- **`cast()` silencing a genuine type error**: `cast` is a lie to the type
  checker; a runtime `isinstance` check should follow.
- **Mutable default argument**: `def f(items=[])` — the default list is
  shared across all calls. Use `None` and assign inside.
- **Unhashable type as dict key or set element**: using a list, dict, or
  other mutable as a key raises `TypeError` at runtime.
- **TypeVar bounds violated**: a generic function used with a type outside its
  declared bound.
- **TypedDict missing required key**: constructing a `TypedDict` without a
  required key is a runtime `KeyError` waiting to happen.

## 6. API-Contract and Invariant Violations

- **Precondition not enforced**: the function contract requires `x > 0`, but
  callers can pass `0` or negative values without error.
- **Postcondition violated**: the function promises to return `T`, but returns
  `None` on an untested path.
- **Invariant broken**: a class invariant (e.g., "balance is always ≥ 0") is
  violated by a method that does not check or restore it.
- **Wrong argument order**: two or more parameters of the same type in the
  same position — is `f(src, dst)` called as `f(dst, src)`?
- **Missing required setup**: calling `cursor.execute()` before
  `connection.connect()`, reading from a file before `seek(0)`, etc.
- **State machine invalid transition**: an object transitions from state A to
  state C without passing through state B (e.g., calling `close()` on an
  already-closed resource).

## 7. Error Handling Logic

- **Bare `except:`**: catches `KeyboardInterrupt`, `SystemExit`, and
  `GeneratorExit` in addition to application errors. Always specify at least
  `except Exception`.
- **Exception swallowed silently**: `except Exception: pass` or logging
  without re-raise — the caller has no idea the operation failed.
- **`return` inside `finally`**: the `return` overrides any exception being
  propagated from the `try` block, silently swallowing it.
- **Exception in `finally` masking original**: if `finally` raises, the
  original exception from `try` is lost.
- **`raise e` vs `raise`**: `raise e` resets the traceback; `raise` (bare)
  re-raises with the original traceback intact. Are tracebacks being lost?
- **`except` too broad**: catching `ValueError` when only `KeyError` is
  expected — the broad catch hides unrelated errors.
