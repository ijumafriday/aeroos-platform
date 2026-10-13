import json
import unittest
from pathlib import Path

from aeroos_optimiser.greedy import solve_greedy
from aeroos_optimiser.model import Assignment, Problem, check, objective
from aeroos_optimiser.solve import solve

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "demo_rkg_aog.json").read_text())

try:
    import ortools  # noqa: F401
    HAVE_ORTOOLS = True
except ImportError:
    HAVE_ORTOOLS = False


def small(**over):
    """OSL hub: two A320s, one AOG; two there-and-back rotations."""
    p = {
        "runId": "T", "horizonStart": 0, "horizonEnd": 1440, "minTurnMinutes": 30, "maxDelayMinutes": 240,
        "costs": {"delayPerMinute": 1, "cancel": 600, "swap": 20},
        "tails": [
            {"reg": "A", "type": "A320", "location": "OSL", "availableFrom": 0, "dispatchable": True},
            {"reg": "B", "type": "A320", "location": "OSL", "availableFrom": 0, "dispatchable": False},
        ],
        "flights": [
            {"id": "1", "flightNo": "N1", "dep": "OSL", "arr": "BGO", "std": 360, "blockMinutes": 60, "tail": "A", "type": "A320", "version": 1},
            {"id": "2", "flightNo": "N2", "dep": "BGO", "arr": "OSL", "std": 480, "blockMinutes": 60, "tail": "A", "type": "A320", "version": 1},
            {"id": "3", "flightNo": "N3", "dep": "OSL", "arr": "TRD", "std": 420, "blockMinutes": 60, "tail": "B", "type": "A320", "version": 1},
            {"id": "4", "flightNo": "N4", "dep": "TRD", "arr": "OSL", "std": 540, "blockMinutes": 60, "tail": "B", "type": "A320", "version": 1},
        ],
    }
    p.update(over)
    return p


class CheckerTests(unittest.TestCase):
    def test_flying_the_plan_on_an_aog_aircraft_is_rejected(self):
        p = Problem.from_json(small())
        plan = [Assignment(f.id, f.tail, f.std) for f in p.flights]
        self.assertTrue(any("non-dispatchable B" in i for i in check(p, plan)))

    def test_continuity_and_turn_time_are_checked(self):
        p = Problem.from_json(small())
        plan = [Assignment("1", "A", 360), Assignment("2", "A", 440), Assignment("3", None, None), Assignment("4", None, None)]
        self.assertTrue(any("before the aircraft is ready" in i for i in check(p, plan)))
        plan = [Assignment("1", None, None), Assignment("2", "A", 480), Assignment("3", None, None), Assignment("4", None, None)]
        self.assertTrue(any("is at OSL but N2 departs BGO" in i for i in check(p, plan)))


class GreedyTests(unittest.TestCase):
    def test_absorbs_the_aog_rotation_by_delaying_onto_the_spare_aircraft(self):
        p = Problem.from_json(small())
        plan = solve_greedy(p)
        self.assertEqual(check(p, plan), [])
        by = {a.flight_id: a for a in plan}
        self.assertEqual(by["1"].tail, "A")
        # N3 waits for A to come back from Bergen: N2 lands 540, + 30 turn = 570 → 150 min late, within 240.
        self.assertEqual((by["3"].tail, by["3"].start), ("A", 570))
        self.assertEqual(by["4"].tail, "A")

    def test_cancels_when_the_delay_would_exceed_the_maximum(self):
        p = Problem.from_json(small(maxDelayMinutes=120))  # N3 would need 150 min
        plan = {a.flight_id: a for a in solve_greedy(p)}
        self.assertIsNone(plan["3"].tail)
        self.assertIsNone(plan["4"].tail)  # stranded: the aircraft never went to TRD

    def test_demo_fixture_is_feasible_and_cheaper_than_cancelling_everything(self):
        p = Problem.from_json(FIXTURE)
        plan = solve_greedy(p)
        self.assertEqual(check(p, plan), [])
        self.assertLess(objective(p, plan), p.cancel_cost * 4)  # RKG's four flights cost less than cancelling them
        self.assertTrue(all(a.tail != "LN-RKG" for a in plan))


class CurrentDelayTests(unittest.TestCase):
    def test_a_delay_already_entered_is_a_lower_bound(self):
        p = small()
        p["flights"][0]["earliest"] = 400  # OCC already delayed N1 by 40 min (e.g. ATC slot)
        prob = Problem.from_json(p)
        plan = {a.flight_id: a for a in solve_greedy(prob)}
        self.assertGreaterEqual(plan["1"].start, 400)
        self.assertEqual(check(prob, list(plan.values())), [])
        too_early = [Assignment("1", "A", 360)] + [a for k, a in plan.items() if k != "1"]
        self.assertTrue(any("before its current ETD" in i for i in check(prob, too_early)))


class SolveTests(unittest.TestCase):
    def test_solve_returns_the_contract_shape(self):
        out = solve(FIXTURE, time_limit_s=5)
        self.assertEqual(out["runId"], "REC-FIXTURE")
        self.assertIn(out["solver"], ("cp-sat", "greedy"))
        self.assertEqual(len(out["assignments"]), len(FIXTURE["flights"]))
        self.assertEqual(check(Problem.from_json(FIXTURE), [Assignment(a["flightId"], a["tail"], a["start"]) for a in out["assignments"]]), [])

    @unittest.skipUnless(HAVE_ORTOOLS, "OR-Tools not installed")
    def test_cpsat_is_at_least_as_good_as_greedy(self):
        from aeroos_optimiser.cpsat import solve_cpsat
        for problem in (small(), small(maxDelayMinutes=120), FIXTURE):
            p = Problem.from_json(problem)
            g = solve_greedy(p)
            exact, _ = solve_cpsat(p, 10, g)
            self.assertEqual(check(p, exact), [])
            self.assertLessEqual(objective(p, exact), objective(p, g))


if __name__ == "__main__":
    unittest.main()
