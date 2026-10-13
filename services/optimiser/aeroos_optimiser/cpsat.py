"""
Exact recovery model with Google OR-Tools CP-SAT.

Decision: for every flight, which compatible dispatchable aircraft flies it (or cancel it), and when it
departs (STD … STD + max delay). Each aircraft's day is a path through the flights it flies, modelled
with AddCircuit over a depot node: an arc i→j exists only if flight i arrives where j departs, and when
used it forces j to depart at least a minimum turn after i arrives. Cost = delay minutes × weight +
cancellations × weight + tail swaps × weight. The greedy solution is passed as a hint, so CP-SAT starts
from a feasible plan and only improves it.
"""
from __future__ import annotations

from typing import Optional

from .model import Assignment, Problem


def solve_cpsat(p: Problem, time_limit_s: float = 20.0, hint: Optional[list[Assignment]] = None) -> tuple[list[Assignment], str]:
    from ortools.sat.python import cp_model  # imported lazily: the greedy fallback works without OR-Tools

    m = cp_model.CpModel()
    base = p.horizon_start
    flights = list(p.flights)
    tails = [t for t in p.tails if t.dispatchable]

    start = {f.id: m.NewIntVar(f.earliest - base, p.latest(f) - base, f"s_{f.id}") for f in flights}
    cancel = {f.id: m.NewBoolVar(f"c_{f.id}") for f in flights}
    x: dict[tuple[str, str], cp_model.IntVar] = {}

    for t in tails:
        nodes = [f for f in flights if p.usable(f, t)]
        if not nodes:
            continue
        idx = {f.id: i + 1 for i, f in enumerate(nodes)}
        arcs: list[tuple[int, int, cp_model.IntVar]] = []
        unused = m.NewBoolVar(f"unused_{t.reg}")
        arcs.append((0, 0, unused))
        for f in nodes:
            xf = m.NewBoolVar(f"x_{f.id}_{t.reg}")
            x[(f.id, t.reg)] = xf
            arcs.append((idx[f.id], idx[f.id], xf.Not()))  # skipped by this aircraft
            # First flight of the day for this aircraft.
            if f.dep == t.location and p.latest(f) >= t.available_from:
                a = m.NewBoolVar(f"d_{t.reg}_{f.id}")
                arcs.append((0, idx[f.id], a))
                m.Add(start[f.id] >= t.available_from - base).OnlyEnforceIf(a)
            # Last flight of the day for this aircraft.
            arcs.append((idx[f.id], 0, m.NewBoolVar(f"e_{f.id}_{t.reg}")))
            for g in nodes:
                if g.id == f.id or f.arr != g.dep:
                    continue
                if p.latest(g) < f.earliest + f.block + p.min_turn:
                    continue  # can never connect
                a = m.NewBoolVar(f"a_{f.id}_{g.id}_{t.reg}")
                arcs.append((idx[f.id], idx[g.id], a))
                m.Add(start[g.id] >= start[f.id] + f.block + p.min_turn).OnlyEnforceIf(a)
        m.AddCircuit(arcs)
        # An aircraft that flies nothing takes the depot self-loop.
        m.Add(sum(x[(f.id, t.reg)] for f in nodes) == 0).OnlyEnforceIf(unused)

    for f in flights:
        options = [x[(f.id, t.reg)] for t in tails if (f.id, t.reg) in x]
        m.Add(sum(options) + cancel[f.id] == 1)
        m.Add(start[f.id] == f.earliest - base).OnlyEnforceIf(cancel[f.id])

    swaps = [v for (fid, reg), v in x.items() if reg != next(f.tail for f in flights if f.id == fid)]
    delay_terms = [start[f.id] - (f.std - base) for f in flights]
    scale = 10  # costs may be fractional; CP-SAT needs integers
    m.Minimize(
        int(p.delay_cost * scale) * sum(delay_terms)
        + int(p.cancel_cost * scale) * sum(cancel.values())
        + int(p.swap_cost * scale) * sum(swaps)
    )

    if hint:
        for a in hint:
            m.AddHint(cancel[a.flight_id], a.tail is None)
            if a.start is not None:
                m.AddHint(start[a.flight_id], a.start - base)
            for t in tails:
                if (a.flight_id, t.reg) in x:
                    m.AddHint(x[(a.flight_id, t.reg)], a.tail == t.reg)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit_s
    solver.parameters.num_search_workers = 8
    status = solver.Solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"CP-SAT found no solution ({solver.StatusName(status)})")

    out: list[Assignment] = []
    for f in flights:
        if solver.Value(cancel[f.id]):
            out.append(Assignment(f.id, None, None))
            continue
        reg = next(t.reg for t in tails if (f.id, t.reg) in x and solver.Value(x[(f.id, t.reg)]))
        out.append(Assignment(f.id, reg, solver.Value(start[f.id]) + base))
    return out, "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"
