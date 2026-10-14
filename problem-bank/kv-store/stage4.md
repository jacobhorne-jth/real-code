# Stage 4: Backup and restore

The database must support point-in-time recovery.

Add:

- `backup(timestamp) -> int`
  Save a snapshot of the database as it is at `timestamp`. Return the number of
  records that have at least one field existing at `timestamp`.
- `restore(timestamp, timestamp_to_restore) -> None`
  Replace the database with the most recent backup taken at or before
  `timestamp_to_restore`. A backup that early is guaranteed to exist.
  Fields with a TTL keep the **remaining** lifetime they had when the backup
  was taken: if a field had 5 time units left at backup time, after the restore
  it expires 5 units after `timestamp`. Backups remain available after a
  restore, and restoring does not create a new backup.

`timestamp` keeps increasing across all calls, as in Stage 3
(`timestamp_to_restore` is always earlier than `timestamp`).

## Example

```python
db = InMemoryDB()
db.set_at_with_ttl("A", "B", "C", 1, 10)   # exists during [1, 11)
db.backup(3)                               # 1  (A has 8 time units left)
db.set_at("A", "D", "E", 4)
db.backup(5)                               # 1
db.delete_at("A", "B", 8)                  # True
db.backup(9)                               # 1
db.restore(10, 7)                          # restores the backup from 5
db.scan_at("A", 15)                        # ["B(C)", "D(E)"]  B now expires at 16
db.scan_at("A", 16)                        # ["D(E)"]
```
