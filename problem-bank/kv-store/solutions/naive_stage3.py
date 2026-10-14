from bisect import bisect_left, insort


class InMemoryDB:
    """Passes stage 3 with sorted field lists and absolute expiry times, but
    keeps no history and has no notion of saving or restoring state."""

    def __init__(self):
        self.values = {}  # key -> {field: (value, expires_at or None)}
        self.names = {}   # key -> sorted list of field names

    def _alive(self, entry, now):
        return entry[1] is None or now is None or entry[1] > now

    def _set(self, key, field, value, expires_at):
        fields = self.values.setdefault(key, {})
        if field not in fields:
            insort(self.names.setdefault(key, []), field)
        fields[field] = (value, expires_at)

    def _get(self, key, field, now):
        entry = self.values.get(key, {}).get(field)
        if entry is None or not self._alive(entry, now):
            return None
        return entry[0]

    def _delete(self, key, field, now):
        fields = self.values.get(key, {})
        entry = fields.get(field)
        if entry is None:
            return False
        del fields[field]
        names = self.names[key]
        del names[bisect_left(names, field)]
        return self._alive(entry, now)

    def _scan(self, key, prefix, now):
        fields = self.values.get(key, {})
        names = self.names.get(key, [])
        out = []
        i = bisect_left(names, prefix)
        while i < len(names) and names[i].startswith(prefix):
            entry = fields[names[i]]
            if self._alive(entry, now):
                out.append("%s(%s)" % (names[i], entry[0]))
            i += 1
        return out

    def set(self, key, field, value):
        self._set(key, field, value, None)

    def get(self, key, field):
        return self._get(key, field, None)

    def delete(self, key, field):
        return self._delete(key, field, None)

    def scan(self, key):
        return self._scan(key, "", None)

    def scan_by_prefix(self, key, prefix):
        return self._scan(key, prefix, None)

    def set_at(self, key, field, value, timestamp):
        self._set(key, field, value, None)

    def set_at_with_ttl(self, key, field, value, timestamp, ttl):
        self._set(key, field, value, timestamp + ttl)

    def get_at(self, key, field, timestamp):
        return self._get(key, field, timestamp)

    def delete_at(self, key, field, timestamp):
        return self._delete(key, field, timestamp)

    def scan_at(self, key, timestamp):
        return self._scan(key, "", timestamp)

    def scan_by_prefix_at(self, key, prefix, timestamp):
        return self._scan(key, prefix, timestamp)
