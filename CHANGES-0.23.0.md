# AeroOS 0.23.0 — Offline Field Operations

## Maintenance field work
- Encrypted IndexedDB snapshots allow previously viewed AeroOS GET data to remain available when disconnected.
- Task-card field observations can be captured offline and replayed after reconnection with a persistent mutation id.
- Field notes are auditable server records and are deliberately distinct from certification stamps.
- Step signatures and CRS issuance remain online-only because authorization, compliance and passkey verification are server-bound controls.
- Task-card photos/PDF evidence can be encrypted locally and queued for the existing immutable document pipeline.

## Stores
- Stock receipts can be queued while disconnected and replay with the original idempotency key.
- Camera capture plus the browser BarcodeDetector API supports QR/barcode part identification where the device supports it.

## Field client / PWA
- Installable web manifest and service worker cache the application shell; authenticated API data is never put in the service-worker cache.
- Offline API snapshots, mutation payloads and queued evidence are encrypted with a non-exportable AES-GCM device key stored by the browser.
- Reconnect synchronization surfaces HTTP 409 conflicts rather than overwriting authoritative server state.
- Failed/conflicted queue items remain visible for review; retry stops on connectivity/server failures.

## Database and authorization
- Migration 0035 adds tenant-RLS-protected `amo.task_card_field_notes` with client mutation de-duplication.
- `certifying_staff` may add field notes to open/in-progress task cards, but not certified cards.
