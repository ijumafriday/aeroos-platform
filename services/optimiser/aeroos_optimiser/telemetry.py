"""
OpenTelemetry for the optimiser worker (OTEL_ENABLED=true). Temporal's TracingInterceptor continues the
trace the API started when it launched the workflow; solver activities get their own spans with the
problem size and objective; the report back to the API carries `traceparent`, so one trace spans
API → Temporal → Python solver → API. Without the packages, or when disabled, everything is a no-op.
"""
from __future__ import annotations

import contextlib
import logging
import os
from typing import Any, Iterator

log = logging.getLogger("aeroos.optimiser.telemetry")
_enabled = False


def setup() -> list[Any]:
    """Configure the tracer provider and return the Temporal client interceptors to use."""
    global _enabled
    if os.environ.get("OTEL_ENABLED") != "true":
        return []
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from temporalio.contrib.opentelemetry import TracingInterceptor
    except ImportError as e:  # pragma: no cover — packages are in requirements.txt
        log.warning("OpenTelemetry packages missing (%s); tracing disabled", e)
        return []
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318").rstrip("/")
    provider = TracerProvider(resource=Resource.create({"service.name": "aeroos-optimiser"}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")))
    trace.set_tracer_provider(provider)
    _enabled = True
    log.info("tracing to %s", endpoint)
    return [TracingInterceptor()]


@contextlib.contextmanager
def span(name: str, **attributes: Any) -> Iterator[Any]:
    if not _enabled:
        yield None
        return
    from opentelemetry import trace

    with trace.get_tracer("aeroos.optimiser").start_as_current_span(name, attributes={k: v for k, v in attributes.items() if v is not None}) as s:
        yield s


def inject(headers: dict[str, str]) -> dict[str, str]:
    """Add W3C trace context to outgoing HTTP headers."""
    if _enabled:
        from opentelemetry.propagate import inject as _inject

        _inject(headers)
    return headers
