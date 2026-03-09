import React from 'react';
import { useIntl } from 'react-intl';
import type { FieldInfo } from '../types';
import { getFieldLabel } from '../utils/fieldLabel';
import { styles } from '../styles';

interface Props {
  csvRows: Record<string, string>[];
  dryRun: boolean;
  setDryRun: (v: boolean) => void;
  rollbackOnFailure: boolean;
  setRollbackOnFailure: (v: boolean) => void;
  batchSize: number;
  setBatchSize: (v: number) => void;
  importMode: 'create' | 'upsert';
  setImportMode: (v: 'create' | 'upsert') => void;
  keyField: string;
  setKeyField: (v: string) => void;
  upsertKeyFields: FieldInfo[];
  loading: boolean;
  importProgress: number | null;
  progressRows: number | null;
  progressTotal: number | null;
  onImport: () => void;
  onReset: () => void;
}

const StepRunImport = ({
  csvRows,
  dryRun, setDryRun,
  rollbackOnFailure, setRollbackOnFailure,
  batchSize, setBatchSize,
  importMode, setImportMode,
  keyField, setKeyField,
  upsertKeyFields,
  loading,
  importProgress,
  progressRows,
  progressTotal,
  onImport,
  onReset,
}: Props) => {
  const { formatMessage } = useIntl();

  return (
    <div style={styles.section}>
      <label style={styles.label}>
        {formatMessage({ id: 'data-importer.step4.label', defaultMessage: 'Step 4: Run import' })}
      </label>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
          {formatMessage({ id: 'data-importer.step4.dryRun', defaultMessage: 'Dry run (no data will be written)' })}
        </label>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={rollbackOnFailure} onChange={(e) => setRollbackOnFailure(e.target.checked)} />
          {formatMessage({ id: 'data-importer.step4.rollbackOnFailure', defaultMessage: 'Rollback on failure (undo creates if any row fails)' })}
        </label>
        {rollbackOnFailure && (
          <p style={{ fontSize: '12px', color: '#666', marginTop: '4px', marginLeft: '24px' }}>
            {importMode === 'upsert'
              ? formatMessage({
                  id: 'data-importer.step4.rollbackNoteUpsert',
                  defaultMessage: 'Note: only newly created records will be deleted on rollback. Updates performed during upsert cannot be undone.',
                })
              : formatMessage({
                  id: 'data-importer.step4.rollbackNote',
                  defaultMessage: 'Note: only records created during this run will be deleted on rollback.',
                })}
          </p>
        )}
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
            {upsertKeyFields.map((f) => (
              <option key={f.name} value={f.name}>{getFieldLabel(f)}</option>
            ))}
          </select>
          {upsertKeyFields.length === 0 && (
            <p style={{ fontSize: '12px', color: '#d02b20', marginTop: '8px' }}>
              {formatMessage({
                id: 'data-importer.step4.upsertNoUniqueFieldHint',
                defaultMessage: 'No unique fields are available for upsert key selection.',
              })}
            </p>
          )}
        </div>
      )}

      <button
        style={{ ...styles.button, ...styles.primaryButton }}
        onClick={onImport}
        disabled={loading}
      >
        {loading
          ? formatMessage({ id: 'data-importer.step4.importing', defaultMessage: 'Importing...' })
          : formatMessage(
              { id: 'data-importer.step4.importButton', defaultMessage: 'Import {count} records' },
              { count: csvRows.length }
            )}
      </button>
      <button style={{ ...styles.button, ...styles.secondaryButton }} onClick={onReset} disabled={loading}>
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
  );
};

export default StepRunImport;
