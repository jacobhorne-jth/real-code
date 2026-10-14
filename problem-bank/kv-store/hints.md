# Hints

## Stage 1
- A dictionary of dictionaries (`key -> field -> value`) is enough.
- Remember to drop a record once its last field is deleted.

## Stage 2
- Sorting all fields on every scan works here, but think about what happens if
  scans become frequent and records grow large.

## Stage 3
- Keeping each record's field names in a sorted list lets you find a prefix
  range with `bisect` instead of scanning every field.
- Store an absolute expiry time with each value. Don't sweep the whole database
  on every operation to remove expired fields; check expiry when you read.

## Stage 4
- A backup only needs live fields, and for each one its value and the TTL that
  remained at backup time.
- Restoring re-computes each expiry relative to the restore timestamp.
