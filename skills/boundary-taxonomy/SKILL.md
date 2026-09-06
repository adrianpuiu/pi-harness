---
name: boundary-taxonomy
description: >-
    Checklist of edge-case and boundary-condition bug patterns for the boundary-hunter agent. Do not invoke directly — force-preloaded into boundary-hunter at startup. Triggers: Loaded automatically into the boundary-hunter agent. Covers empty/null/max inputs, negative values, Unicode, timezone, and malformed input robustness. Does NOT cover security vulnerabilities — see the Anti-Rule below.
---

# Boundary Bug Taxonomy

Checklist for the `boundary-hunter` agent. Work through every section in
order; do not skip a section. Every confirmed item must be emitted as a finding
in the format defined by `finding-contract`.

## Anti-Rule: Scope Boundary

This class covers **correctness and robustness** under edge-case inputs — code
that crashes, returns the wrong result, or enters a bad state when given unusual
but valid or malformed input.

It does **NOT** cover security vulnerabilities. Authentication bypass, SQL
injection as a privilege escalation vector, hardcoded secrets, and CVE-class
issues are outside scope — those belong in a dedicated security plugin.

The practical test: "Does this input cause *incorrect behavior* (wrong result,
crash, corruption)?" → boundary-hunter. "Does this input allow *unauthorized
access or data exfiltration*?" → security plugin.

## 1. Empty / Single-Element / Max-Size Inputs

- **Empty collection**: `max([])`, `min([])`, `items[0]`, `items[-1]`,
  `next(iter([]))`, `statistics.mean([])` — all raise on empty. Is the empty
  case guarded before these calls?
- **Single-element collection**: some algorithms behave differently with
  exactly one element (e.g., median, sorted pair operations, sliding windows).
  Is the single-element case tested?
- **Maximum size / index boundary**: `items[len(items)]` is always out of
  bounds. Does any loop or index calculation produce an index equal to the
  length?
- **Empty string**: does the code handle `""` correctly where a non-empty
  string is assumed? `""[0]` raises `IndexError`. `"".split(".")` returns
  `[""]`, not `[]`.
- **Recursion depth**: a recursive function without a depth limit called on a
  deeply nested structure (e.g., JSON, AST, linked list) → `RecursionError` /
  stack overflow. Python's default `sys.getrecursionlimit()` is 1000.

## 2. Null / None / undefined / Zero

- **Attribute access on `None`**: `obj.attr` where `obj` can be `None` → 
  `AttributeError`. Is `None` checked before use?
- **Subscript on `None`**: `obj["key"]` or `obj[0]` where `obj` can be `None`.
- **Division where denominator can be zero**: `x / denominator` where
  `denominator` can reach zero on valid inputs.
- **Modulo where divisor can be zero**: `x % n` raises `ZeroDivisionError`
  if `n == 0`.
- **`dict.get(key)` result used without `None` check**: `d.get("key").strip()`
  — if the key is absent, `.get()` returns `None` and `.strip()` raises
  `AttributeError`.
- **Zero passed where positive integer required**: chunk size of 0,
  `range(0, n, 0)` (raises `ValueError`), a timeout of 0 (may mean "no
  timeout" in some libraries).
- **`False`/`0` confused with "not set"**: using `if not value` when 0 or
  `False` is a valid and distinct value from "not provided".

## 3. Negative Inputs and Integer Overflow

- **Negative index**: Python wraps (`items[-1]` is the last element), but
  most other languages and some Python operations do not. Is a negative index
  intentional? Can a derived index go negative unexpectedly?
- **Negative size or count**: `bytes(n)` with `n < 0` raises `ValueError`.
  `range(-5)` produces an empty range silently. Is a negative count handled
  or rejected?
- **Negative duration or delay**: `time.sleep(-1)` raises `ValueError`. Can
  a computed duration go negative?
- **Integer overflow in typed languages**: `int8_t`, `uint16_t`, `int32_t`
  types in C/Go/Rust/TypeScript wrap or panic on overflow. Is arithmetic on
  user-controlled input bounds-checked?
- **Negative list slice**: `items[-n:]` is valid Python but may produce
  unexpected results if `n > len(items)` (returns the full list) vs. the
  caller's intent.

## 4. Unicode and Encoding

- **Byte length vs character length**: `len("héllo")` in Python is 5
  (characters), but the UTF-8 encoding is 6 bytes. Code that assumes
  `len(s) == len(s.encode("utf-8"))` is wrong for non-ASCII strings.
- **String truncation cutting a multi-byte character**: truncating to N bytes
  (e.g., for a database field limit) can split a multi-byte UTF-8 codepoint,
  producing an invalid byte sequence. Truncate to N characters or decode after
  truncation.
- **Emoji / combining characters**: an emoji like 🇺🇸 consists of two Unicode
  code points but renders as one glyph. `len("🇺🇸")` is 2. Splitting or
  slicing mid-codepoint produces mojibake.
- **`str.upper()` / `str.lower()` locale dependence**: the Turkish locale maps
  `I` ↔ `ı` (dotless i), breaking case-insensitive comparisons. Use
  `.casefold()` for locale-independent case folding.
- **Missing `encoding=` in `open()`**: relying on the platform default encoding
  (often UTF-8 on macOS/Linux, but CP1252 on Windows) makes the code
  platform-dependent. Always specify `encoding="utf-8"` (or the intended
  encoding).
- **`bytes.decode()` without error handler**: `b"\xff".decode("utf-8")` raises
  `UnicodeDecodeError`. Pass `errors="replace"` or `errors="ignore"` if the
  input may contain invalid bytes.

## 5. Timezone and DST

- **`datetime.now()` vs `datetime.utcnow()` vs `datetime.now(timezone.utc)`**:
  `datetime.now()` returns a naive local datetime. `datetime.utcnow()` returns
  a naive UTC datetime (deprecated in 3.12). Both lack timezone info; use
  `datetime.now(timezone.utc)` for an aware datetime.
- **Comparing naive and aware datetimes**: `naive_dt > aware_dt` raises
  `TypeError` in Python. Mixed comparisons silently produce wrong orderings
  in some environments.
- **DST ambiguous times**: during the fall-back transition, the clock goes from
  2:00 AM back to 1:00 AM — the hour from 1:00–2:00 AM occurs twice. A naive
  datetime in this range is ambiguous. Use `zoneinfo` / `pytz` with
  `is_dst=False` to disambiguate.
- **DST gap**: during the spring-forward transition, times between 2:00 AM and
  3:00 AM do not exist. Constructing such a datetime raises
  `pytz.exceptions.NonExistentTimeError` (or is silently adjusted, depending on
  the library).
- **Arithmetic on wall-clock times ignoring DST**: adding 24 hours to a local
  time may skip or double-count an hour across a DST boundary. Use
  `timedelta(days=1)` with a UTC-aware datetime, then convert to local time.
- **Storing timestamps as local time in the DB**: local timestamps are
  ambiguous across DST transitions. Store as UTC and convert for display.

## 6. Malformed and Untrusted Input (correctness framing)

This section covers inputs that cause the code to crash, hang, or produce
wrong results. It does NOT cover inputs that bypass authorization or exfiltrate
data (those are security concerns; see the Anti-Rule above).

- **JSON/YAML/XML parsing without error handling**: `json.loads(untrusted)` can
  raise `json.JSONDecodeError`. Is the parser call wrapped in a try/except?
- **Missing keys in parsed data**: assuming all fields are present after
  parsing — `data["user"]["id"]` raises `KeyError` if `user` or `id` is
  absent. Use `.get()` with a default, or validate with a schema first.
- **`int()` / `float()` parsing without `ValueError` handling**: `int("abc")`
  raises `ValueError`. User-supplied strings that are expected to be integers
  must be parsed defensively.
- **Regex catastrophic backtracking**: a regex pattern with ambiguous
  quantifiers (e.g., `(a+)+`) run against a crafted input causes exponential
  backtracking → the thread hangs.
  Example: `re.match(r"^(a+)+$", "a" * 30 + "!")` hangs.
- **Path traversal causing wrong file access** (correctness, not injection):
  `open(base_dir + user_input)` where `user_input = "../../etc/passwd"`
  reads the wrong file. The correctness concern is that the code reads/writes
  a file it did not intend to. Validate that the resolved path is within the
  intended directory.
- **Integer parsing of a floating-point string**: `int("3.14")` raises
  `ValueError`. Parse to float first if the input may be a decimal.
- **CSV injection via unescaped data**: data written to a CSV without escaping
  can break the CSV structure, producing corrupted output when parsed by a
  downstream system (correctness, not security — the concern is data integrity).
