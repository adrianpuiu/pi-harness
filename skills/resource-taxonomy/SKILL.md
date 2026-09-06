---
name: resource-taxonomy
description: >-
    Checklist of resource-leak, unbounded-growth, and performance-at-scale bug patterns for the resource-hunter agent. Do not invoke directly — force-preloaded into resource-hunter at startup. Triggers: Loaded automatically into the resource-hunter agent. Covers resource leaks, unbounded caches, hidden materialization, missing timeouts, retry amplification, and O(n²) complexity.
---

# Resource Bug Taxonomy

Checklist for the `resource-hunter` agent. Work through every section in
order; do not skip a section. Every confirmed item must be emitted as a finding
in the format defined by `finding-contract`.

## 1. Resource Leaks

Resources that are opened but not always closed produce leaks that accumulate
until the process exhausts OS limits.

- **File handle not closed**: `open()` used without a `with` statement and
  without explicit `.close()` in a `finally` block. Any exception path that
  bypasses `.close()` is a leak.
- **Socket / network connection not closed**: `socket.socket()`,
  `http.client.HTTPConnection`, or similar not closed in the exception path.
  Check all `except` branches, not just the happy path.
- **Database connection not returned to pool**: a connection acquired from a
  pool (e.g., SQLAlchemy `Session`, `asyncpg` pool) not released if an
  exception is raised before `.close()` or `__exit__`.
- **Thread not joined or terminated**: a `threading.Thread` started but never
  `.join()`-ed — the thread may outlive the object that spawned it, preventing
  GC of captured references.
- **`subprocess.Popen` not cleaned up**: a `Popen` object not `.wait()`-ed or
  `.kill()`-ed — the child becomes a zombie process.
- **Temporary file not deleted**: `tempfile.mktemp()` (deprecated, not
  auto-deleted) or `NamedTemporaryFile(delete=False)` without explicit
  deletion.
- **Context manager protocol violated**: an object implementing `__enter__` /
  `__exit__` used without `with` — `__exit__` (and its cleanup) is never
  called.

## 2. Unbounded Caches and Growth → OOM

- **Module-level dict/list accumulating items with no eviction**: a
  `_cache = {}` or `_results = []` at module or class level that is appended
  to on every request with no size cap or TTL — grows until OOM.
- **`functools.lru_cache` without `maxsize`**: `@lru_cache()` or
  `@lru_cache(maxsize=None)` caches every unique argument combination ever
  seen. If the argument space is large or unbounded, memory grows without
  limit.
- **Per-request state in global scope**: storing per-request or per-user data
  in a module-level variable means it accumulates across requests. Under load,
  old entries are never evicted.
- **Growing set/dict in a hot path**: `seen.add(item)` inside a request
  handler where `seen` is not cleared between requests — the set grows with
  every unique item ever processed.
- **`weakref` not used for observer/listener registries**: a registry holding
  strong references to subscribers prevents GC of unsubscribed objects.

## 3. Hidden Materialization

Lazy iterables are silently converted to in-memory lists, causing large or
unbounded memory use.

- **`list(generator)` or `tuple(generator)`**: materializes the full generator
  output before any processing. If the generator is unbounded or large, this
  is an OOM risk.
- **`sorted(large_iterable)`**: sorts by materializing the entire iterable
  into a list first.
- **`json.dumps(large_object)` / `df.to_json()`**: the entire object is
  serialized into a single in-memory string before being written.
- **`.read()` or `.readlines()` on a large file**: reads the entire file into
  memory. Prefer iterating over the file object line-by-line, or use
  chunked reads.
- **`[x for x in range(10**7)]`**: a large list comprehension that could be
  a generator expression `(x for x in range(10**7))`.
- **`*args` unpacking from a large iterable**: `func(*large_list)` or
  `[*generator]` materializes the iterable for argument unpacking.
- **`.fetchall()` on a DB cursor**: fetches the entire result set into memory.
  Use `.fetchone()`, `.fetchmany(size)`, or iterate the cursor directly.

## 4. Missing Timeouts on External Calls

A call that can hang indefinitely blocks a thread (or event-loop coroutine)
forever if the remote end is slow or dead.

- **`requests.get(url)` without `timeout`**: hangs indefinitely if the server
  never responds. Always pass `timeout=(connect_timeout, read_timeout)`.
- **`socket.recv()` without `socket.settimeout()`**: blocks until data arrives
  or the connection is closed.
- **Synchronous DB query without statement timeout**: a slow query blocks the
  thread. Set `statement_timeout` (PostgreSQL) or query timeout on the
  connection.
- **`subprocess.run()` / `Popen.wait()` without `timeout`**: the child process
  hangs — the thread blocks forever. Pass `timeout=` and handle
  `subprocess.TimeoutExpired`.
- **gRPC / async HTTP without deadline**: gRPC calls without a deadline may
  block indefinitely on the server side. Always set a deadline in the
  `CallOptions`.
- **Missing circuit breaker**: repeated calls to a failing external service
  with no circuit breaker accumulate slow blocked threads until the thread
  pool is exhausted.

## 5. Retry Amplification

Retry logic without proper controls transforms a failure into a thundering
herd or an exponential cost spike.

- **Retry loop without exponential backoff**: retrying at a fixed interval
  on a shared external resource causes a synchronized thundering herd on
  every retry wave.
- **Retry count × item count**: a per-item retry inside a loop over N items →
  O(N × retries) calls in the worst case. Can multiply a 1-second outage into
  minutes of load.
- **No jitter on retry**: all clients retry at the same intervals — even with
  exponential backoff, synchronized clients remain synchronized. Add random
  jitter to desynchronize.
- **Retry on non-idempotent operations**: retrying a non-idempotent write (e.g.,
  `INSERT` without `ON CONFLICT`, `POST` that creates a resource) on timeout
  may create duplicate records.
- **Unbounded retry count**: `while True: retry()` with no maximum retry limit
  or circuit breaker — a permanently failing dependency causes an infinite loop.

## 6. Algorithmic Complexity

- **O(n²): nested loop over the same collection**:
  ```python
  for i in items:
      for j in items:   # O(n²) — is this intentional?
  ```
  Common in deduplication, similarity checks, and naive graph traversal.
- **O(n²): `item in list` inside a loop**: `list.__contains__` is O(n), making
  `for x in items: if x in other_list` O(n²). Replace `other_list` with a
  `set` for O(1) lookup.
- **O(n log n) sort in a hot inner loop**: sorting a list on every iteration
  when the list changes only occasionally — sort once and update incrementally
  (use `bisect.insort`).
- **Linear scan in sorted data**: iterating through a sorted list to find an
  element where `bisect.bisect_left` (O(log n)) would work.
- **String concatenation in a loop**:
  ```python
  result = ""
  for s in strings:
      result += s   # O(n²) — each += copies the whole string
  ```
  Use `"".join(strings)` instead.
- **Re-computing an invariant inside a loop**: computing `len(large_list)`,
  `max(items)`, or a regex compilation on every iteration when the value does
  not change.
