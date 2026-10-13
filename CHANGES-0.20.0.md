# AeroOS 0.20.0 — Open Platform

- Adds the first stable `/api/v1` integration surface and machine-readable OpenAPI 3.1 contract.
- Publishes the current versioned Kafka event catalogue as AsyncAPI 3.0 and a machine-readable event-type list.
- Adds tenant-scoped outbound webhook subscriptions and durable delivery history (migration 0031).
- Signs webhook event payloads with the platform Ed25519 signing key; receivers can verify independently.
- Adds bounded retry/backoff, terminal failure state, no redirects, HTTPS enforcement in production, and DNS/private-address SSRF defenses.
- Adds dedicated `platform_admin` authorization for integration management; auditors may inspect configuration/delivery history.
- Keeps integrations in Platform; no business-domain navigation or workflow pages were added.
