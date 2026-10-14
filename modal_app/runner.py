"""Modal app that executes untrusted user code for RealCode.

Deploy with:  modal deploy modal_app/runner.py

Each call runs in a fresh, single-use container with networking blocked and
no access to the Modal API. Inside the container the shared harness
(runner/harness.py) runs as a subprocess with a wall-clock timeout, so a
runaway submission cannot hang the function.

The function takes and returns JSON strings so it can be called from the
JavaScript SDK without any Python-specific serialization.
"""

import json
import os
import pathlib
import subprocess
import tempfile

import modal

APP_NAME = os.environ.get("REALCODE_MODAL_APP", "realcode-runner")
HARNESS_LOCAL = pathlib.Path(__file__).resolve().parent.parent / "runner" / "harness.py"
HARNESS_REMOTE = "/opt/realcode/harness.py"

MAX_CAPTURE_BYTES = 64 * 1024
MAX_RESULTS_BYTES = 64 * 1024 * 1024
MAX_TIMEOUT_S = 120

app = modal.App(APP_NAME)

image = modal.Image.debian_slim(python_version="3.11").add_local_file(
    HARNESS_LOCAL, HARNESS_REMOTE
)


def _read_capped(path, cap):
    try:
        with open(path, "rb") as f:
            return f.read(cap).decode("utf-8", errors="replace")
    except FileNotFoundError:
        return ""


@app.function(
    image=image,
    block_network=True,
    restrict_modal_access=True,
    single_use_containers=True,
    cpu=1.0,
    memory=(512, 1024),
    timeout=MAX_TIMEOUT_S + 30,
    max_containers=50,
)
def run_tests(request_json: str) -> str:
    request = json.loads(request_json)
    payload = request["payload"]
    timeout_s = min(float(request.get("timeout_ms", 30000)) / 1000.0, MAX_TIMEOUT_S)

    with tempfile.TemporaryDirectory() as workdir:
        results_path = os.path.join(workdir, "results.jsonl")
        stdout_path = os.path.join(workdir, "stdout.txt")
        stderr_path = os.path.join(workdir, "stderr.txt")
        timed_out = False
        with open(stdout_path, "wb") as out, open(stderr_path, "wb") as err:
            proc = subprocess.Popen(
                ["python3", "-I", "-S", HARNESS_REMOTE, results_path],
                stdin=subprocess.PIPE,
                stdout=out,
                stderr=err,
                cwd=workdir,
                env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": workdir,
                     "LANG": "C.UTF-8", "PYTHONDONTWRITEBYTECODE": "1"},
                start_new_session=True,
            )
            try:
                proc.communicate(json.dumps(payload).encode("utf-8"), timeout=timeout_s)
            except subprocess.TimeoutExpired:
                timed_out = True
                try:
                    os.killpg(proc.pid, 9)
                except ProcessLookupError:
                    pass
                proc.wait()

        return json.dumps({
            "results": _read_capped(results_path, MAX_RESULTS_BYTES),
            "stdout": _read_capped(stdout_path, MAX_CAPTURE_BYTES),
            "stderr": _read_capped(stderr_path, MAX_CAPTURE_BYTES),
            "exit_code": proc.returncode,
            "timed_out": timed_out,
        })
