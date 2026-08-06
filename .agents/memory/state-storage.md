---
name: State storage (Postgres kv_store)
description: How the app persists its single state blob and why all mutations must be transactional.
---

# State persistence

The app stores everything under two rows in `kv_store` (`key` text PK, `value` jsonb):
`'state'` (the whole scheduler state: employees, jobs, availability, assignments, version)
and `'published'` (the crew-facing snapshot). Backups of the `state` blob go to
`state_backups`, pruned to the most recent `MAX_BACKUPS`.

## Rule: every write to the `state` blob must go through `withStateTxn(fn)`

Never do a bare read-then-`writeKV('state', ...)`. The whole state is one JSONB
blob, so a read-modify-write done as separate ops lets concurrent writers clobber
each other (last-writer-wins) and silently defeats the version-based optimistic
concurrency (the 409 "stale" check). `withStateTxn` opens a pool client, `BEGIN`,
takes a transaction-scoped `pg_advisory_xact_lock(hashtext('kv_store:state'))`,
reads the row, runs `fn(state)`, backs up the previous committed value, upserts,
`COMMIT` (ROLLBACK on error, release in finally). `fn` returns the object to
persist, or `null`/`undefined` to skip the write entirely (e.g. token already exists).

**Why:** an architect review flagged the non-atomic RMW as a real lost-update
bug; the advisory lock serializes all state mutations. Verified with 10 parallel
submits incrementing `version` by exactly 10.

**How to apply:** any new endpoint that changes employees/jobs/availability/etc.
must wrap its mutation in `withStateTxn`. Phone-authenticated crew endpoints must
re-check `phoneDigits(emp.phone)` against the submitted phone *inside* the txn
(auth happens before the txn, so the roster could change in between — TOCTOU).

## Rule: recovery baseline must match `loadState`

If the `state` row is ever missing but `state_backups` has rows, both reads
(`loadState`) and the first write (`withStateTxn`) must baseline from the latest
backup, not from `defaultState()` — otherwise the first write overwrites
recoverable data with defaults.

## Schema ownership

The `kv_store` / `state_backups` tables are owned by the environment (created via
Replit's managed DB tooling in dev, applied to prod by the Publish schema-diff
flow). The app must NOT run startup DDL. On a fresh/empty DB the app only *seeds*
the two blobs from the legacy `data/state.json` / `data/published.json` files.
