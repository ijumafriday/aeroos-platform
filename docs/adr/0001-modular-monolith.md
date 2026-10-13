# ADR-0001 — Modular monolith on NestJS, one database schema per module

**Status:** accepted · **Date:** 2026-10

## Context
AeroOS spans Flight Ops/OCC, CAMO, AMO/Part-145 and Organization Core. Each is a regulated domain with its
own approvals, auditors and change cadence. Starting with microservices would buy deployment independence we do
not yet need, at the price of distributed transactions, network failure modes and a heavy platform tax on a small team.

## Decision
- One deployable API (`apps/api`), NestJS 10 on Fastify, organised as modules: `platform`, `compliance`, `org`, `camo`, `amo` (later `ops`).
- **Each module owns a PostgreSQL schema and a database role.** The `camo_svc` role cannot read `amo.*` tables and vice versa;
  this is enforced by grants in the migrations, not by convention.
- Modules talk through (a) **domain events** on Kafka via the transactional outbox, or (b) a small number of **exported query services**
  (e.g. `PersonnelQuery`). Never by importing another module's tables or repositories — enforced by `eslint.config.mjs`.
- Regulated logic lives in framework-free packages (`packages/compliance`, `packages/mro-domain`, `packages/audit`, `packages/signing`)
  that import no NestJS, Drizzle, Kafka, Temporal or React — also lint-enforced.
- Transactions: `ModuleDb.tx()` holds the transaction in `AsyncLocalStorage`, so repositories, the outbox and the audit writer join the same
  transaction without passing a handle around. This is the single, uniform transaction pattern for Drizzle inside Nest.

## Consequences
- Any module can be extracted into its own service later: it already owns its schema, role, topics and contracts.
- One build, one deploy, one place to debug. Horizontal scaling is by replicas of the whole API.
- Cross-module reads are deliberately awkward; that friction is the point.
