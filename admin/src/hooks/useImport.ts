import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useIntl } from 'react-intl';
import { useFetchClient } from '@strapi/admin/strapi-admin';
import { parseCSV } from '../utils/parseCSV';
import { parseJSON } from '../utils/parseJSON';
import type {
  AllMappings,
  ContentTypeInfo,
  DataResponse,
  FieldMapping,
  HistoryEntry,
  ImportResult,
} from '../types';

const DEFAULT_BATCH_SIZE = 100;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const findDuplicateMappedFields = (mapping: FieldMapping): string[] => {
  const counts = new Map<string, number>();
  for (const mappedField of Object.values(mapping)) {
    if (!mappedField) continue;
    counts.set(mappedField, (counts.get(mappedField) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([field]) => field);
};

export const useImport = () => {
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
      .then((res: DataResponse<ContentTypeInfo[]>) => setContentTypes(res.data?.data ?? []))
      .catch((err: unknown) =>
        setError(
          formatMessage(
            { id: 'data-importer.error.fetchContentTypes', defaultMessage: 'Failed to fetch content types: {message}' },
            { message: getErrorMessage(err) }
          )
        )
      );
    get('/data-importer/mappings')
      .then((res: DataResponse<AllMappings>) => setAllMappings(res.data?.data ?? {}))
      .catch(() => {});
    get('/data-importer/history')
      .then((res: DataResponse<HistoryEntry[]>) => {
        const data = res.data?.data;
        setHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  }, []);

  const selectedContentType = contentTypes.find((ct) => ct.uid === selectedUid);
  const upsertKeyFields = selectedContentType?.fields.filter((f) => f.unique === true) ?? [];
  const hasRelationOrMediaFields =
    selectedContentType?.fields.some((f) => f.type === 'relation' || f.type === 'media') ?? false;

  const selectedFieldCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mappedField of Object.values(fieldMapping)) {
      if (!mappedField) continue;
      counts.set(mappedField, (counts.get(mappedField) ?? 0) + 1);
    }
    return counts;
  }, [fieldMapping]);

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

  const clearFileState = () => {
    setCsvHeaders([]);
    setCsvRows([]);
    setFieldMapping({});
    setImportResult(null);
    setError(null);
    setFailedRows([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleUidChange = (uid: string) => {
    setSelectedUid(uid);
    handleReset();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = fileFormat === 'json' ? parseJSON(text) : parseCSV(text);
      const jsonError =
        'error' in parsed && typeof parsed.error === 'string' && parsed.error.trim() !== ''
          ? parsed.error
          : null;
      if (jsonError) {
        setError(
          formatMessage(
            { id: 'data-importer.step2.invalidJson', defaultMessage: 'Invalid JSON file: {message}' },
            { message: jsonError }
          )
        );
        setCsvHeaders([]);
        setCsvRows([]);
        setFieldMapping({});
        setImportResult(null);
        setFailedRows([]);
        return;
      }
      const { headers, rows } = parsed;
      setError(null);
      setCsvHeaders(headers);
      setCsvRows(rows);
      const mapping = allMappings[selectedUid] ?? {};
      const autoMapping: FieldMapping = {};
      headers.forEach((h) => {
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

  const handleDownloadTemplate = () => {
    if (!selectedContentType) return;
    const mapping = allMappings[selectedUid];
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

  const refreshHistory = () => {
    get('/data-importer/history')
      .then((res: DataResponse<HistoryEntry[]>) => {
        const data = res.data?.data;
        setHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
  };

  const handleImport = async (rowsToImport = csvRows, offset = 0) => {
    if (!selectedUid || rowsToImport.length === 0) return;

    const duplicateMappedFields = findDuplicateMappedFields(fieldMapping);
    if (duplicateMappedFields.length > 0) {
      setError(
        formatMessage(
          {
            id: 'data-importer.step3.duplicateMapping',
            defaultMessage:
              'The following Strapi fields are mapped more than once: {fields}. Each field can only be mapped once.',
          },
          { fields: duplicateMappedFields.join(', ') }
        )
      );
      return;
    }

    if (importMode === 'upsert') {
      if (upsertKeyFields.length === 0) {
        setError(
          formatMessage({
            id: 'data-importer.step4.upsertNoUniqueField',
            defaultMessage: 'Upsert mode requires at least one unique field on the selected content type.',
          })
        );
        return;
      }
      if (!keyField) {
        setError(
          formatMessage({
            id: 'data-importer.step4.upsertKeyRequired',
            defaultMessage: 'Upsert mode requires selecting a key field.',
          })
        );
        return;
      }
      const mappedFields = new Set(Object.values(fieldMapping).filter(Boolean));
      if (!mappedFields.has(keyField)) {
        setError(
          formatMessage(
            {
              id: 'data-importer.step4.upsertKeyNotMapped',
              defaultMessage: "Selected key field '{field}' is not mapped to any input column.",
            },
            { field: keyField }
          )
        );
        return;
      }
      if (!upsertKeyFields.some((field) => field.name === keyField)) {
        setError(
          formatMessage(
            {
              id: 'data-importer.step4.upsertKeyMustBeUnique',
              defaultMessage: "Selected key field '{field}' must be unique.",
            },
            { field: keyField }
          )
        );
        return;
      }
    }

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

    let accumulated: ImportResult = { success: 0, updated: 0, failed: 0, errors: [], failedRows: [] };
    const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      for (let c = 0; c < chunks.length; c++) {
        const res: DataResponse<ImportResult> = await post('/data-importer/import', {
          uid: selectedUid,
          rows: chunks[c],
          fieldMapping,
          dryRun,
          batchOffset: offset + c * effectiveBatchSize,
          importMode,
          keyField: importMode === 'upsert' ? keyField : undefined,
          rollbackOnFailure,
          runId,
          isFinalChunk: c === chunks.length - 1,
          totalRows: rowsToImport.length,
        });
        const chunkResult = res.data?.data;
        if (chunkResult) {
          accumulated = {
            success: chunkResult.success ?? 0,
            updated: chunkResult.updated ?? 0,
            failed: chunkResult.failed ?? 0,
            errors: chunkResult.errors ?? [],
            failedRows: chunkResult.failedRows ?? [],
            rollbackApplied: chunkResult.rollbackApplied === true,
            completed: chunkResult.completed === true,
          };
        }
        setImportProgress(Math.round(((c + 1) / chunks.length) * 100));
        setProgressRows(Math.min((c + 1) * effectiveBatchSize, rowsToImport.length));
        if (accumulated.rollbackApplied) break;
      }
      setImportResult(accumulated);
      setFailedRows(accumulated.failedRows);
      refreshHistory();
    } catch (err: unknown) {
      setError(
        formatMessage(
          { id: 'data-importer.error.importFailed', defaultMessage: 'Import failed: {message}' },
          { message: getErrorMessage(err) }
        )
      );
    } finally {
      setLoading(false);
      setImportProgress(null);
      setProgressRows(null);
      setProgressTotal(null);
    }
  };

  return {
    contentTypes,
    selectedUid,
    csvHeaders,
    csvRows,
    fieldMapping,
    fileFormat,
    setFileFormat,
    importResult,
    loading,
    error,
    dryRun,
    setDryRun,
    rollbackOnFailure,
    setRollbackOnFailure,
    importMode,
    setImportMode,
    keyField,
    setKeyField,
    importProgress,
    progressRows,
    progressTotal,
    batchSize,
    setBatchSize,
    failedRows,
    history,
    fileInputRef,
    selectedContentType,
    upsertKeyFields,
    hasRelationOrMediaFields,
    selectedFieldCounts,
    handleUidChange,
    handleDownloadTemplate,
    handleReset,
    clearFileState,
    handleFileChange,
    handleMappingChange,
    handleImport,
  };
};
