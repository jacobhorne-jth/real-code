from bisect import bisect_left, insort


class Record:
    def __init__(self):
        self.values = {}
        self.names = []  # field names, kept sorted

    def set(self, field, value):
        if field not in self.values:
            insort(self.names, field)
        self.values[field] = value

    def delete(self, field):
        if field not in self.values:
            return False
        del self.values[field]
        i = bisect_left(self.names, field)
        del self.names[i]
        return True

    def scan(self, prefix=""):
        out = []
        i = bisect_left(self.names, prefix)
        while i < len(self.names) and self.names[i].startswith(prefix):
            name = self.names[i]
            out.append("%s(%s)" % (name, self.values[name]))
            i += 1
        return out


class InMemoryDB:
    def __init__(self):
        self.records = {}

    def set(self, key, field, value):
        record = self.records.get(key)
        if record is None:
            record = self.records[key] = Record()
        record.set(field, value)

    def get(self, key, field):
        record = self.records.get(key)
        return None if record is None else record.values.get(field)

    def delete(self, key, field):
        record = self.records.get(key)
        if record is None or not record.delete(field):
            return False
        if not record.values:
            del self.records[key]
        return True

    def scan(self, key):
        return self.scan_by_prefix(key, "")

    def scan_by_prefix(self, key, prefix):
        record = self.records.get(key)
        return [] if record is None else record.scan(prefix)
