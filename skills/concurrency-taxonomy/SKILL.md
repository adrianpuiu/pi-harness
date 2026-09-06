---
name: concurrency-taxonomy
description: >-
    Checklist of concurrency and async bug patterns for the concurrency-hunter agent. Do not invoke directly — force-preloaded into concurrency-hunter at startup. Triggers: Loaded automatically into the concurrency-hunter agent. Covers TOCTOU, data races, deadlock, missing await, blocking I/O in async, cancellation, and unbounded fan-out.
---

# Concurrency Bug Taxonomy

Checklist for the `concurrency-hunter` agent. Work through every section in
order; do not skip a section. Every confirmed item must be emitted as a finding
in the format defined by `finding-contract`.

## 1. TOCTOU (Time-of-Check / Time-of-Use) Races

- **Check-then-act on shared state**: read a condition, decide an action, then
  act — but the condition can change between check and act when multiple
  threads or coroutines are running.
  ```python
  if key not in cache:        # check
      cache[key] = compute()  # act — another thread may have added key
  ```
- **File existence check before creation/deletion**: `os.path.exists()` then
  `open()` — another process can create/delete the file in between.
- **Double-checked locking without memory barriers**: reading a flag outside
  a lock, then re-reading inside — only safe with `volatile`/`atomic` in C/Java,
  not with plain Python dicts.

## 2. Data Races and Lost Updates

- **Shared mutable state without lock**: a module-level dict, list, or counter
  modified by multiple threads without a `threading.Lock` (or equivalent).
- **Read-modify-write without atomicity**: `count += 1` expands to read +
  increment + write — three non-atomic steps. Under concurrent access this
  produces a lost update.
- **Lost update pattern**: two threads (or coroutines) read the same value,
  both compute an update, both write back — one update is lost.
  ```
  Thread A: read balance=100 → compute 100+50=150
  Thread B: read balance=100 → compute 100-30=70
  Thread A: write 150   # B's update lost — balance should be 120
  Thread B: write 70
  ```
- **Stale read**: a thread reads a value that was updated by another thread
  but the read is not synchronized — no guarantee the local view is current.

## 3. Deadlock and Lock Ordering

- **Inconsistent lock acquisition order**: thread A acquires lock1 then lock2;
  thread B acquires lock2 then lock1 → classic AB/BA deadlock.
- **Lock held across I/O or long computation**: holding a lock while calling
  a blocking network/DB operation starves all other threads waiting for the
  same lock.
- **Callback invoked while holding a lock**: a callback is called inside a
  locked section, and the callback itself tries to acquire the same lock →
  re-entrant deadlock on a non-reentrant lock.
- **Recursive lock with non-reentrant `Lock`**: a function holding a
  `threading.Lock` calls itself (directly or via a helper) → deadlock.
  Use `threading.RLock` for re-entrant scenarios.
- **`asyncio.Lock` held across `await`**: an asyncio lock held across an
  `await` is safe (other coroutines can run), but holding a *thread* lock
  across `await` blocks the event loop.

## 4. Missing `await` / Forgotten Coroutines

- **Coroutine called without `await`**: `result = my_coro()` creates a
  coroutine object but does not execute it. Python emits a
  `RuntimeWarning: coroutine was never awaited`, but only at GC time —
  by then, the call has silently been skipped.
- **`asyncio.create_task()` result discarded**: if the `Task` object is not
  stored in a variable or awaited, it may be garbage-collected before it runs,
  silently dropping the work and suppressing its exception.
- **`asyncio.gather()` or `asyncio.wait()` not awaited**: the gather call
  itself is a coroutine and must be awaited; calling it without `await` is
  the same as the first case.
- **Fire-and-forget task with no error handling**: a task started with
  `asyncio.create_task()` that raises an exception has that exception silently
  swallowed unless retrieved from the `Task` or registered with a callback.

## 5. Blocking I/O in Async Context

Blocking calls on the asyncio event loop stall all other coroutines for the
duration of the call, causing latency degradation or starvation.

- **`time.sleep()`** in an async function — use `await asyncio.sleep()`.
- **Synchronous DB driver** (e.g., `psycopg2`, synchronous SQLAlchemy) called
  from an async handler — use an async driver (`asyncpg`, `SQLAlchemy 2.0`
  async) or offload with `asyncio.to_thread()`.
- **`requests.get()` / `urllib.request.urlopen()`** in an async function —
  use `httpx.AsyncClient` or `aiohttp`.
- **`subprocess.run()` / `subprocess.check_output()`** — use
  `asyncio.create_subprocess_exec()` or offload.
- **CPU-bound work** (image processing, cryptography, parsing) on the event
  loop without offloading to a thread or process pool — use
  `loop.run_in_executor()`.
- **Blocking file I/O** (`open()` / `.read()`) on the event loop — use
  `asyncio.to_thread()` or an async file library.

## 6. Cancellation Handling

- **`CancelledError` swallowed by `except Exception`**: in Python 3.8+,
  `CancelledError` inherits from `BaseException`, not `Exception` — bare
  `except Exception` does *not* catch it. In 3.7 and earlier it inherits from
  `Exception` and *is* caught. Verify the Python version and handler scope.
- **Cleanup skipped on cancellation**: if a coroutine is cancelled inside a
  `try` block, the `except` and `finally` run — but if the handler swallows
  the `CancelledError`, the task never finishes cancelling and the task group
  hangs waiting for it.
- **Resource not released on cancel**: a file, lock, or connection opened
  inside the `try` block must be closed in `finally`. If `finally` raises,
  the `CancelledError` is lost.
- **`TaskGroup` exits before children complete**: in Python 3.11+
  `asyncio.TaskGroup`, if the body exits normally while child tasks are still
  running, the group waits — but if a child task raises, all siblings are
  cancelled. Ensure all critical cleanup is in `finally`.

## 7. Unbounded Fan-out and Concurrency

- **`asyncio.gather(*[task(item) for item in huge_list])`**: creates one task
  per item with no upper bound on concurrency — can exhaust file descriptors,
  DB connections, or memory.
- **Missing `asyncio.Semaphore`**: fan-out without a semaphore to cap
  concurrency. Bound it:
  ```python
  sem = asyncio.Semaphore(MAX_CONCURRENT)
  async with sem:
      await task(item)
  ```
- **Thread pool with unbounded queue**: `ThreadPoolExecutor` with
  `max_workers=None` (defaults to CPU×5) — may still create an unbounded
  submit backlog if the caller submits faster than workers drain.
- **`asyncio.Queue` without `maxsize`**: a producer–consumer queue with
  `maxsize=0` (unbounded) — if the producer outpaces the consumer, memory
  grows without bound. Set `maxsize` and use `put()` (blocking) instead of
  `put_nowait()`.
- **Goroutine leak (Go)**: a goroutine blocked on a channel send/receive that
  will never complete — the goroutine is leaked and cannot be GC'd.
