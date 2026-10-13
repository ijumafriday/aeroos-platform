import os
import unittest

from aeroos_optimiser import telemetry


class TelemetryTest(unittest.TestCase):
    def test_disabled_is_a_no_op(self):
        os.environ.pop("OTEL_ENABLED", None)
        self.assertEqual(telemetry.setup(), [])
        with telemetry.span("x", a=1) as s:
            self.assertIsNone(s)
        self.assertEqual(telemetry.inject({"k": "v"}), {"k": "v"})


if __name__ == "__main__":
    unittest.main()
