"""Test harness for RealCode.

Runs operation-sequence tests against a user-supplied Python class.

Usage: python3 -I -S harness.py RESULTS_PATH < payload.json

Payload (JSON on stdin):
  {
    "code": "<user source>",
    "class_name": "InMemoryDB",
    "memory_limit_mb": 512,
    "tests": [{"id": "t1", "time_limit_ms": 2000,
               "ops": [{"op": "set", "args": ["a", "x", "1"]}, ...]}]
  }

The harness never sees expected values. For each test it writes one JSON line
to RESULTS_PATH with the actual return value of every operation it managed to
run. Grading happens outside the sandbox, so user code that tampers with the
harness can at worst misreport its own return values.

Result line:
  {"id": "t1", "status": "ok" | "error" | "timeout",
   "actuals": [...], "error": "...", "stdout": "...", "elapsed_ms": 12.3}
A single {"load_error": "..."} line is written if the code cannot be loaded.
"""

import io
import json
import math
import os
import signal
import sys
import traceback
from time import perf_counter as _perf_counter

MAX_STDOUT_PER_TEST = 4096
MAX_RESULT_LINE_BYTES = 8 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_DEPTH = 50
LOAD_TIME_LIMIT_S = 5


class _TestTimeout(BaseException):
    """Raised by the interval timer. BaseException so `except Exception` in
    user code does not swallow it."""


class _CappedWriter(io.TextIOBase):
    def __init__(self, cap):
        self._parts = []
        self._size = 0
        self._cap = cap
        self.truncated = False

    def writable(self):
        return True

    def write(self, s):
        if not isinstance(s, str):
            s = str(s)
        room = self._cap - self._size
        if room > 0:
            chunk = s[:room]
            self._parts.append(chunk)
            self._size += len(chunk)
        if len(s) > max(room, 0):
            self.truncated = True
        return len(s)

    def getvalue(self):
        text = "".join(self._parts)
        if self.truncated:
            text += "\n... [output truncated]"
        return text


def _set_limits(memory_limit_mb):
    try:
        import resource
    except ImportError:
        return
    limits = [
        ("RLIMIT_FSIZE", MAX_FILE_BYTES),
        ("RLIMIT_CORE", 0),
    ]
    if memory_limit_mb:
        limit = memory_limit_mb * 1024 * 1024
        limits.append(("RLIMIT_AS", limit))
        limits.append(("RLIMIT_DATA", limit))
    for name, value in limits:
        res = getattr(resource, name, None)
        if res is None:
            continue
        try:
            soft, hard = resource.getrlimit(res)
            if hard != resource.RLIM_INFINITY:
                value = min(value, hard)
            resource.setrlimit(res, (value, hard))
        except (ValueError, OSError):
            # Not supported on this platform (e.g. RLIMIT_AS on macOS).
            pass


def _block_network():
    """Best-effort, in-process network block. The real isolation comes from
    the sandbox the runner launches this process in."""
    try:
        import socket

        def _denied(*_args, **_kwargs):
            raise PermissionError("Network access is disabled in the sandbox")

        socket.socket = _denied
        socket.create_connection = _denied
        socket.getaddrinfo = _denied
    except Exception:
        pass


def _sanitize(value, depth=0):
    """Convert a return value into something JSON can represent faithfully.
    Anything else becomes a marker object that never equals an expected
    value."""
    if depth > MAX_DEPTH:
        return {"__unserializable__": "nesting too deep"}
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return {"__unserializable__": repr(value)}
        return value
    if isinstance(value, (list, tuple)):
        return [_sanitize(v, depth + 1) for v in value]
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if not isinstance(k, str):
                return {"__unserializable__": _safe_repr(value)}
            out[k] = _sanitize(v, depth + 1)
        return out
    return {"__unserializable__": _safe_repr(value)}


def _safe_repr(value):
    try:
        text = repr(value)
    except BaseException:
        text = "<%s object>" % type(value).__name__
    return text[:200]


def _format_exception(exc):
    name = type(exc).__name__
    try:
        message = str(exc)
    except BaseException:
        message = ""
    text = "%s: %s" % (name, message) if message else name
    return text[:1000]


def _user_traceback(exc):
    """Traceback lines that point into the user's file only."""
    try:
        frames = [
            f for f in traceback.extract_tb(exc.__traceback__)
            if f.filename == "solution.py"
        ]
        if not frames:
            return ""
        last = frames[-1]
        return " (line %d)" % last.lineno
    except BaseException:
        return ""


def _on_alarm(_signum, _frame):
    raise _TestTimeout()


def _run_test(cls, test, out):
    ops = test.get("ops") or []
    limit_s = max(float(test.get("time_limit_ms") or 2000) / 1000.0, 0.01)
    capture = _CappedWriter(MAX_STDOUT_PER_TEST)
    actuals = []
    status = "ok"
    error = None
    real_stdout, real_stderr = sys.stdout, sys.stderr
    sys.stdout = capture
    sys.stderr = capture
    start = _perf_counter()
    try:
        # Re-fires every 50ms after the deadline in case user code catches it.
        signal.setitimer(signal.ITIMER_REAL, limit_s, 0.05)
        instance = cls()
        for index, op in enumerate(ops):
            name = op.get("op")
            args = op.get("args") or []
            method = getattr(instance, name, None)
            if method is None or not callable(method):
                raise AttributeError(
                    "%s has no method '%s'" % (cls.__name__, name))
            actuals.append(_sanitize(method(*args)))
        signal.setitimer(signal.ITIMER_REAL, 0)
    except _TestTimeout:
        signal.setitimer(signal.ITIMER_REAL, 0)
        status = "timeout"
        error = "Time limit of %d ms exceeded" % int(limit_s * 1000)
    except RecursionError as exc:
        signal.setitimer(signal.ITIMER_REAL, 0)
        status = "error"
        error = "RecursionError: maximum recursion depth exceeded" + \
            _user_traceback(exc)
    except MemoryError:
        signal.setitimer(signal.ITIMER_REAL, 0)
        status = "error"
        error = "MemoryError: memory limit exceeded"
    except BaseException as exc:  # noqa: BLE001 - user code may raise anything
        signal.setitimer(signal.ITIMER_REAL, 0)
        status = "error"
        error = _format_exception(exc) + _user_traceback(exc)
    finally:
        sys.stdout, sys.stderr = real_stdout, real_stderr
    elapsed_ms = (_perf_counter() - start) * 1000.0

    record = {
        "id": test.get("id"),
        "status": status,
        "actuals": actuals,
        "error": error,
        "stdout": capture.getvalue(),
        "elapsed_ms": round(elapsed_ms, 3),
    }
    line = json.dumps(record, allow_nan=False)
    if len(line) > MAX_RESULT_LINE_BYTES:
        record["actuals"] = []
        record["status"] = "error"
        record["error"] = "Return values too large to report"
        line = json.dumps(record, allow_nan=False)
    out.write(line + "\n")
    out.flush()


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("usage: harness.py RESULTS_PATH\n")
        return 2
    results_path = sys.argv[1]
    payload = json.loads(sys.stdin.read())
    out = open(results_path, "w", encoding="utf-8")

    _set_limits(payload.get("memory_limit_mb"))
    _block_network()
    signal.signal(signal.SIGALRM, _on_alarm)
    sys.setrecursionlimit(10000)

    namespace = {"__name__": "solution", "__builtins__": __builtins__}
    class_name = payload.get("class_name")
    try:
        compiled = compile(payload.get("code") or "", "solution.py", "exec")
        real_stdout = sys.stdout
        sys.stdout = _CappedWriter(MAX_STDOUT_PER_TEST)
        try:
            signal.setitimer(signal.ITIMER_REAL, LOAD_TIME_LIMIT_S, 0.05)
            exec(compiled, namespace)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            sys.stdout = real_stdout
    except _TestTimeout:
        out.write(json.dumps({
            "load_error": "Your code took longer than %d seconds to load" %
            LOAD_TIME_LIMIT_S
        }) + "\n")
        out.close()
        return 0
    except SyntaxError as exc:
        out.write(json.dumps({
            "load_error": "SyntaxError: %s (line %s)" % (exc.msg, exc.lineno)
        }) + "\n")
        out.close()
        return 0
    except BaseException as exc:  # noqa: BLE001
        out.write(json.dumps({
            "load_error": "Your code raised an error while loading: " +
            _format_exception(exc) + _user_traceback(exc)
        }) + "\n")
        out.close()
        return 0

    cls = namespace.get(class_name)
    if not isinstance(cls, type):
        out.write(json.dumps({
            "load_error": "Class '%s' was not found in your code" % class_name
        }) + "\n")
        out.close()
        return 0

    for test in payload.get("tests") or []:
        _run_test(cls, test, out)
    out.close()
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    sys.exit(main())
