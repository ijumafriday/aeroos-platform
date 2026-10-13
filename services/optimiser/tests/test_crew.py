import unittest

from aeroos_optimiser import crew

try:
    import ortools  # noqa: F401
    HAVE_ORTOOLS = True
except ImportError:
    HAVE_ORTOOLS = False


def problem():
    """Greedy trap: T1 has two options, T2 only one — the crew member T2 needs is also T1's cheapest."""
    return {
        "runId": "CRW-1", "uncoveredCost": 1000,
        "tasks": [{"id": "T1"}, {"id": "T2"}, {"id": "T3"}],
        "candidates": [],
        "options": [
            {"taskId": "T1", "crewId": "S2", "cost": 10, "ftl": "OK", "note": ""},
            {"taskId": "T1", "crewId": "R1", "cost": 40, "ftl": "OK", "note": ""},
            {"taskId": "T2", "crewId": "S2", "cost": 35, "ftl": "DISCRETION", "note": ""},
        ],
        "snapshot": [],
    }


class CrewRecoveryTest(unittest.TestCase):
    def test_greedy_takes_most_constrained_first(self):
        a = crew.solve_greedy(problem())
        self.assertEqual(sorted((x["taskId"], x["crewId"]) for x in a), [("T1", "R1"), ("T2", "S2")])
        self.assertEqual(crew.check(problem(), a), [])
        self.assertEqual(crew.objective(problem(), a), 40 + 35 + 1000)

    def test_checker_rejects_illegal_and_double_use(self):
        p = problem()
        self.assertTrue(crew.check(p, [{"taskId": "T3", "crewId": "S2"}]))
        self.assertTrue(crew.check(p, [{"taskId": "T1", "crewId": "S2"}, {"taskId": "T2", "crewId": "S2"}]))

    def test_solve_returns_checked_solution(self):
        s = crew.solve(problem(), 5)
        self.assertEqual(crew.check(problem(), s["assignments"]), [])
        self.assertEqual(s["objective"], 1075)
        self.assertIn(s["solver"], ("greedy", "cp-sat"))

    @unittest.skipUnless(HAVE_ORTOOLS, "OR-Tools not installed")
    def test_cpsat_optimal(self):
        a, status = crew.solve_cpsat(problem(), 5, [])
        self.assertEqual(status, "OPTIMAL")
        self.assertEqual(crew.objective(problem(), a), 1075)


def seat_problem():
    """Two tasks at the same outstation; both cheap covers ride NK611, which has one seat left."""
    return {
        "runId": "CRW-2", "uncoveredCost": 1000,
        "tasks": [{"id": "T1"}, {"id": "T2"}],
        "candidates": [],
        "options": [
            {"taskId": "T1", "crewId": "R1", "cost": 55, "ftl": "OK", "note": "", "positioning": ["NK611"]},
            {"taskId": "T2", "crewId": "R2", "cost": 55, "ftl": "OK", "note": "", "positioning": ["NK611"]},
            {"taskId": "T2", "crewId": "R3", "cost": 70, "ftl": "OK", "note": "", "positioning": ["NK609"]},
        ],
        "snapshot": [],
        "seats": {"NK611": 1, "NK609": 2},
    }


class SeatTest(unittest.TestCase):
    def test_checker_rejects_overbooked_positioning(self):
        issues = crew.check(seat_problem(), [{"taskId": "T1", "crewId": "R1"}, {"taskId": "T2", "crewId": "R2"}])
        self.assertTrue(any("seat" in i for i in issues))

    def test_greedy_respects_seats(self):
        a = crew.solve_greedy(seat_problem())
        self.assertEqual(crew.check(seat_problem(), a), [])
        self.assertEqual(len(a), 2)

    def test_problem_without_seats_is_unconstrained(self):
        p = seat_problem()
        del p["seats"]
        self.assertEqual(crew.check(p, [{"taskId": "T1", "crewId": "R1"}, {"taskId": "T2", "crewId": "R2"}]), [])

    @unittest.skipUnless(HAVE_ORTOOLS, "OR-Tools not installed")
    def test_cpsat_respects_seats(self):
        a, _ = crew.solve_cpsat(seat_problem(), 5, [])
        self.assertEqual(crew.check(seat_problem(), a), [])
        self.assertEqual(crew.objective(seat_problem(), a), 125)


if __name__ == "__main__":
    unittest.main()
