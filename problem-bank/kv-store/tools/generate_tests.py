"""Generates tests/stageN_{public,hidden}.json for the kv-store problem.

Expected values come from `Oracle`, a deliberately brute-force model that is
written independently of the reference solutions, so `npm run validate`
cross-checks the two.

Usage: python3 problem-bank/kv-store/tools/generate_tests.py
"""

import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS_DIR = os.path.join(HERE, "..", "tests")

PERF_TIME_LIMIT_MS = 2000
PERF_FIELDS = 20000


class Oracle:
    def __init__(self):
        self.db = {}  # key -> {field: (value, expires_at or None)}
        self.backups = []  # (timestamp, {key: {field: (value, remaining or None)}})

    def _live(self, key, now):
        return {
            f: (v, e)
            for f, (v, e) in self.db.get(key, {}).items()
            if e is None or now is None or e > now
        }

    def _set(self, key, field, value, expires_at):
        self.db.setdefault(key, {})[field] = (value, expires_at)
        return None

    def _get(self, key, field, now):
        entry = self._live(key, now).get(field)
        return None if entry is None else entry[0]

    def _delete(self, key, field, now):
        if field not in self._live(key, now):
            return False
        del self.db[key][field]
        return True

    def _scan(self, key, prefix, now):
        live = self._live(key, now)
        return ["%s(%s)" % (f, live[f][0]) for f in sorted(live) if f.startswith(prefix)]

    def set(self, key, field, value):
        return self._set(key, field, value, None)

    def get(self, key, field):
        return self._get(key, field, None)

    def delete(self, key, field):
        return self._delete(key, field, None)

    def scan(self, key):
        return self._scan(key, "", None)

    def scan_by_prefix(self, key, prefix):
        return self._scan(key, prefix, None)

    def set_at(self, key, field, value, timestamp):
        return self._set(key, field, value, None)

    def set_at_with_ttl(self, key, field, value, timestamp, ttl):
        return self._set(key, field, value, timestamp + ttl)

    def get_at(self, key, field, timestamp):
        return self._get(key, field, timestamp)

    def delete_at(self, key, field, timestamp):
        return self._delete(key, field, timestamp)

    def scan_at(self, key, timestamp):
        return self._scan(key, "", timestamp)

    def scan_by_prefix_at(self, key, prefix, timestamp):
        return self._scan(key, prefix, timestamp)

    def backup(self, timestamp):
        snap = {}
        for key in self.db:
            live = self._live(key, timestamp)
            if live:
                snap[key] = {
                    f: (v, None if e is None else e - timestamp) for f, (v, e) in live.items()
                }
        self.backups.append((timestamp, snap))
        return len(snap)

    def restore(self, timestamp, timestamp_to_restore):
        candidates = [b for b in self.backups if b[0] <= timestamp_to_restore]
        assert candidates, "restore needs an earlier backup"
        _, snap = candidates[-1]
        self.db = {
            key: {f: (v, None if r is None else timestamp + r) for f, (v, r) in fields.items()}
            for key, fields in snap.items()
        }
        return None


def make_test(name, calls, time_limit_ms=None):
    """calls: list of (op, args). Expected values come from the oracle."""
    oracle = Oracle()
    ops = []
    for op, args in calls:
        expect = getattr(oracle, op)(*args)
        ops.append({"op": op, "args": list(args), "expect": expect})
    test = {"name": name}
    if time_limit_ms:
        test["time_limit_ms"] = time_limit_ms
    test["ops"] = ops
    return test


def write(path, tests):
    """One operation per line keeps diffs readable even for large tests."""
    lines = ["["]
    for ti, test in enumerate(tests):
        head = {k: v for k, v in test.items() if k != "ops"}
        lines.append("  {")
        for k, v in head.items():
            lines.append("    %s: %s," % (json.dumps(k), json.dumps(v)))
        lines.append('    "ops": [')
        for oi, op in enumerate(test["ops"]):
            sep = "," if oi < len(test["ops"]) - 1 else ""
            lines.append("      " + json.dumps(op, separators=(", ", ": ")) + sep)
        lines.append("    ]")
        lines.append("  }" + ("," if ti < len(tests) - 1 else ""))
    lines.append("]")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


# ---------------------------------------------------------------- stage 1

def stage1_public():
    return [
        make_test("set, get and delete", [
            ("set", ["A", "B", "E"]),
            ("set", ["A", "C", "F"]),
            ("get", ["A", "B"]),
            ("get", ["A", "D"]),
            ("delete", ["A", "B"]),
            ("delete", ["A", "D"]),
            ("get", ["A", "B"]),
        ]),
        make_test("overwrite a field", [
            ("set", ["user1", "name", "ada"]),
            ("set", ["user1", "name", "grace"]),
            ("get", ["user1", "name"]),
            ("get", ["user2", "name"]),
        ]),
    ]


def stage1_hidden(rng):
    tests = list(stage1_public())
    tests += [
        make_test("get from an empty database", [("get", ["A", "B"])]),
        make_test("delete from an empty database", [("delete", ["A", "B"])]),
        make_test("records are independent", [
            ("set", ["A", "x", "1"]),
            ("set", ["B", "x", "2"]),
            ("get", ["A", "x"]),
            ("get", ["B", "x"]),
            ("delete", ["A", "x"]),
            ("get", ["B", "x"]),
        ]),
        make_test("delete twice", [
            ("set", ["A", "x", "1"]),
            ("delete", ["A", "x"]),
            ("delete", ["A", "x"]),
            ("get", ["A", "x"]),
        ]),
        make_test("set after delete", [
            ("set", ["A", "x", "1"]),
            ("delete", ["A", "x"]),
            ("set", ["A", "x", "2"]),
            ("get", ["A", "x"]),
        ]),
        make_test("empty strings are valid", [
            ("set", ["", "", ""]),
            ("get", ["", ""]),
            ("delete", ["", ""]),
            ("get", ["", ""]),
        ]),
    ]
    for i in range(6):
        tests.append(make_test("random operations #%d" % (i + 1), random_stage1_calls(rng, 60)))
    return tests


def random_stage1_calls(rng, n):
    keys, fields = ["A", "B", "C"], ["x", "y", "z", "w"]
    calls = []
    for _ in range(n):
        r = rng.random()
        key, field = rng.choice(keys), rng.choice(fields)
        if r < 0.45:
            calls.append(("set", [key, field, str(rng.randint(0, 99))]))
        elif r < 0.75:
            calls.append(("get", [key, field]))
        else:
            calls.append(("delete", [key, field]))
    return calls


# ---------------------------------------------------------------- stage 2

def stage2_public():
    return [
        make_test("scan by prefix", [
            ("set", ["A", "BC", "E"]),
            ("set", ["A", "BD", "F"]),
            ("set", ["A", "C", "G"]),
            ("scan_by_prefix", ["A", "B"]),
            ("scan", ["A"]),
            ("scan_by_prefix", ["B", "B"]),
        ]),
        make_test("scan is sorted by field", [
            ("set", ["user", "zip", "94110"]),
            ("set", ["user", "age", "36"]),
            ("set", ["user", "city", "SF"]),
            ("scan", ["user"]),
        ]),
    ]


def stage2_hidden(rng):
    tests = list(stage2_public())
    tests += [
        make_test("scan a missing record", [("scan", ["nope"]), ("scan_by_prefix", ["nope", "a"])]),
        make_test("scan after deletes", [
            ("set", ["A", "a", "1"]),
            ("set", ["A", "b", "2"]),
            ("set", ["A", "c", "3"]),
            ("delete", ["A", "b"]),
            ("scan", ["A"]),
            ("delete", ["A", "a"]),
            ("delete", ["A", "c"]),
            ("scan", ["A"]),
        ]),
        make_test("prefix equal to a field name", [
            ("set", ["A", "ab", "1"]),
            ("set", ["A", "abc", "2"]),
            ("set", ["A", "abd", "3"]),
            ("set", ["A", "b", "4"]),
            ("scan_by_prefix", ["A", "ab"]),
            ("scan_by_prefix", ["A", "abc"]),
            ("scan_by_prefix", ["A", "abcd"]),
        ]),
        make_test("empty prefix matches everything", [
            ("set", ["A", "b", "1"]),
            ("set", ["A", "a", "2"]),
            ("scan_by_prefix", ["A", ""]),
        ]),
        make_test("overwritten values show up in scans", [
            ("set", ["A", "k", "old"]),
            ("set", ["A", "k", "new"]),
            ("scan", ["A"]),
        ]),
        make_test("lexicographic, not numeric, order", [
            ("set", ["A", "10", "x"]),
            ("set", ["A", "9", "y"]),
            ("set", ["A", "1", "z"]),
            ("set", ["A", "Z", "upper"]),
            ("set", ["A", "a", "lower"]),
            ("scan", ["A"]),
        ]),
        make_test("records are scanned independently", [
            ("set", ["A", "x", "1"]),
            ("set", ["B", "x", "2"]),
            ("set", ["B", "y", "3"]),
            ("scan", ["A"]),
            ("scan", ["B"]),
        ]),
    ]
    for i in range(6):
        tests.append(make_test("random operations #%d" % (i + 1), random_stage2_calls(rng, 80)))
    return tests


FIELDS2 = ["a", "ab", "abc", "abd", "b", "ba", "bb", "c", "ca"]
PREFIXES2 = ["", "a", "ab", "abc", "b", "c", "d", "ba"]


def random_stage2_calls(rng, n):
    keys = ["A", "B"]
    calls = []
    for _ in range(n):
        r = rng.random()
        key, field = rng.choice(keys), rng.choice(FIELDS2)
        if r < 0.4:
            calls.append(("set", [key, field, str(rng.randint(0, 99))]))
        elif r < 0.55:
            calls.append(("get", [key, field]))
        elif r < 0.7:
            calls.append(("delete", [key, field]))
        elif r < 0.8:
            calls.append(("scan", [key]))
        else:
            calls.append(("scan_by_prefix", [key, rng.choice(PREFIXES2)]))
    return calls


# ---------------------------------------------------------------- stage 3

def stage3_public():
    return [
        make_test("TTL is replaced on set", [
            ("set_at_with_ttl", ["A", "BC", "E", 1, 9]),
            ("set_at_with_ttl", ["A", "BC", "E", 5, 10]),
            ("set_at", ["A", "BD", "F", 5]),
            ("scan_by_prefix_at", ["A", "B", 14]),
            ("scan_by_prefix_at", ["A", "B", 15]),
        ]),
        make_test("expired fields disappear", [
            ("set_at_with_ttl", ["A", "B", "C", 1, 10]),
            ("set_at", ["A", "D", "E", 2]),
            ("get_at", ["A", "B", 10]),
            ("get_at", ["A", "B", 11]),
            ("scan_at", ["A", 12]),
            ("delete_at", ["A", "B", 13]),
            ("delete_at", ["A", "D", 14]),
            ("get_at", ["A", "D", 15]),
        ]),
    ]


def stage3_hidden(rng):
    tests = list(stage3_public())
    tests += [
        make_test("expiry boundary is exclusive", [
            ("set_at_with_ttl", ["A", "x", "1", 10, 5]),
            ("get_at", ["A", "x", 14]),
            ("get_at", ["A", "x", 15]),
        ]),
        make_test("set_at clears a previous TTL", [
            ("set_at_with_ttl", ["A", "x", "1", 1, 3]),
            ("set_at", ["A", "x", "2", 2]),
            ("get_at", ["A", "x", 100]),
        ]),
        make_test("set_at_with_ttl replaces a permanent field", [
            ("set_at", ["A", "x", "1", 1]),
            ("set_at_with_ttl", ["A", "x", "2", 2, 3]),
            ("get_at", ["A", "x", 4]),
            ("get_at", ["A", "x", 5]),
        ]),
        make_test("deleting an expired field returns False", [
            ("set_at_with_ttl", ["A", "x", "1", 1, 2]),
            ("delete_at", ["A", "x", 3]),
            ("scan_at", ["A", 4]),
        ]),
        make_test("re-set an expired field", [
            ("set_at_with_ttl", ["A", "x", "1", 1, 2]),
            ("get_at", ["A", "x", 5]),
            ("set_at_with_ttl", ["A", "x", "2", 6, 2]),
            ("get_at", ["A", "x", 7]),
            ("scan_at", ["A", 7]),
        ]),
        make_test("prefix scan skips expired fields", [
            ("set_at_with_ttl", ["A", "aa", "1", 1, 5]),
            ("set_at_with_ttl", ["A", "ab", "2", 2, 100]),
            ("set_at", ["A", "ac", "3", 3]),
            ("set_at_with_ttl", ["A", "b", "4", 4, 1]),
            ("scan_by_prefix_at", ["A", "a", 5]),
            ("scan_by_prefix_at", ["A", "a", 6]),
            ("scan_at", ["A", 7]),
        ]),
    ]
    for i in range(6):
        tests.append(make_test("random timed operations #%d" % (i + 1), random_stage3_calls(rng, 120)))
    tests.append(make_test(
        "scale: prefix scans over a large record",
        perf_prefix_scans(rng, PERF_FIELDS),
        PERF_TIME_LIMIT_MS,
    ))
    tests.append(make_test(
        "scale: many expiring fields",
        perf_expiring_fields(rng, PERF_FIELDS),
        PERF_TIME_LIMIT_MS,
    ))
    return tests


def random_stage3_calls(rng, n, start=1, allow_backup=False):
    keys = ["A", "B"]
    calls = []
    t = start
    backups = []
    for _ in range(n):
        t += rng.randint(1, 3)
        key, field = rng.choice(keys), rng.choice(FIELDS2)
        r = rng.random()
        if allow_backup and r < 0.06:
            calls.append(("backup", [t]))
            backups.append(t)
            continue
        if allow_backup and r < 0.1 and backups:
            calls.append(("restore", [t, rng.randint(backups[0], t - 1)]))
            continue
        r = rng.random()
        if r < 0.25:
            calls.append(("set_at_with_ttl", [key, field, str(rng.randint(0, 99)), t, rng.randint(1, 12)]))
        elif r < 0.4:
            calls.append(("set_at", [key, field, str(rng.randint(0, 99)), t]))
        elif r < 0.55:
            calls.append(("get_at", [key, field, t]))
        elif r < 0.65:
            calls.append(("delete_at", [key, field, t]))
        elif r < 0.75:
            calls.append(("scan_at", [key, t]))
        else:
            calls.append(("scan_by_prefix_at", [key, rng.choice(PREFIXES2), t]))
    return calls


def perf_prefix_scans(rng, n):
    """One record grows to n fields; after every insert we run a narrow prefix
    scan. Filtering or sorting the whole record per scan is O(n^2)."""
    calls = []
    t = 0
    for i in range(n):
        t += 1
        field = "%06x" % rng.randrange(16 ** 6)
        if i % 5 == 0:
            calls.append(("set_at_with_ttl", ["big", field, "v%d" % i, t, rng.randint(1, 2000)]))
        else:
            calls.append(("set_at", ["big", field, "v%d" % i, t]))
        t += 1
        calls.append(("scan_by_prefix_at", ["big", "%04x" % rng.randrange(16 ** 4), t]))
    return calls


def perf_expiring_fields(rng, n):
    """Many short-lived fields. Sweeping every stored field on each operation
    is O(n^2)."""
    calls = []
    t = 0
    for i in range(n):
        t += 1
        calls.append(("set_at_with_ttl", ["k", "f%06d" % i, "v", t, rng.randint(1, 3000)]))
        t += 1
        calls.append(("get_at", ["k", "f%06d" % rng.randrange(i + 1), t]))
        if i % 3 == 0:
            t += 1
            calls.append(("delete_at", ["k", "f%06d" % rng.randrange(i + 1), t]))
    t += 1
    calls.append(("scan_by_prefix_at", ["k", "f0249", t]))
    return calls


# ---------------------------------------------------------------- stage 4

def stage4_public():
    return [
        make_test("backup and restore keep remaining TTL", [
            ("set_at_with_ttl", ["A", "B", "C", 1, 10]),
            ("backup", [3]),
            ("set_at", ["A", "D", "E", 4]),
            ("backup", [5]),
            ("delete_at", ["A", "B", 8]),
            ("backup", [9]),
            ("restore", [10, 7]),
            ("scan_at", ["A", 15]),
            ("scan_at", ["A", 16]),
        ]),
        make_test("backup counts non-empty records", [
            ("set_at", ["A", "x", "1", 1]),
            ("set_at_with_ttl", ["B", "y", "2", 2, 3]),
            ("backup", [3]),
            ("backup", [5]),
        ]),
    ]


def stage4_hidden(rng):
    tests = list(stage4_public())
    tests += [
        make_test("backup of an empty database", [
            ("backup", [1]),
            ("set_at", ["A", "x", "1", 2]),
            ("restore", [3, 1]),
            ("get_at", ["A", "x", 4]),
            ("scan_at", ["A", 5]),
        ]),
        make_test("restore picks the latest backup at or before the time", [
            ("set_at", ["A", "x", "1", 1]),
            ("backup", [2]),
            ("set_at", ["A", "x", "2", 3]),
            ("backup", [4]),
            ("set_at", ["A", "x", "3", 5]),
            ("restore", [6, 4]),
            ("get_at", ["A", "x", 7]),
            ("restore", [8, 3]),
            ("get_at", ["A", "x", 9]),
        ]),
        make_test("restore twice from the same backup", [
            ("set_at_with_ttl", ["A", "x", "1", 1, 20]),
            ("backup", [5]),
            ("restore", [10, 5]),
            ("get_at", ["A", "x", 24]),
            ("get_at", ["A", "x", 25]),
            ("restore", [30, 6]),
            ("get_at", ["A", "x", 44]),
            ("get_at", ["A", "x", 45]),
        ]),
        make_test("expired fields are not backed up", [
            ("set_at_with_ttl", ["A", "x", "1", 1, 2]),
            ("set_at_with_ttl", ["B", "y", "1", 2, 100]),
            ("backup", [5]),
            ("restore", [6, 5]),
            ("get_at", ["A", "x", 7]),
            ("scan_at", ["B", 8]),
        ]),
        make_test("changes after a backup do not leak into it", [
            ("set_at", ["A", "x", "1", 1]),
            ("backup", [2]),
            ("set_at", ["A", "y", "2", 3]),
            ("delete_at", ["A", "x", 4]),
            ("restore", [5, 2]),
            ("scan_at", ["A", 6]),
            ("set_at", ["A", "z", "3", 7]),
            ("restore", [8, 2]),
            ("scan_at", ["A", 9]),
        ]),
        make_test("restore drops records created after the backup", [
            ("set_at", ["A", "x", "1", 1]),
            ("backup", [2]),
            ("set_at", ["B", "x", "1", 3]),
            ("restore", [4, 2]),
            ("scan_at", ["B", 5]),
            ("backup", [6]),
        ]),
        make_test("permanent fields stay permanent after restore", [
            ("set_at", ["A", "x", "1", 1]),
            ("backup", [2]),
            ("restore", [1000, 2]),
            ("get_at", ["A", "x", 100000]),
        ]),
    ]
    for i in range(6):
        tests.append(make_test(
            "random timed operations with backups #%d" % (i + 1),
            random_stage3_calls(rng, 150, allow_backup=True),
        ))
    tests.append(make_test(
        "medium: frequent backups",
        random_stage3_calls(rng, 3000, allow_backup=True),
        PERF_TIME_LIMIT_MS,
    ))
    return tests


def main():
    rng = random.Random(20261013)
    builders = [
        (stage1_public, stage1_hidden),
        (stage2_public, stage2_hidden),
        (stage3_public, stage3_hidden),
        (stage4_public, stage4_hidden),
    ]
    os.makedirs(TESTS_DIR, exist_ok=True)
    for n, (public, hidden) in enumerate(builders, start=1):
        write(os.path.join(TESTS_DIR, "stage%d_public.json" % n), public())
        hidden_tests = hidden(rng)
        write(os.path.join(TESTS_DIR, "stage%d_hidden.json" % n), hidden_tests)
        print("stage %d: %d public, %d hidden" % (n, len(public()), len(hidden_tests)))


if __name__ == "__main__":
    main()
