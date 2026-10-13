# Webhook delivery runbook

1. Confirm `/api/health/ready` and Kafka connectivity.
2. As a tenant `platform_admin`, inspect `GET /api/v1/platform/integrations/webhooks/{id}/deliveries`.
3. `PENDING` deliveries are retried automatically with exponential backoff. `FAILED` means eight attempts were exhausted and requires operator action.
4. Check `last_status` and `last_error`. HTTP 4xx generally indicates receiver configuration/authentication; 5xx/timeouts indicate receiver availability.
5. Receiver verification uses the exact parsed JSON event payload plus the `x-aeroos-key-id`, `x-aeroos-signed-at`, `x-aeroos-payload-sha256`, and `x-aeroos-signature` headers. Fetch the current public key from `/api/platform/signing-key`.
6. Do not bypass HTTPS/private-address protections in production. If an internal integration is required, front it with an approved externally-addressable gateway or extend the network design explicitly.
