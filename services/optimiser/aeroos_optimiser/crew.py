"""
Crew recovery: assign standby/reserve crew to duties that broke a flight-time limitation.

Legality is NOT decided here. The API (TypeScript, rulepack) lists every legal (task, crew) option with
its cost; this module only picks at most one crew member per task and uses each crew member at most once,
never puts more positioning crew on a flight than it has seats left ("seats"), minimising option costs plus a
penalty for every task left uncovered. The API re-checks the answer.
"""
from __future__ import annotations

import logging
import time
from typing import Any

log = logging.getLogger("aeroos.optimiser.crew")


def objective(problem: dict[str, Any], assignments: list[dict[str, str]]) -> float:
    cost = {(o["taskId"], o["crewId"]): o["cost"] for o in problem["options"]}
    return sum(cost[(a["taskId"], a["crewId"])] for a in assignments) + (len(problem["tasks"]) - len(assignments)) * problem["uncoveredCost"]


def check(problem: dict[str, Any], assignments: list[dict[str, str]]) -> list[str]:
    options = {(o["taskId"], o["crewId"]) for o in problem["options"]}
    issues: list[str] = []
    tasks: set[str] = set()
    crew: set[str] = set()
    for a in assignments:
        if (a["taskId"], a["crewId"]) not in options:
            issues.append(f"{a['crewId']} is not a legal option for {a['taskId']}")
        if a["taskId"] in tasks:
            issues.append(f"{a['taskId']} covered twice")
        if a["crewId"] in crew:
            issues.append(f"{a['crewId']} used twice")
        tasks.add(a["taskId"])
        crew.add(a["crewId"])
    seats = problem.get("seats") or {}
    riding: dict[str, int] = {}
    for a in assignments:
        for f in _positioning(problem).get((a["taskId"], a["crewId"]), []):
            riding[f] = riding.get(f, 0) + 1
    for f, n in riding.items():
        if f in seats and n > seats[f]:
            issues.append(f"{n} positioning crew on {f}, {seats[f]} seat(s) left")
    return issues


def _positioning(problem: dict[str, Any]) -> dict[tuple[str, str], list[str]]:
    return {(o["taskId"], o["crewId"]): list(o.get("positioning") or []) for o in problem["options"]}


def _fits(problem: dict[str, Any], option: dict[str, Any], riding: dict[str, int]) -> bool:
    seats = problem.get("seats") or {}
    return all(f not in seats or riding.get(f, 0) < seats[f] for f in option.get("positioning") or [])


def solve_greedy(problem: dict[str, Any]) -> list[dict[str, str]]:
    """Most-constrained task first (fewest options), cheapest free crew member."""
    by_task: dict[str, list[dict[str, Any]]] = {t["id"]: [] for t in problem["tasks"]}
    for o in problem["options"]:
        by_task.setdefault(o["taskId"], []).append(o)
    used: set[str] = set()
    riding: dict[str, int] = {}
    out: list[dict[str, str]] = []
    for task_id in sorted(by_task, key=lambda t: (len(by_task[t]), t)):
        for o in sorted(by_task[task_id], key=lambda o: (o["cost"], o["crewId"])):
            if o["crewId"] not in used and _fits(problem, o, riding):
                used.add(o["crewId"])
                for f in o.get("positioning") or []:
                    riding[f] = riding.get(f, 0) + 1
                out.append({"taskId": task_id, "crewId": o["crewId"]})
                break
    return out


def solve_cpsat(problem: dict[str, Any], time_limit_s: float, hint: list[dict[str, str]]) -> tuple[list[dict[str, str]], str]:
    from ortools.sat.python import cp_model

    m = cp_model.CpModel()
    x = {}
    for o in problem["options"]:
        x[(o["taskId"], o["crewId"])] = m.NewBoolVar(f"x_{o['taskId']}_{o['crewId']}")
    for t in problem["tasks"]:
        m.AddAtMostOne(v for (tid, _), v in x.items() if tid == t["id"])
    for c in {cid for (_, cid) in x}:
        m.AddAtMostOne(v for (_, cid), v in x.items() if cid == c)
    pos = _positioning(problem)
    for f, left in (problem.get("seats") or {}).items():
        users = [v for k, v in x.items() if f in pos.get(k, [])]
        if users:
            m.Add(sum(users) <= int(left))
    # Costs are integers by construction (API cost model); scale defensively to keep CP-SAT integral.
    scale = 100
    cost = {(o["taskId"], o["crewId"]): int(round(o["cost"] * scale)) for o in problem["options"]}
    uncovered = int(round(problem["uncoveredCost"] * scale))
    covered = sum(x.values())
    m.Minimize(sum(cost[k] * v for k, v in x.items()) + uncovered * (len(problem["tasks"]) - covered))
    for a in hint:
        if (a["taskId"], a["crewId"]) in x:
            m.AddHint(x[(a["taskId"], a["crewId"])], 1)
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = time_limit_s
    s.parameters.num_workers = 4
    status = s.Solve(m)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"CP-SAT status {s.StatusName(status)}")
    chosen = [{"taskId": t, "crewId": c} for (t, c), v in x.items() if s.Value(v)]
    return sorted(chosen, key=lambda a: a["taskId"]), "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE"


def solve(problem: dict[str, Any], time_limit_s: float = 20.0) -> dict[str, Any]:
    t0 = time.monotonic()
    greedy = solve_greedy(problem)
    if check(problem, greedy):
        raise RuntimeError(f"greedy produced an invalid assignment: {check(problem, greedy)[:3]}")
    best, solver, status = greedy, "greedy", "FEASIBLE"
    try:
        exact, exact_status = solve_cpsat(problem, time_limit_s, greedy)
        if not check(problem, exact) and objective(problem, exact) <= objective(problem, greedy):
            best, solver, status = exact, "cp-sat", exact_status
    except ImportError:
        log.warning("OR-Tools not installed; using the greedy assignment")
    except Exception as e:  # noqa: BLE001
        log.warning("CP-SAT failed (%s); using the greedy assignment", e)
    return {
        "runId": problem["runId"], "solver": solver, "status": status, "objective": objective(problem, best),
        "wallSeconds": round(time.monotonic() - t0, 3), "assignments": best,
    }
