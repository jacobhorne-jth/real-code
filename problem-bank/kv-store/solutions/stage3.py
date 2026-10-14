from bisect import bisect_left, insort

NEVER = float("inf")


class Record:
    """Fields of one record. Each value carries an absolute expiry time;
    expired fields are dropped lazily when they are encountered."""

    def __init__(self):
        self.values = {}  # field -> (value, expires_at)
        self.names = []   # field names, kept sorted

    def set(self, field, value, expires_at):
        if field not in self.values:
            insort(self.names, field)
        self.values[field] = (value, expires_at)

    def _remove(self, field):
        del self.values[field]
        del self.names[bisect_left(self.names, field)]

    def get(self, field, now):
        entry = self.values.get(field)
        if entry is None:
            return None
        if entry[1] <= now:
            self._remove(field)
            return None
        return entry[0]

    def delete(self, field, now):
        if self.get(field, now) is None:
            return False
        self._remove(field)
        return True

    def scan(self, prefix, now):
        out = []
        expired = []
        names = self.names
        i = bisect_left(names, prefix)
        while i < len(names) and names[i].startswith(prefix):
            name = names[i]
            value, expires_at = self.values[name]
            if expires_at <= now:
                expired.append(name)
            else:
                out.append("%s(%s)" % (name, value))
            i += 1
        for name in expired:
            self._remove(name)
        return out

    def live_items(self, now):
        return [(f, v, e) for f, (v, e) in self.values.items() if e > now]


class InMemoryDB:
    def __init__(self):
        self.records = {}

    def _record(self, key):
        record = self.records.get(key)
        if record is None:
            record = self.records[key] = Record()
        return record

    def _cleanup(self, key):
        record = self.records.get(key)
        if record is not None and not record.values:
            del self.records[key]

    # Stage 3 operations

    def set_at(self, key, field, value, timestamp):
        self._record(key).set(field, value, NEVER)

    def set_at_with_ttl(self, key, field, value, timestamp, ttl):
        self._record(key).set(field, value, timestamp + ttl)

    def get_at(self, key, field, timestamp):
        record = self.records.get(key)
        if record is None:
            return None
        value = record.get(field, timestamp)
        self._cleanup(key)
        return value

    def delete_at(self, key, field, timestamp):
        record = self.records.get(key)
        if record is None:
            return False
        deleted = record.delete(field, timestamp)
        self._cleanup(key)
        return deleted

    def scan_at(self, key, timestamp):
        return self.scan_by_prefix_at(key, "", timestamp)

    def scan_by_prefix_at(self, key, prefix, timestamp):
        record = self.records.get(key)
        if record is None:
            return []
        out = record.scan(prefix, timestamp)
        self._cleanup(key)
        return out

    # Stage 1-2 operations: no expiry, so time never advances.

    def set(self, key, field, value):
        self.set_at(key, field, value, 0)

    def get(self, key, field):
        return self.get_at(key, field, -NEVER)

    def delete(self, key, field):
        return self.delete_at(key, field, -NEVER)

    def scan(self, key):
        return self.scan_at(key, -NEVER)

    def scan_by_prefix(self, key, prefix):
        return self.scan_by_prefix_at(key, prefix, -NEVER)
