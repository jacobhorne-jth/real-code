# Stage 1: Basic records

You're building a simplified in-memory database. The database holds **records**,
each identified by a string `key`. A record holds any number of **fields**, each a
string name mapped to a string value.

Implement the class `InMemoryDB` with:

- `set(key, field, value) -> None`
  Insert `field` into the record at `key` with the given `value`, creating the
  record if needed. If the field already exists, overwrite its value.
- `get(key, field) -> str | None`
  Return the value of `field` in the record at `key`, or `None` if the record or
  the field does not exist.
- `delete(key, field) -> bool`
  Remove `field` from the record at `key`. Return `True` if the field existed and
  was removed, `False` otherwise. A record with no fields left no longer exists.

## Example

```python
db = InMemoryDB()
db.set("A", "B", "E")      # None
db.set("A", "C", "F")      # None
db.get("A", "B")           # "E"
db.get("A", "D")           # None
db.delete("A", "B")        # True
db.delete("A", "D")        # False
db.get("A", "B")           # None
```

Each test creates a fresh `InMemoryDB()` and calls methods in order.
