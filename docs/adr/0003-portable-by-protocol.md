# ADR-0003 — Portable by protocol: no proprietary cloud services

**Status:** accepted · **Date:** 2026-10

## Context
Customers include airlines that must self-host (sovereignty, regulator access) and others happy on any public cloud.
Proprietary managed services (DynamoDB, SQS, Cognito, Step Functions…) would make the product un-shippable to the first group.

## Decision
Depend on **protocols**, not providers:

| Need | Protocol / product | Cloud profile | Self-hosted profile |
|---|---|---|---|
| Relational + spatial | PostgreSQL 16 + PostGIS | any managed Postgres | CloudNativePG |
| Events | Kafka protocol | any managed Kafka / Redpanda | Strimzi |
| Workflows | Temporal | Temporal Cloud or self-run | Temporal Helm subchart |
| Identity | OIDC | Keycloak (or customer IdP federated into it) | Keycloak operator |
| Authorisation | Cerbos (policy-as-code) | sidecar/service | same |
| Objects | S3 API (incl. Object Lock) | any S3 | MinIO / Ceph RGW |
| Signing keys | Vault Transit HTTP API | OpenBao / Vault (cloud-KMS auto-unseal) | OpenBao sealed by the customer's HSM (ADR-0006) |
| Telemetry | OTLP | any OpenTelemetry backend | collector + Tempo + Prometheus + Grafana |
| Runtime | Kubernetes + Helm | `values-cloud.yaml` | `values-selfhosted.yaml` |

Docker Compose mirrors the self-hosted profile for developers.

## Consequences
- One Helm chart, two values files. No code path differs between clouds.
- We operate more moving parts in self-hosted mode; operators (CNPG, Strimzi, Keycloak) carry most of that weight.
