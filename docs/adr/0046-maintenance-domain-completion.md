# ADR 0046 — Maintenance domain completion without navigation fragmentation

**Status:** Accepted  
**Release:** AeroOS 0.37.0

## Decision

Maintenance remains one durable AeroOS domain. Line maintenance, base/heavy production control, work orders, shift handover, tooling, component/engine shop control, AOG coordination, workforce allocation, material kitting, station capability and maintenance-contract controls are implemented as first-class Maintenance objects but are surfaced contextually through a compact Maintenance workspace.

The main navigation is limited to **Maintenance Control**, **Planning & Work Packages**, and **Task Cards & Certification**. Workflow states are actions on authoritative objects and do not become navigation destinations.

## Domain ownership

Maintenance owns work execution, production state, shop production, tool custody, workforce allocation, line/base control and shift handover. Supply remains authoritative for inventory/procurement; Organization remains authoritative for personnel; Engineering remains authoritative for approved configuration/technical disposition; Technical Records remains authoritative for retained evidence. Maintenance stores references to those objects rather than shadow copies.

Certification authority remains separate from ordinary execution roles. Mechanics may record work, supervisors control production, planners control planning/work orders, and tool controllers manage tool custody. CRS/passkey/signature authority remains with authorized certifying staff.

## Completion evidence

`docs/MNT-DEPTH-REGISTER.json` is the Maintenance software-scope register. Its IMPLEMENTED state means the capability has persisted domain data, authorization, audit behavior, API/service logic and user-facing access where applicable. It does not supersede global production/authority evidence requirements in the master deficiency register.
