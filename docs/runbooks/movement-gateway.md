# Runbook — Movement messages are not arriving / are rejected

Signals: Grafana *AeroOS — Operations* → movement messages per minute drops to zero, or *Rejected movement
messages* rises; OCC sees flights departing on the simulation only (no cyan underline on the timeline).

1. **Is anything arriving?** Grafana panel by source. Zero from `MVT` only → the Type B gateway; zero from
   `ACARS` only → the datalink provider.
2. **Authentication.** Gateway logs show HTTP 401 → wrong or rotated key. Keys are per operator in
   `MOVEMENT_API_KEYS` (`NKX=…,FJR=…`); a key only reports its own operator's flights. 503 → the variable is
   not set at all.
3. **Rejections.** Open a flight in the OCC → *Actual times* shows the message log with the reason. Typical:
   - `No flight NK682 on day 08` — flight number/day not in the schedule (schedule not loaded, wrong operator key);
   - `REG_MISMATCH` — the aircraft was swapped at the station but not in the OCC: swap the tail, then ask the
     station to resend (or type the MVT in the drawer);
   - `ALREADY_REPORTED` — a different time for an event already reported: the station must send `COR MVT`;
   - `MVT_FUTURE` — the station clock or the message time is wrong;
   - `TYPEB_ENVELOPE` — the gateway forwards a malformed Type B header.
4. **Fallback.** With `MOVEMENT_SIMULATION=true` flights without messages still move on estimates and land
   3 h after ETA if the arrival message is lost. In production (simulation off) controllers enter the MVT
   from the station's phone call in the flight drawer — it goes through the same checks and audit.
5. **Afterwards.** Rejected messages stay in the log with their raw text; nothing needs replaying unless the
   gateway itself lost messages, in which case resend from the gateway (repeats are ignored safely).
