# Stage 2: Scanning fields

The database now needs to list what a record contains.

Add:

- `scan(key) -> list[str]`
  Return every field of the record at `key` as strings formatted
  `"<field>(<value>)"`, sorted lexicographically by field name. Return an empty
  list if the record does not exist.
- `scan_by_prefix(key, prefix) -> list[str]`
  Same as `scan`, but only fields whose name starts with `prefix`.

Everything from Stage 1 must keep working.

## Example

```python
db = InMemoryDB()
db.set("A", "BC", "E")
db.set("A", "BD", "F")
db.set("A", "C", "G")
db.scan_by_prefix("A", "B")   # ["BC(E)", "BD(F)"]
db.scan("A")                  # ["BC(E)", "BD(F)", "C(G)"]
db.scan_by_prefix("B", "B")   # []
```
