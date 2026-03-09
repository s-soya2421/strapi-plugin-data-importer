# strapi-plugin-data-importer

Strapi v5 plugin to import content records from CSV or JSON files via the admin panel.

## Features

- **Step-by-step import wizard** in the admin panel
- **CSV and JSON** file format support
- **Auto field mapping** — columns/keys are automatically matched to Strapi fields
- **CSV template download** for each content type
- **Data preview** — shows the first 5 rows before importing
- **Create mode** — always insert new records
- **Upsert mode** — update existing records by a key field, or create if not found
- **Dry run** — validate and simulate without writing any data
- **Rollback on failure** — automatically delete created records if any row fails
- **Field type validation** — validates integers, floats, booleans, emails, and enumerations before import
- **Required field validation** — rejects rows missing required fields
- **Batch size control** — split large imports into smaller chunks (default: 100 rows per batch)
- **Import progress display** — shows a progress bar and row counter during import
- **Failed rows table** — view failing rows alongside their error messages, with a retry button
- **Import history** — view the last 50 import runs (created / updated / failed counts)
- **RBAC support** — separate plugin permissions for read and import execution
- **Content-type permission enforcement** — import respects each user's create/update/read permissions on the target content type; rows the user cannot write are rejected with a clear error message
- **Data sanitization** — imported data is sanitized through Strapi's permission-checker, stripping any fields the user is not allowed to set

## Requirements

- Strapi v5

## Installation

```bash
npm install strapi-plugin-data-importer
```

## Configuration

Enable the plugin in `config/plugins.ts` (or `config/plugins.js`):

```ts
export default {
  'data-importer': {
    enabled: true,
  },
};
```

### Column mapping (optional)

You can define fixed column → Strapi field mappings per content type.
Create `config/data-importer-mappings.json`:

```json
{
  "api::article.article": {
    "Title": "title",
    "Body": "content",
    "Published": "publishedAt"
  }
}
```

When a mapping file is present, the CSV template download uses the mapping's column names (left side) as headers.

## Usage

1. Open the Strapi admin panel and click **Data Importer** in the sidebar.
2. **Step 1 — Select content type**: choose the target collection type, then optionally download a CSV template.
3. **Step 2 — Upload file**: select CSV or JSON format, then upload your file. A preview of the first 5 rows is shown.
4. **Step 3 — Map columns**: confirm or adjust how each file column maps to a Strapi field. Required fields are marked with `*`.
5. **Step 4 — Configure and run**:
   - Choose **import mode** (Create or Upsert).
   - Optionally enable **Dry run** or **Rollback on failure**.
   - Adjust **Batch size** if needed.
   - Click **Import N records**.
6. **Step 5 — Results**: view created / updated / failed counts. Failed rows are shown in a table with error details, and can be retried with a single click.

Past imports are listed in the **Import History** section at the bottom of the page.

## File formats

### CSV

The first row must be a header row. Values are always strings; the plugin converts them to the correct type based on the Strapi field type.

```csv
title,views,active,publishedAt
Hello World,42,true,2024-01-15
Another Post,100,false,2024-02-01
```

### JSON

Provide a JSON array of objects. Nested objects and arrays are flattened automatically:

| Nested value type | Converted to |
|---|---|
| `null` / `undefined` | empty string (skipped) |
| Array of objects with `documentId` | comma-separated document IDs (relation) |
| Array of objects with `id` | comma-separated numeric IDs (media) |
| Array of primitives | comma-separated string |
| Other arrays / plain objects | JSON string |

```json
[
  { "title": "Hello", "views": 42, "tags": [{ "documentId": "abc123" }] },
  { "title": "World", "views": 100 }
]
```

## Field types

### Type conversion

| Strapi type | Input format |
|---|---|
| `integer`, `biginteger` | Whole number string, e.g. `"42"` |
| `float`, `decimal` | Decimal string, e.g. `"3.14"` |
| `boolean` | `"true"`, `"false"`, `"1"`, or `"0"` |
| `relation` | Comma-separated `documentId` values, e.g. `"abc123,def456"` |
| `media` | Comma-separated numeric file IDs, e.g. `"1,2,3"` |
| `date` | ISO date string, e.g. `"2024-01-15"` |
| `datetime` | ISO datetime string, e.g. `"2024-01-15T10:00:00.000Z"` |
| `string`, `text`, `email`, `enumeration`, etc. | String as-is |

Date/time fields not included in the file are automatically filled with the current date/time.

### Validation

The following fields are validated before import. Rows that fail validation are counted as failed and shown in the results table.

| Strapi type | Rule |
|---|---|
| `integer`, `biginteger` | Must match `/^-?\d+$/` |
| `float`, `decimal` | Must be parseable as a number |
| `boolean` | Must be one of `true`, `false`, `1`, `0` (case-insensitive) |
| `email` | Must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (no spaces, must contain `@` and a dot in the domain) |
| `enumeration` | Must be one of the configured enum values |
| Required fields | Must not be empty |

## Import options

### Import mode

| Mode | Behavior |
|---|---|
| **Create** (default) | Always insert a new record for every row |
| **Upsert** | Search for an existing record by the selected key field. The key field must be marked `unique` in the content type. If one match is found, update it; if none, create a new one. If more than one match is found, the row fails with an error and is shown in the failed rows table. |

### Dry run

When enabled, all validation runs and results are calculated normally, but no data is written to the database. Useful for previewing what would happen before committing.

### Rollback on failure

When enabled, if any row in the import fails, all records created during that run are automatically deleted and counted as failed. Note: updates performed in Upsert mode cannot be rolled back.

### Batch size

Large files are split into batches before being sent to the server (default: 100 rows per batch). Reducing the batch size can help avoid timeouts on slow connections or large payloads.

## Permissions

The plugin enforces Strapi's content-type permissions before and during import:

| Import mode | Required permissions |
|---|---|
| **Create** | `create` on the target content type |
| **Upsert** | `read` on the target content type, plus `create` and/or `update` |

If the current user lacks the required permission at the start of an import, the entire run is rejected. For upsert imports, each row is also checked individually — a row that the user cannot update (e.g. due to field-level conditions) is counted as failed and shown in the results table.

Imported data is automatically sanitized through Strapi's permission-checker, so fields the user is not allowed to set are silently stripped before the record is written.

To grant a role access to import, configure the role in **Settings → Roles** and enable the relevant create/update permissions for the target content type, in addition to the Data Importer plugin permissions.

## Import history

After each import, a summary entry is saved to Strapi's internal store (up to 50 entries, newest first). The history table in the UI shows the date/time, content type, mode, and counts for the last 10 runs. Dry-run entries are marked with a checkmark.

## Staging validation runbook

For end-to-end staging checks with real schema/files, large-file performance tests, and backup/restore drills, see:

- `docs/staging-test-runbook.md`

## License

MIT
