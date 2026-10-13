# AeroOS performance and soak assurance

These profiles run only against a non-production environment with representative data. They never create synthetic regulatory records or weaken authorization.

## Representative mixed load

```sh
ACCESS_TOKEN='...' OPERATOR=NKX BASE_URL=https://aeroos.test.example \
VUS=200 DURATION=15m scripts/assurance/run-load.sh major-airline
```

The profile exercises Platform, Operations, Crew, CAMO/Maintenance, Supply, Technical Records, Engineering and federated search. Default gates are <0.5% HTTP failures, p95 <1.2 s and p99 <3 s, with tighter per-domain thresholds where defined.

## Soak

```sh
ACCESS_TOKEN='...' OPERATOR=NKX BASE_URL=https://aeroos.test.example \
VUS=75 DURATION=4h scripts/assurance/run-load.sh soak
```

Use a minimum four-hour run for release evidence and a 24-hour run before major production upgrades.

## Dataset qualification

`tests/assurance/scale-targets.json` defines the minimum data volume for the major-airline qualification profile. Point `DATABASE_URL` at the performance environment and run:

```sh
DATABASE_URL='postgresql://...' scripts/assurance/qualify-dataset.py
```

A load result is not labelled major-airline evidence unless the dataset qualification passes.

## Concurrency/idempotency

```sh
ACCESS_TOKEN='...' OPERATOR=NKX BASE_URL=https://aeroos.test.example \
scripts/assurance/concurrency-idempotency.sh
```

This sends concurrent POSTs with one idempotency key and then verifies a committed replay. It uses the side-effect-safe notification read-all command.

## Dependency failure drills

For the Docker Compose reference stack:

```sh
scripts/assurance/failure-drill.sh postgres
scripts/assurance/failure-drill.sh temporal
scripts/assurance/failure-drill.sh minio
```

Each drill proves process liveness remains healthy, readiness fails closed while a regulated-write dependency is unavailable, and readiness recovers within `RTO_SECONDS` (120 s by default).
