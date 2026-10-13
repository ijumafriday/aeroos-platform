"""
Greedy recovery heuristic — the fallback when OR-Tools is unavailable or finds nothing in time, and the
warm start (hint) for CP-SAT.

Event-driven: at each step, every unassigned flight is priced against the aircraft currently at its
departure airport; the flight that can leave earliest is committed to its best aircraft (the planned
tail wins ties, then the fewest swaps). When no remaining flight can be flown within the maximum delay,
the earliest one is cancelled — which also strands any onward leg that needed that aircraft, so
cancellations cascade the way they do in real life.
"""
from __future__ import annotations

from .model import Assignment, Problem


def solve_greedy(p: Problem) -> list[Assignment]:
    tails = {t.reg: t for t in p.tails if t.dispatchable}
    state = {reg: (t.location, t.available_from) for reg, t in tails.items()}
    pending = list(p.flights)  # sorted by STD
    decided: dict[str, Assignment] = {}

    while pending:
        best: tuple[int, int, int, str, int] | None = None  # (start, swap, std, reg, index)
        for i, f in enumerate(pending):
            for reg, (loc, free) in state.items():
                if loc != f.dep or not p.usable(f, tails[reg]):
                    continue
                start = max(f.earliest, free)
                if start > p.latest(f):
                    continue
                key = (start, 0 if reg == f.tail else 1, f.std, reg, i)
                if best is None or key < best:
                    best = key
        if best is None:
            f = pending.pop(0)
            decided[f.id] = Assignment(f.id, None, None)
            continue
        start, _, _, reg, i = best
        f = pending.pop(i)
        state[reg] = (f.arr, start + f.block + p.min_turn)
        decided[f.id] = Assignment(f.id, reg, start)

    return [decided[f.id] for f in p.flights]
