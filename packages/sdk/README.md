# @aeroos/sdk

Typed integration client for AeroOS's supported `/api/v1` boundary and signed outbound webhooks.

The SDK deliberately does not expose internal browser/domain endpoints as stable contracts. Operator integrations should use the versioned API described by the bundled OpenAPI/AsyncAPI documents.

```ts
import { AeroOsClient, verifyWebhook, webhookHeaders } from '@aeroos/sdk';

const aeroos = new AeroOsClient({ baseUrl: 'https://aeroos.example', token });
const hooks = await aeroos.webhooks();
await aeroos.createWebhook('ops-events', 'https://partner.example/aeroos', ['ops.flight.updated']);
```

Provider adapters use their dedicated integration key, separate from user bearer tokens:

```ts
await aeroos.submitOperationalFlightPlan(process.env.AEROOS_OPS_PROVIDER_KEY!, ofpPayload);
await aeroos.submitFrmsAssessment(process.env.AEROOS_FRMS_PROVIDER_KEY!, assessmentPayload);
```

For incoming AeroOS webhook events, reconstruct the signature headers with `webhookHeaders()` and call `verifyWebhook()` with the configured AeroOS Ed25519 public key before processing the event. Consumers should also deduplicate by the event envelope ID.
