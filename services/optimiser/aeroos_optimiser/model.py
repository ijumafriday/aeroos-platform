"""
Problem and solution model, shared by both solvers, plus an independent feasibility checker.

The JSON contract mirrors `RecoveryProblem` / `RecoverySolution` in packages/contracts. All times are
UTC epoch minutes. The API re-checks every solution with its own TypeScript checker before showing it,
so this file and packages/ops-domain/src/recovery.ts must agree — tests on both sides use the same fixture.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class Tail:
    reg: str
    type: str
    location: str
    available_from: int
    dispatchable: bool


@dataclass(frozen=True)
class Flight:
    id: str
    flight_no: str
    dep: str
    arr: str
    std: int
    block: int
    tail: str
    type: str
    #: Current ETD: a delay the OCC already entered is a lower bound for the solver.
    earliest: int = 0


@dataclass(frozen=True)
class Problem:
    run_id: str
    horizon_start: int
    horizon_end: int
    min_turn: int
    max_delay: int
    delay_cost: float
    cancel_cost: float
    swap_cost: float
    tails: tuple[Tail, ...]
    flights: tuple[Flight, ...]

    @staticmethod
    def from_json(p: dict[str, Any]) -> "Problem":
        c = p.get("costs", {})
        return Problem(
            run_id=p["runId"],
            horizon_start=int(p["horizonStart"]),
            horizon_end=int(p["horizonEnd"]),
            min_turn=int(p["minTurnMinutes"]),
            max_delay=int(p["maxDelayMinutes"]),
            delay_cost=float(c.get("delayPerMinute", 1)),
            cancel_cost=float(c.get("cancel", 600)),
            swap_cost=float(c.get("swap", 20)),
            tails=tuple(Tail(t["reg"], t["type"], t["location"], int(t["availableFrom"]), bool(t["dispatchable"])) for t in p["tails"]),
            flights=tuple(
                Flight(f["id"], f["flightNo"], f["dep"], f["arr"], int(f["std"]), int(f["blockMinutes"]), f["tail"], f["type"], int(f.get("earliest", f["std"])))
                for f in sorted(p["flights"], key=lambda f: (f["std"], f["id"]))
            ),
        )

    def usable(self, f: Flight, t: Tail) -> bool:
        return t.dispatchable and t.type == f.type

    def latest(self, f: Flight) -> int:
        """Latest allowed departure: STD + max delay, never before the current ETD."""
        return f.std + max(self.max_delay, f.earliest - f.std)


@dataclass(frozen=True)
class Assignment:
    flight_id: str
    tail: Optional[str]  # None = cancelled
    start: Optional[int]


def objective(p: Problem, assignments: list[Assignment]) -> float:
    by_id = {f.id: f for f in p.flights}
    total = 0.0
    for a in assignments:
        f = by_id[a.flight_id]
        if a.tail is None:
            total += p.cancel_cost
            continue
        total += p.delay_cost * ((a.start if a.start is not None else f.earliest) - f.std)
        if a.tail != f.tail:
            total += p.swap_cost
    return total


def check(p: Problem, assignments: list[Assignment]) -> list[str]:
    """Independent feasibility check. Empty list = feasible."""
    issues: list[str] = []
    tails = {t.reg: t for t in p.tails}
    flights = {f.id: f for f in p.flights}
    seen: set[str] = set()
    per_tail: dict[str, list[tuple[int, Flight]]] = {}
    for a in assignments:
        f = flights.get(a.flight_id)
        if f is None:
            issues.append(f"Unknown flight {a.flight_id}")
            continue
        if f.id in seen:
            issues.append(f"{f.flight_no} assigned twice")
        seen.add(f.id)
        if a.tail is None:
            continue
        t = tails.get(a.tail)
        if t is None:
            issues.append(f"{f.flight_no} on unknown tail {a.tail}")
            continue
        if t.type != f.type:
            issues.append(f"{f.flight_no} needs a {f.type}, {t.reg} is a {t.type}")
        if not t.dispatchable:
            issues.append(f"{f.flight_no} assigned to non-dispatchable {t.reg}")
        if a.start is None or a.start < f.earliest:
            issues.append(f"{f.flight_no} departs before its current ETD")
        elif a.start > p.latest(f):
            issues.append(f"{f.flight_no} delayed beyond {p.max_delay} min")
        per_tail.setdefault(t.reg, []).append((a.start if a.start is not None else f.earliest, f))
    for f in p.flights:
        if f.id not in seen:
            issues.append(f"{f.flight_no} missing from the solution")
    for reg, seq in per_tail.items():
        t = tails[reg]
        loc, free = t.location, t.available_from
        for start, f in sorted(seq, key=lambda x: x[0]):
            if f.dep != loc:
                issues.append(f"{reg} is at {loc} but {f.flight_no} departs {f.dep}")
            if start < free:
                issues.append(f"{f.flight_no} on {reg} departs before the aircraft is ready")
            loc, free = f.arr, start + f.block + p.min_turn
    return issues


def to_json(p: Problem, assignments: list[Assignment], solver: str, status: str, wall: float) -> dict[str, Any]:
    return {
        "runId": p.run_id,
        "solver": solver,
        "status": status,
        "objective": objective(p, assignments),
        "wallSeconds": round(wall, 3),
        "assignments": [{"flightId": a.flight_id, "tail": a.tail, "start": a.start} for a in assignments],
    }
