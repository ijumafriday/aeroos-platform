# ADR-0002 — Regulatory rules as versioned, per-authority rulepacks

**Status:** accepted · **Date:** 2026-10

## Context
Direction given: certify under EASA, mirror FAA. EASA compliance does **not** imply FAA compliance — Part-66 vs
14 CFR Part 65, ORO.FTL vs Part 117, MEL extension rules all differ. Rules also change over time, and an auditor must be able
to ask "which rule produced this deadline, under which version, on which date?".

## Decision
- `packages/compliance` holds a **ComplianceEngine** and one **rulepack per authority** (`EASA@2026.1`, `FAA@2026.1-draft`).
- Rulepacks are **effective-dated and versioned**. A rulepack has a status; `draft` packs are refused unless `allowDraft` is passed
  (tests and simulation only). FAA ships as draft until reviewed by a qualified FAA compliance person.
- **Operator overlays** (approved MEL, IANA time zone, approved types, company authorisations) are data in the `compliance` / `org` schemas,
  not code.
- Every calculation returns a `Decision { value, rule, basis }` — the value, the rule identifier (e.g. `EASA@2026.1:MEL.CAT_C_DAYS`) and the
  facts used. Decisions are written into the audit record of the action that used them.
- **Cerbos decides *who may do* an action; the compliance engine decides *what the regulation says*.** Cerbos never calculates deadlines,
  and the engine never checks roles. Where an authorisation depends on a regulatory fact (licence coverage), the API computes the fact
  with the engine and passes it to Cerbos as an attribute.

## Consequences
- Adding an authority (UK CAA, GCAA, KCAA…) is a new rulepack plus golden tests, not a fork.
- Golden tests (28 today) are the regulatory specification; a rule change is a reviewed diff to a rulepack and its tests.
- Time handling is centralised: calendar-day limits are counted in the operator's time zone, excluding the day of discovery, DST-safe.
