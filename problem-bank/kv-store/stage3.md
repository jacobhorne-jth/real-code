# Stage 3: Timestamps and TTL

Fields can now be written with a time-to-live. Every operation in this stage
takes a `timestamp` (an integer). Within one test, timestamps passed to these
methods are **strictly increasing**. A test uses either the methods from earlier
stages or the `_at` methods below, never a mix of both.

Add:

- `set_at(key, field, value, timestamp) -> None`
  Like `set`; the field never expires.
- `set_at_with_ttl(key, field, value, timestamp, ttl) -> None`
  Like `set`, but the field only exists during `[timestamp, timestamp + ttl)`.
  Setting a field again replaces both its value and its expiry.
- `delete_at(key, field, timestamp) -> bool`
  Like `delete`; returns `True` only if the field exists (and has not expired)
  at `timestamp`.
- `get_at(key, field, timestamp) -> str | None`
- `scan_at(key, timestamp) -> list[str]`
- `scan_by_prefix_at(key, prefix, timestamp) -> list[str]`
  Like their Stage 1–2 counterparts, considering only fields that exist at
  `timestamp`.

## Scale

Hidden tests include single tests with **tens of thousands** of operations on
one record (many fields, many prefix scans, many expiring fields), each with a
time limit of a few seconds. Plan your data structures accordingly.

## Example

```python
db = InMemoryDB()
db.set_at_with_ttl("A", "BC", "E", 1, 9)   # exists during [1, 10)
db.set_at_with_ttl("A", "BC", "E", 5, 10)  # replaced: exists during [5, 15)
db.set_at("A", "BD", "F", 5)
db.scan_by_prefix_at("A", "B", 14)         # ["BC(E)", "BD(F)"]
db.scan_by_prefix_at("A", "B", 15)         # ["BD(F)"]
```
