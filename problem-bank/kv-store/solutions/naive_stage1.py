class InMemoryDB:
    """One flat dict keyed by (key, field): simplest thing that passes stage 1."""

    def __init__(self):
        self.data = {}

    def set(self, key, field, value):
        self.data[(key, field)] = value

    def get(self, key, field):
        return self.data.get((key, field))

    def delete(self, key, field):
        return self.data.pop((key, field), None) is not None
