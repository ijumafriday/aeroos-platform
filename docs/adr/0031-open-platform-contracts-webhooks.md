# ADR-0031 — Versioned integration contracts and signed webhooks

## Decision

AeroOS exposes a deliberately small, stable integration surface under `/api/v1`. Internal UI/domain endpoints are not automatically declared public contracts. Public HTTP contracts are published as OpenAPI 3.1 and domain events as AsyncAPI 3.0.

Outbound webhooks are a Platform capability, not a business domain. Subscriptions are tenant-owned, RLS-protected records. Kafka events are enqueued durably into `platform.webhook_deliveries`; delivery is asynchronous so a slow partner cannot block domain consumers.

Every webhook body is the original `EventEnvelope`. AeroOS signs the canonical JSON payload with the same managed Ed25519 key service used for regulated signatures. Receivers verify `x-aeroos-*` signature headers with `/api/platform/signing-key`. Production endpoints must use HTTPS and are re-resolved before delivery; private, loopback and link-local destinations are rejected to reduce SSRF exposure. Redirects are not followed.

Retries use exponential backoff and stop after eight attempts. Delivery status is auditable per subscription. Subscription administration requires the `platform_admin` role; auditors have read-only access.

## Consequences

Business navigation is unchanged. Integrations remain cross-cutting infrastructure. New externally supported APIs must be added under a versioned prefix and to the OpenAPI contract; breaking event changes require a new Kafka topic version.
