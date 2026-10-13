"""
Temporal worker for task queue "optimiser". The API (TypeScript) starts `RecoveryWorkflow` by name with
the problem as JSON; this worker solves it and reports the result to the API's internal endpoint. Like
the TypeScript worker it has no database access: the API re-checks and stores the result.
The workflow itself lives in workflows.py (sandboxed); this module holds the activities and the worker.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from temporalio import activity
from temporalio.client import Client
from temporalio.worker import Worker

from . import crew, telemetry
from .service_token import service_token
from .solve import solve
from .workflows import CrewRecoveryWorkflow, RecoveryWorkflow

API_URL = os.environ.get("API_URL", "http://localhost:3000")
# Keep below workflows.SOLVE_TIMEOUT (2 min) with margin for model building.
TIME_LIMIT_S = min(90.0, float(os.environ.get("SOLVER_TIME_LIMIT_SECONDS", "20")))


@activity.defn(name="solve_recovery")
def solve_recovery(problem: dict[str, Any]) -> dict[str, Any]:
    activity.logger.info("solving %s: %d flights, %d tails", problem.get("runId"), len(problem.get("flights", [])), len(problem.get("tails", [])))
    with telemetry.span("recovery.solve", run_id=problem.get("runId"), flights=len(problem.get("flights", [])), tails=len(problem.get("tails", []))) as sp:
        result = solve(problem, TIME_LIMIT_S)
        if sp is not None:
            sp.set_attributes({"solver": result["solver"], "objective": result["objective"], "status": result["status"]})
        return result


@activity.defn(name="solve_crew_recovery")
def solve_crew_recovery(problem: dict[str, Any]) -> dict[str, Any]:
    activity.logger.info("crew recovery %s: %d duties, %d options", problem.get("runId"), len(problem.get("tasks", [])), len(problem.get("options", [])))
    with telemetry.span("crew_recovery.solve", run_id=problem.get("runId"), tasks=len(problem.get("tasks", [])), options=len(problem.get("options", []))) as sp:
        result = crew.solve(problem, TIME_LIMIT_S)
        if sp is not None:
            sp.set_attributes({"solver": result["solver"], "objective": result["objective"], "covered": len(result["assignments"])})
        return result


def _post(run_id: str, payload: dict[str, Any], kind: str = "recovery") -> None:
    req = urllib.request.Request(
        f"{API_URL}/api/internal/ops/{kind}/{run_id}/result",
        data=json.dumps(payload).encode(),
        headers=telemetry.inject({"content-type": "application/json", "authorization": f"Bearer {service_token()}"}),
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:  # noqa: S310 — fixed internal URL
        if res.status >= 300:
            raise RuntimeError(f"API answered {res.status}")


@activity.defn(name="report_result")
async def report_result(run_id: str, payload: dict[str, Any]) -> None:
    await asyncio.to_thread(_post, run_id, payload)


@activity.defn(name="report_crew_result")
async def report_crew_result(run_id: str, payload: dict[str, Any]) -> None:
    await asyncio.to_thread(_post, run_id, payload, "crew-recovery")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    interceptors = telemetry.setup()
    address = os.environ.get("TEMPORAL_ADDRESS", "localhost:7233")
    namespace = os.environ.get("TEMPORAL_NAMESPACE", "default")
    for attempt in range(1, 61):
        try:
            client = await Client.connect(address, namespace=namespace, interceptors=interceptors)
            break
        except Exception as e:  # noqa: BLE001
            logging.warning("Temporal not ready at %s (%s); retrying", address, e)
            await asyncio.sleep(3)
    else:
        raise SystemExit("Temporal unreachable")
    with ThreadPoolExecutor(max_workers=int(os.environ.get("SOLVER_CONCURRENCY", "2"))) as pool:
        worker = Worker(client, task_queue="optimiser", workflows=[RecoveryWorkflow, CrewRecoveryWorkflow],
            activities=[solve_recovery, report_result, solve_crew_recovery, report_crew_result], activity_executor=pool)
        logging.info("polling task queue \"optimiser\" on %s/%s", address, namespace)
        await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
