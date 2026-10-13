# ADR-0020 — Safety management, quality audits, corrective actions, non-conforming parts

> **Superseded in part by ADR-0029 (0.17.0):** Safety and Quality are now independent top-level domains with separate manager roles and domain-scoped action routes. The rules below remain historical design context.

**Status:** accepted · **Date:** 2026-10

## Where it lives
Safety and quality are organisation-level systems (ORO.GEN.200, CAMO.A.200/202, 145.A.65/200), so they are
part of the Organization module (`org` schema, `org_svc` role) — no new database role or service. Non-conforming
parts belong to stores (AMO, `amo` schema); CAMO learns about scrapped serials from an event.

## Safety reports (ORO.GEN.200, EU 376/2014)
- Anyone reports; reports are handled under a just culture and may be **confidential**: the reporter's name is
  shown only to the safety office (quality manager) and the reporter, the audit trail records
  `confidential-reporter` as actor, and operator-wide notifications never carry the title or the name.
- Triage assesses risk on the ICAO 5×5 matrix (Doc 9859); tolerable or intolerable risk requires an
  investigator (a person on the register, who can then read that report). Mandatory occurrences must be filed
  with the authority within 72 hours; overdue filings are flagged.
- Closure requires: risk assessed, MOR filed if mandatory, investigation findings when investigated, all
  corrective actions verified, residual risk not intolerable.

## Audits and findings (compliance monitoring)
- Audits are planned against references; findings are level 1 (7 days), level 2 (90 days) or observations
  (180 days). Closure needs a root cause and verified actions; a level 1 finding is closed by someone other than
  the auditor who raised it. An audit closes with its last finding.

## Corrective actions (shared)
- Assigned to a person on the register with a due date; the owner completes it with evidence; the quality
  manager verifies effectiveness — never the person who did the work (domain rule and a database CHECK).
  Actions are readable by their owner and the quality office, not by all staff.

## Non-conforming parts and scrapping (145.A.42)
- Quarantine takes only **free** stock off the shelf (reserved parts stay with their task cards).
- Disposition by engineering: scrap, return to vendor, or return to stock with a release certificate.
- Scrapping requires mutilation witnessed by a second person (domain rule and CHECK); `amo.part.scrapped`
  makes CAMO add a SCRAPPED event to the serial's back-to-birth history, and an installation of that serial is
  refused for ever. A scrap of a serial in another operator's records is not recorded and is flagged.

## Required reading at signing (145.A.30(e), 145.A.65(b))
- Documents flagged `required_for_certification` (and distributed to certifying staff) must have their effective
  revision acknowledged before a certifying engineer can stamp a step or issue a CRS, after a 14-day grace period.
