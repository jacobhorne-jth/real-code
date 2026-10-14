class InMemoryDB:
    """Dict of dicts; every scan filters and sorts all fields of the record."""

    def __init__(self):
        self.records = {}

    def set(self, key, field, value):
        self.records.setdefault(key, {})[field] = value

    def get(self, key, field):
        return self.records.get(key, {}).get(field)

    def delete(self, key, field):
        record = self.records.get(key)
        if record is None or field not in record:
            return False
        del record[field]
        if not record:
            del self.records[key]
        return True

    def scan(self, key):
        return self.scan_by_prefix(key, "")

    def scan_by_prefix(self, key, prefix):
        record = self.records.get(key, {})
        return ["%s(%s)" % (f, record[f]) for f in sorted(record) if f.startswith(prefix)]
