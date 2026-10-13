# AeroOS Maintenance Depth Register — 0.37.0

Maintenance is treated as one durable business domain. The top-level product navigation remains compact: **Maintenance Control**, **Planning & Work Packages**, and **Task Cards & Certification**. Line, base production, shift handover, tooling, shops, AOG, station capability, workforce, outsourced work and customer/SLA controls are contextual capabilities inside those objects rather than additional sidebar workflows.

`docs/MNT-DEPTH-REGISTER.json` is the machine-readable scope baseline. It currently contains **59 implemented Maintenance capabilities** spanning work orders, workforce, line maintenance, base/heavy maintenance, production, task execution, certification, tool crib, component/engine shops, AOG, station capability, contract/SLA control, material kitting, security, audit, isolation and offline field work.

“IMPLEMENTED” in this domain register means production code, persistence, authorization/audit controls and a usable API/UI path exist. It does **not** override the global assurance rule: where the master deficiency register requires runtime, independent, authority or operator evidence, that item remains PARTIAL or EXTERNAL until the evidence exists.
