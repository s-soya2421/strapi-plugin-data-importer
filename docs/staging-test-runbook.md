# Staging Test Runbook (Strapi v5 + Real Schema + Real CSV/JSON)

This runbook covers:

1. End-to-end validation on staging with real Strapi v5 schema and real files
2. Performance and timeout checks for large imports (thousands to 10k rows)
3. Backup/restore operation checks, including upsert-update rollback limits

## 0) Pre-check

- Confirm plugin version deployed to staging.
- Confirm target content-type key field is `unique` when using upsert mode.
- Prepare DB backup/restore commands and validate credentials before import.
- Enable app and DB logs for the test window.

Reference behavior:

- `rollbackOnFailure` deletes created records in the same import run.
- Upsert updates are not rolled back by plugin rollback.

## 1) Staging E2E Validation (Real schema + real files)

### Input set

- A real CSV or JSON file currently used by business users.
- Include at least:
  - New rows only
  - Existing rows by upsert key (to force updates)
  - One intentionally invalid row (for failure handling)

### Steps

1. Run import with `dryRun=true` and record result counts (`success`, `updated`, `failed`).
2. Run import in create mode (`dryRun=false`, `rollbackOnFailure=false`) for a new-only subset.
3. Verify record count delta in DB and in Strapi admin list view.
4. Run import in upsert mode with real key field.
5. Verify:
   - Existing rows are updated.
   - Non-existing rows are created.
   - Invalid rows appear in failed table with row-numbered errors.
6. Confirm import history entry is written and visible.

### Pass criteria

- Dry run writes no records.
- Create mode inserts expected row count.
- Upsert mode reports expected `updated` and `success`.
- Failed rows and errors are actionable (row-based and reproducible).
- History contains correct mode/counts.

## 2) Large Import Performance + Timeout Check

### Fixture generation

Use the included generator:

```bash
npm run gen:fixtures -- --rows 10000 --format both --out ./tmp/import-10000
```

Optional failure injection (for rollback path):

```bash
npm run gen:fixtures -- --rows 5000 --invalid-row 3200 --format csv --out ./tmp/import-5000-invalid
```

### Test matrix (minimum)

- File size: `1000`, `3000`, `10000` rows
- File format: CSV and JSON
- Batch size: `100` (default), `50`, `20`
- Mode: create and upsert

### Steps

1. Start with `dryRun=true` for each size/format.
2. Run real import (`dryRun=false`) and collect:
   - Total elapsed time
   - Per-chunk duration (from logs)
   - Peak DB CPU and connection usage
   - Timeout/retry occurrences (HTTP 408/504 or gateway errors)
3. If timeout occurs, reduce batch size and rerun same file.
4. Record best stable batch size per row count.

### Pass criteria

- No unhandled timeout at agreed target size.
- No data corruption (counts and key uniqueness preserved).
- Repeat run variance is acceptable for your SLO.

## 3) Backup/Restore Operation Check

Plugin rollback cannot undo upsert updates. Therefore backup is mandatory before non-dry-run upsert.

### Required operational rule

- For any upsert import in staging/production:
  1. DB backup first
  2. Dry run
  3. Real run
  4. Post-check query

### Drill procedure

1. Take DB backup snapshot.
2. Run an upsert import that includes updates.
3. Validate updated rows changed as expected.
4. Perform DB restore in staging from pre-import snapshot.
5. Re-validate restored data equals pre-import baseline.

### Pass criteria

- Backup artifacts are valid and restorable.
- Restore time (RTO) and data loss window (RPO) meet team requirements.
- Team can execute the full rollback playbook without plugin-level rollback dependency.

## Suggested result sheet

Track each run with:

- Date/time
- Environment
- Content type
- File name + row count + format
- Mode + key field + batch size
- Dry run / rollback flag
- success / updated / failed counts
- Duration and timeout notes
- Backup ID and restore verification result
