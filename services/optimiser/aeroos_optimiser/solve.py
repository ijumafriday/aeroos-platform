"""Entry point used by the Temporal activity: CP-SAT when available, greedy otherwise; never an unchecked plan."""
from __future__ import annotations

import logging
import time
from typing import Any

from .greedy import solve_greedy
from .model import Problem, check, objective, to_json

log = logging.getLogger("aeroos.optimiser")


def solve(problem_json: dict[str, Any], time_limit_s: float = 20.0) -> dict[str, Any]:
    t0 = time.monotonic()
    p = Problem.from_json(problem_json)
    greedy = solve_greedy(p)
    issues = check(p, greedy)
    if issues:  # a bug, not a data problem — never return an infeasible plan
        raise RuntimeError(f"greedy produced an infeasible plan: {issues[:3]}")
    best, solver, status = greedy, "greedy", "FEASIBLE"
    try:
        exact, exact_status = solve_cpsat_guarded(p, time_limit_s, greedy)
        if not check(p, exact) and objective(p, exact) <= objective(p, greedy):
            best, solver, status = exact, "cp-sat", exact_status
    except ImportError:
        log.warning("OR-Tools not installed; using the greedy heuristic")
    except Exception as e:  # noqa: BLE001 — fall back, but say so
        log.warning("CP-SAT failed (%s); using the greedy heuristic", e)
    return to_json(p, best, solver, status, time.monotonic() - t0)


def solve_cpsat_guarded(p: Problem, time_limit_s: float, hint):
    from .cpsat import solve_cpsat

    return solve_cpsat(p, time_limit_s, hint)
