"""
Workflow definitions only — this module is loaded inside Temporal's deterministic sandbox, so it
imports nothing but temporalio and refers to activities by name.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError

SOLVE_TIMEOUT = timedelta(minutes=2)
REPORT = dict(start_to_close_timeout=timedelta(seconds=40), retry_policy=RetryPolicy(maximum_attempts=20, maximum_interval=timedelta(minutes=1)))


@workflow.defn(name="RecoveryWorkflow")
class RecoveryWorkflow:
    @workflow.run
    async def run(self, problem: dict[str, Any]) -> dict[str, Any]:
        run_id = problem["runId"]
        try:
            solution = await workflow.execute_activity(
                "solve_recovery", problem, start_to_close_timeout=SOLVE_TIMEOUT, retry_policy=RetryPolicy(maximum_attempts=2)
            )
        except ActivityError as e:
            await workflow.execute_activity("report_result", args=[run_id, {"error": f"Optimiser failed: {e.cause or e}"}], **REPORT)
            return {"runId": run_id, "status": "FAILED"}
        await workflow.execute_activity("report_result", args=[run_id, {"solution": solution}], **REPORT)
        return {"runId": run_id, "status": "REPORTED", "solver": solution["solver"], "objective": solution["objective"]}


@workflow.defn(name="CrewRecoveryWorkflow")
class CrewRecoveryWorkflow:
    @workflow.run
    async def run(self, problem: dict[str, Any]) -> dict[str, Any]:
        run_id = problem["runId"]
        try:
            solution = await workflow.execute_activity(
                "solve_crew_recovery", problem, start_to_close_timeout=SOLVE_TIMEOUT, retry_policy=RetryPolicy(maximum_attempts=2)
            )
        except ActivityError as e:
            await workflow.execute_activity("report_crew_result", args=[run_id, {"error": f"Optimiser failed: {e.cause or e}"}], **REPORT)
            return {"runId": run_id, "status": "FAILED"}
        await workflow.execute_activity("report_crew_result", args=[run_id, {"solution": solution}], **REPORT)
        return {"runId": run_id, "status": "REPORTED", "solver": solution["solver"], "objective": solution["objective"]}
