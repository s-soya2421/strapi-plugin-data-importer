import React, { useState, useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient } from '@strapi/admin/strapi-admin';
import { parseCSV } from '../utils/parseCSV';
import { parseJSON } from '../utils/parseJSON';

interface FieldInfo {
  name: string;
  type: string;
  relationType?: string;
  multiple?: boolean;
  required?: boolean;
}

interface ContentTypeInfo {
  uid: string;
  displayName: string;
  fields: FieldInfo[];
}

interface ImportResult {
  success: number;
  updated: number;
  failed: number;
  errors: string[];
  failedRows: Record<string, string>[];
}

interface HistoryEntry {
  id: string;
  timestamp: string;
  uid: string;
  displayName: string;
  dryRun: boolean;
  mode: 'create' | 'upsert';
  success: number;
  updated: number;
  failed: number;
  totalRows: number;
}

// CSVヘッダー → Strapiフィールド名 のマッピング型
type FieldMapping = Record<string, string>; // { "CSV列名": "strapiField" }
type AllMappings = Record<string, FieldMapping>; // { "api::uid": { ... } }

const DEFAULT_BATCH_SIZE = 100;

const HomePage = () => {
  const { get, post } = useFetchClient();
  const { formatMessage } = useIntl();

  const [contentTypes, setContentTypes] = useState<ContentTypeInfo[]>([]);
  const [allMappings, setAllMappings] = useState<AllMappings>({});
  const [selectedUid, setSelectedUid] = useState('');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [fieldMapping, setFieldMapping] = useState<FieldMapping>({});
  const [fileFormat, setFileFormat] = useState<'csv' | 'json'>('csv');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [rollbackOnFailure, setRollbackOnFailure] = useState(false);
  const [importMode, setImportMode] = useState<'create' | 'upsert'>('create');
  const [keyField, setKeyField] = useState('');
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [progressRows, setProgressRows] = useState<number | null>(null);
  const [progressTotal, setProgressTotal] = useState<number | null>(null);
  const [batchSize, setBatchSize] = useState(DEFAULT_BATCH_SIZE);
  const [failedRows, setFailedRows] = useState<Record<string, string>[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get('/data-importer/content-types')
      .then((res: any) => setContentTypes(res.data?.data ?? []))
      .catch((err: any) =>
        setError(
          formatMessage(
            { id: 'data-importer.error.fetchContentTypes', defaultMessage: 'Failed to fetch content types: {message}' },
            { message: err.message }
          )
        )
      );
    get('/data-importer/mappings')
      .then((res: any) => setAllMappings(res.data?.data ?? {}))
      .catch(() => {});
    get('/data-importer/history')
      .then((res: any) => {
        const data = res.data?.data;
        setHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, []);

  const selectedContentType = contentTypes.find((ct) => ct.uid === selectedUid);

  const hasRelationOrMediaFields = selectedContentType?.fields.some(
    (f) => f.type === 'relation' || f.type === 'media'
  ) ?? false;

  const handleDownloadTemplate = () => {
    if (!selectedContentType) return;
    const mapping = allMappings[selectedUid];
    // マッピング定義があればCSV列名（左辺）をヘッダーに、なければフィールド名をそのまま使う
    const headers = mapping
      ? Object.keys(mapping).join(',')
      : selectedContentType.fields.map((f) => f.name).join(',');
    const blob = new Blob([headers + '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedContentType.displayName}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = fileFormat === 'json' ? parseJSON(text) : parseCSV(text);
      setCsvHeaders(headers);
      setCsvRows(rows);
      const mapping = allMappings[selectedUid] ?? {};
      const autoMapping: FieldMapping = {};
      headers.forEach((h) => {
        // JSONマッピング定義を優先、なければフィールド名の直接一致を試みる
        autoMapping[h] = mapping[h] ?? (selectedContentType?.fields.find((f) => f.name === h)?.name ?? '');
      });
      setFieldMapping(autoMapping);
      setImportResult(null);
      setFailedRows([]);
    };
    reader.readAsText(file);
  };

  const handleMappingChange = (csvColumn: string, strapiField: string) => {
    setFieldMapping((prev) => ({ ...prev, [csvColumn]: strapiField }));
  };

  const handleImport = async (rowsToImport = csvRows, offset = 0) => {
    if (!selectedUid || rowsToImport.length === 0) return;
    setLoading(true);
    setError(null);
    setImportResult(null);
    setImportProgress(0);
    setProgressRows(null);
    setProgressTotal(rowsToImport.length);

    const effectiveBatchSize = Math.max(1, batchSize);
    const chunks: Record<string, string>[][] = [];
    for (let i = 0; i < rowsToImport.length; i += effectiveBatchSize) {
      chunks.push(rowsToImport.slice(i, i + effectiveBatchSize));
    }

    const accumulated: ImportResult = { success: 0, updated: 0, failed: 0, errors: [], failedRows: [] };

    try {
      for (let c = 0; c < chunks.length; c++) {
        const res: any = await post('/data-importer/import', {
          uid: selectedUid,
          rows: chunks[c],
          fieldMapping,
          dryRun,
          batchOffset: offset + c * effectiveBatchSize,
          importMode,
          keyField: importMode === 'upsert' ? keyField : undefined,
          rollbackOnFailure,
        });
        const chunkResult = res.data?.data;
        if (chunkResult) {
          accumulated.success += chunkResult.success ?? 0;
          accumulated.updated += chunkResult.updated ?? 0;
          accumulated.failed += chunkResult.failed ?? 0;
          accumulated.errors.push(...(chunkResult.errors ?? []));
          accumulated.failedRows.push(...(chunkResult.failedRows ?? []));
        }
        setImportProgress(Math.round(((c + 1) / chunks.length) * 100));
        setProgressRows(Math.min((c + 1) * effectiveBatchSize, rowsToImport.length));
      }
      setImportResult(accumulated);
      setFailedRows(accumulated.failedRows);
      // Refresh history after import
      get('/data-importer/history')
        .then((res: any) => {
          const data = res.data?.data;
          setHistory(Array.isArray(data) ? data : []);
        })
        .catch(() => {});
    } catch (err: any) {
      setError(
        formatMessage(
          { id: 'data-importer.error.importFailed', defaultMessage: 'Import failed: {message}' },
          { message: err.message ?? String(err) }
        )
      );
    } finally {
      setLoading(false);
      setImportProgress(null);
      setProgressRows(null);
      setProgressTotal(null);
    }
  };

  const handleReset = () => {
    setCsvHeaders([]);
    setCsvRows([]);
    setFieldMapping({});
    setImportResult(null);
    setError(null);
    setFileFormat('csv');
    setDryRun(false);
    setRollbackOnFailure(false);
    setImportMode('create');
    setKeyField('');
    setImportProgress(null);
    setProgressRows(null);
    setProgressTotal(null);
    setBatchSize(DEFAULT_BATCH_SIZE);
    setFailedRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const getFieldLabel = (f: FieldInfo) => {
    let label: string;
    if (f.type === 'relation' && f.relationType) {
      label = `${f.name} (relation: ${f.relationType})`;
    } else if (f.type === 'media') {
      label = `${f.name} (media: ${f.multiple ? 'multiple IDs' : 'single ID'})`;
    } else {
      label = `${f.name} (${f.type})`;
    }
    if (f.required) label += ' *';
    return label;
  };

  const styles: Record<string, React.CSSProperties> = {
    container: { padding: '24px', maxWidth: '800px' },
    title: { fontSize: '24px', fontWeight: 700, marginBottom: '24px' },
    section: { marginBottom: '24px' },
    label: { display: 'block', fontWeight: 600, marginBottom: '8px' },
    select: { width: '100%', padding: '8px 12px', borderRadius: '4px', border: '1px solid #dcdce4', fontSize: '14px' },
    input: { padding: '8px 12px', borderRadius: '4px', border: '1px solid #dcdce4', fontSize: '14px' },
    table: { width: '100%', borderCollapse: 'collapse', marginTop: '16px' },
    th: { textAlign: 'left', padding: '8px 12px', background: '#f6f6f9', borderBottom: '2px solid #dcdce4', fontWeight: 600 },
    td: { padding: '8px 12px', borderBottom: '1px solid #eaeaef' },
    button: { padding: '10px 20px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' },
    primaryButton: { background: '#4945ff', color: '#fff' },
    secondaryButton: { background: '#eaeaef', color: '#32324d', marginLeft: '8px' },
    error: { color: '#d02b20', background: '#fcecea', padding: '12px', borderRadius: '4px', marginBottom: '16px' },
    success: { color: '#328048', background: '#eafbe7', padding: '12px', borderRadius: '4px' },
    warning: { color: '#b5460f', background: '#fdf4dc', padding: '8px 12px', borderRadius: '4px', marginTop: '8px', fontSize: '13px' },
    formatNote: { color: '#4945ff', background: '#f0f0ff', padding: '8px 12px', borderRadius: '4px', marginBottom: '12px', fontSize: '13px' },
    progressBar: { width: '100%', height: '8px', background: '#eaeaef', borderRadius: '4px', marginTop: '12px', overflow: 'hidden' },
    progressFill: { height: '100%', background: '#4945ff', borderRadius: '4px', transition: 'width 0.3s' },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>
        {formatMessage({ id: 'data-importer.page.title', defaultMessage: 'Data Importer' })}
      </h1>

      {error && <div style={styles.error}>{error}</div>}

      {/* Step 1: Content type selection */}
      <div style={styles.section}>
        <label style={styles.label}>
          {formatMessage({ id: 'data-importer.step1.label', defaultMessage: 'Step 1: Select content type' })}
        </label>
        <select
          style={styles.select}
          value={selectedUid}
          onChange={(e) => { setSelectedUid(e.target.value); handleReset(); }}
        >
          <option value="">
            {formatMessage({ id: 'data-importer.step1.placeholder', defaultMessage: '-- Select a content type --' })}
          </option>
          {contentTypes.map((ct) => (
            <option key={ct.uid} value={ct.uid}>{ct.displayName} ({ct.uid})</option>
          ))}
        </select>
        {selectedContentType && (
          <button
            style={{ ...styles.button, ...styles.secondaryButton, marginTop: '8px' }}
            onClick={handleDownloadTemplate}
          >
            {formatMessage({ id: 'data-importer.step1.downloadTemplate', defaultMessage: 'Download CSV template' })}
          </button>
        )}
      </div>

      {/* Step 2: File upload */}
      {selectedUid && (
        <div style={styles.section}>
          <label style={styles.label}>
            {formatMessage({ id: 'data-importer.step2.label', defaultMessage: 'Step 2: Upload file (CSV or JSON)' })}
          </label>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontWeight: 600, marginRight: '12px' }}>
              {formatMessage({ id: 'data-importer.step2.format', defaultMessage: 'File format:' })}
            </span>
            <label style={{ marginRight: '12px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="fileFormat"
                value="csv"
                checked={fileFormat === 'csv'}
                onChange={() => {
                  setFileFormat('csv');
                  setCsvHeaders([]);
                  setCsvRows([]);
                  setFieldMapping({});
                  setImportResult(null);
                  setError(null);
                  setFailedRows([]);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                style={{ marginRight: '4px' }}
              />
              {formatMessage({ id: 'data-importer.step2.formatCsv', defaultMessage: 'CSV' })}
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="fileFormat"
                value="json"
                checked={fileFormat === 'json'}
                onChange={() => {
                  setFileFormat('json');
                  setCsvHeaders([]);
                  setCsvRows([]);
                  setFieldMapping({});
                  setImportResult(null);
                  setError(null);
                  setFailedRows([]);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                style={{ marginRight: '4px' }}
              />
              {formatMessage({ id: 'data-importer.step2.formatJson', defaultMessage: 'JSON' })}
            </label>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={fileFormat === 'csv' ? '.csv,text/csv' : '.json,application/json'}
            onChange={handleFileChange}
            style={styles.input}
          />
          {csvRows.length > 0 && (
            <div style={styles.warning}>
              {formatMessage(
                { id: 'data-importer.step2.rowsDetected', defaultMessage: '{rows} rows detected, {cols} columns: {headers}' },
                { rows: csvRows.length, cols: csvHeaders.length, headers: csvHeaders.join(', ') }
              )}
            </div>
          )}
          {/* Preview: first 5 rows */}
          {csvRows.length > 0 && csvHeaders.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <strong style={{ fontSize: '13px' }}>
                {formatMessage({ id: 'data-importer.step2.preview', defaultMessage: 'Preview (first 5 rows):' })}
              </strong>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ ...styles.table, fontSize: '12px' }}>
                  <thead>
                    <tr>
                      {csvHeaders.map((h) => (
                        <th key={h} style={styles.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {csvHeaders.map((h) => (
                          <td key={h} style={styles.td}>{row[h] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Field mapping */}
      {csvHeaders.length > 0 && selectedContentType && (
        <div style={styles.section}>
          <label style={styles.label}>
            {formatMessage({ id: 'data-importer.step3.label', defaultMessage: 'Step 3: Map columns to Strapi fields' })}
          </label>
          {hasRelationOrMediaFields && (
            <div style={styles.formatNote}>
              {formatMessage({
                id: 'data-importer.step3.formatNote',
                defaultMessage: 'Relation fields: enter comma-separated documentIds. Media fields: enter comma-separated numeric file IDs.',
              })}
            </div>
          )}
          {selectedContentType.fields.some((f) => f.required) && (
            <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>
              {formatMessage({ id: 'data-importer.step3.requiredNote', defaultMessage: '* Required field' })}
            </p>
          )}
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>
                  {formatMessage({ id: 'data-importer.step3.csvColumn', defaultMessage: 'Column' })}
                </th>
                <th style={styles.th}>
                  {formatMessage({ id: 'data-importer.step3.strapiField', defaultMessage: 'Strapi Field' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {csvHeaders.map((header) => {
                const isAutoMapped = fieldMapping[header] !== '';
                return (
                  <tr key={header} style={isAutoMapped ? { background: '#f0fdf4' } : undefined}>
                    <td style={styles.td}>
                      {header}
                      {isAutoMapped && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: '#328048', fontWeight: 600 }}>
                          {formatMessage({ id: 'data-importer.step3.auto', defaultMessage: 'Auto' })}
                        </span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <select
                        style={{ ...styles.select, width: 'auto' }}
                        value={fieldMapping[header] ?? ''}
                        onChange={(e) => handleMappingChange(header, e.target.value)}
                      >
                        <option value="">
                          {formatMessage({ id: 'data-importer.step3.skip', defaultMessage: '-- Skip --' })}
                        </option>
                        {selectedContentType.fields.map((f) => (
                          <option key={f.name} value={f.name}>{getFieldLabel(f)}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Step 4: Run import */}
      {csvRows.length > 0 && selectedUid && (
        <div style={styles.section}>
          <label style={styles.label}>
            {formatMessage({ id: 'data-importer.step4.label', defaultMessage: 'Step 4: Run import' })}
          </label>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              {formatMessage({ id: 'data-importer.step4.dryRun', defaultMessage: 'Dry run (no data will be written)' })}
            </label>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={rollbackOnFailure}
                onChange={(e) => setRollbackOnFailure(e.target.checked)}
              />
              {formatMessage({ id: 'data-importer.step4.rollbackOnFailure', defaultMessage: 'Rollback on failure (undo creates if any row fails)' })}
            </label>
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={styles.label}>
              {formatMessage({ id: 'data-importer.step4.batchSize', defaultMessage: 'Batch size:' })}
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              value={batchSize}
              onChange={(e) => setBatchSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
              style={{ ...styles.input, width: '80px' }}
            />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <span style={{ fontWeight: 600, marginRight: '12px' }}>
              {formatMessage({ id: 'data-importer.step4.importMode', defaultMessage: 'Import mode:' })}
            </span>
            <label style={{ marginRight: '12px', cursor: 'pointer' }}>
              <input
                type="radio"
                name="importMode"
                value="create"
                checked={importMode === 'create'}
                onChange={() => setImportMode('create')}
                style={{ marginRight: '4px' }}
              />
              {formatMessage({ id: 'data-importer.step4.modeCreate', defaultMessage: 'Create only' })}
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="importMode"
                value="upsert"
                checked={importMode === 'upsert'}
                onChange={() => setImportMode('upsert')}
                style={{ marginRight: '4px' }}
              />
              {formatMessage({ id: 'data-importer.step4.modeUpsert', defaultMessage: 'Upsert (create or update)' })}
            </label>
          </div>
          {importMode === 'upsert' && (
            <div style={{ marginBottom: '12px' }}>
              <label style={styles.label}>
                {formatMessage({ id: 'data-importer.step4.keyField', defaultMessage: 'Key field:' })}
              </label>
              <select
                style={{ ...styles.select, width: 'auto' }}
                value={keyField}
                onChange={(e) => setKeyField(e.target.value)}
              >
                <option value="">
                  {formatMessage({ id: 'data-importer.step4.keyFieldPlaceholder', defaultMessage: '-- Select key field --' })}
                </option>
                {selectedContentType?.fields.map((f) => (
                  <option key={f.name} value={f.name}>{getFieldLabel(f)}</option>
                ))}
              </select>
            </div>
          )}
          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            onClick={() => handleImport()}
            disabled={loading}
          >
            {loading
              ? formatMessage({ id: 'data-importer.step4.importing', defaultMessage: 'Importing...' })
              : formatMessage(
                  { id: 'data-importer.step4.importButton', defaultMessage: 'Import {count} records' },
                  { count: csvRows.length }
                )
            }
          </button>
          <button
            style={{ ...styles.button, ...styles.secondaryButton }}
            onClick={handleReset}
            disabled={loading}
          >
            {formatMessage({ id: 'data-importer.step4.reset', defaultMessage: 'Reset' })}
          </button>
          {loading && importProgress !== null && (
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${importProgress}%` }} />
            </div>
          )}
          {loading && progressRows !== null && progressTotal !== null && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
              {formatMessage(
                { id: 'data-importer.step4.progressRows', defaultMessage: '{processed} / {total} rows' },
                { processed: progressRows, total: progressTotal }
              )}
            </div>
          )}
        </div>
      )}

      {/* Step 5: Results */}
      {importResult && (
        <div style={styles.section}>
          <label style={styles.label}>
            {formatMessage({ id: 'data-importer.step5.label', defaultMessage: 'Step 5: Results' })}
            {dryRun && (
              <span style={{ marginLeft: '8px', color: '#b5460f', fontWeight: 400 }}>
                {formatMessage({ id: 'data-importer.step5.dryRunLabel', defaultMessage: '(dry run)' })}
              </span>
            )}
          </label>
          <div style={styles.success}>
            {formatMessage(
              { id: 'data-importer.step5.result', defaultMessage: 'Created: {success} | Updated: {updated} | Failed: {failed}' },
              { success: importResult.success, updated: importResult.updated, failed: importResult.failed }
            )}
          </div>
          {importResult.errors.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              {failedRows.length > 0 && (
                <>
                  <strong>
                    {formatMessage({ id: 'data-importer.step5.failedRowsTable', defaultMessage: 'Failed row details:' })}
                  </strong>
                  <div style={{ overflowX: 'auto', marginTop: '8px' }}>
                    <table style={{ ...styles.table, fontSize: '12px' }}>
                      <thead>
                        <tr>
                          <th style={styles.th}>
                            {formatMessage({ id: 'data-importer.step5.errorDetails', defaultMessage: 'Error details:' })}
                          </th>
                          {csvHeaders.map((h) => (
                            <th key={h} style={styles.th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.errors.slice(0, failedRows.length).map((err, i) => (
                          <tr key={i}>
                            <td style={{ ...styles.td, color: '#d02b20' }}>{err}</td>
                            {csvHeaders.map((h) => (
                              <td key={h} style={styles.td}>{failedRows[i]?.[h] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {importResult.errors.length > failedRows.length && (
                <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                  {importResult.errors.slice(failedRows.length).map((e, i) => (
                    <li key={i} style={{ color: '#d02b20', fontSize: '13px' }}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {failedRows.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <button
                style={{ ...styles.button, background: '#d02b20', color: '#fff' }}
                onClick={() => handleImport(failedRows, 0)}
                disabled={loading}
              >
                {formatMessage(
                  { id: 'data-importer.step5.retryFailed', defaultMessage: 'Retry failed ({count} rows)' },
                  { count: failedRows.length }
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Import history */}
      <div style={styles.section}>
        <label style={styles.label}>
          {formatMessage({ id: 'data-importer.history.label', defaultMessage: 'Import history' })}
        </label>
        {history.length === 0 ? (
          <p>{formatMessage({ id: 'data-importer.history.empty', defaultMessage: 'No import history yet.' })}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...styles.table, fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={styles.th}>{formatMessage({ id: 'data-importer.history.timestamp', defaultMessage: 'Date/Time' })}</th>
                  <th style={styles.th}>{formatMessage({ id: 'data-importer.history.contentType', defaultMessage: 'Content Type' })}</th>
                  <th style={styles.th}>{formatMessage({ id: 'data-importer.history.mode', defaultMessage: 'Mode' })}</th>
                  <th style={styles.th}>{formatMessage({ id: 'data-importer.history.created', defaultMessage: 'Created' })}</th>
                  <th style={styles.th}>{formatMessage({ id: 'data-importer.history.updated', defaultMessage: 'Updated' })}</th>
                  <th style={styles.th}>{formatMessage({ id: 'data-importer.history.failed', defaultMessage: 'Failed' })}</th>
                  <th style={styles.th}>{formatMessage({ id: 'data-importer.history.dryRun', defaultMessage: 'Dry Run' })}</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map((entry) => (
                  <tr key={entry.id}>
                    <td style={styles.td}>{new Date(entry.timestamp).toLocaleString()}</td>
                    <td style={styles.td}>{entry.displayName}</td>
                    <td style={styles.td}>
                      {entry.mode === 'upsert'
                        ? formatMessage({ id: 'data-importer.history.modeUpsert', defaultMessage: 'Upsert' })
                        : formatMessage({ id: 'data-importer.history.modeCreate', defaultMessage: 'Create' })}
                    </td>
                    <td style={styles.td}>{entry.success}</td>
                    <td style={styles.td}>{entry.updated}</td>
                    <td style={styles.td}>{entry.failed}</td>
                    <td style={styles.td}>{entry.dryRun ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default HomePage;
