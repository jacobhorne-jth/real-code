class InMemoryDB:
    def __init__(self):
        # key -> {field: value}
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
