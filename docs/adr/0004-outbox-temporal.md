# ADR-0004 — Facts on Kafka via the outbox; long-running commands on Temporal

**Status:** accepted · **Date:** 2026-10

## Context
A MEL deferral must (a) be visible to other domains immediately and exactly once, and (b) escalate at T-24h, T-6h and expiry even if
pods restart for days. Publishing to Kafka inside a request, or using timers in process, loses events and timers.

## Decision
- **Facts → Kafka.** A state change and its event are written in the **same database transaction** (`platform.outbox`). The `OutboxRelay`
  claims rows with `FOR UPDATE SKIP LOCKED` and publishes to versioned topics (`aeroos.camo.v1`, `aeroos.amo.v1`, `aeroos.platform.v1`),
  keyed by aggregate id for ordering.
- **Consumers are idempotent** via `platform.inbox` (consumer group + event id). Poison messages go to `platform.dead_letters` after 8 attempts.
- **Commands with time → Temporal.** `melDeferralWorkflow` sleeps until each escalation level, accepts `extended` / `closed` signals,
  and ends when the item is no longer open. The worker has **no database credentials**; activities call internal API endpoints guarded by
  an internal token, so all writes still go through the module's service, audit and outbox.
- Temporal workflows are started from a Kafka consumer of `camo.mel.deferred`, not inside the HTTP request — so a Temporal outage never
  blocks raising a deferral; the workflow starts when Temporal is back.

## Consequences
- At-least-once delivery everywhere, exactly-once effects through inbox dedupe and natural keys (`UNIQUE(source_type, source_id)` on task cards).
- Out-of-order events are tolerated: the workflow re-reads state on each escalation.
