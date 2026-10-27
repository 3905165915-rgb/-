"""Batch captured at request start, carried into synchronous file transactions."""
from contextvars import ContextVar

expected_demo_batch: ContextVar[str | None] = ContextVar('expected_demo_batch', default=None)
