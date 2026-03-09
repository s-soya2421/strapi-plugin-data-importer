import React from 'react';
import { useIntl } from 'react-intl';
import type { ImportResult } from '../types';
import { styles } from '../styles';

interface Props {
  importResult: ImportResult;
  dryRun: boolean;
  failedRows: Record<string, string>[];
  csvHeaders: string[];
  loading: boolean;
  onRetry: (rows: Record<string, string>[]) => void;
}

const StepResults = ({ importResult, dryRun, failedRows, csvHeaders, loading, onRetry }: Props) => {
  const { formatMessage } = useIntl();

  return (
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
                      {csvHeaders.map((h) => <th key={h} style={styles.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.errors.slice(0, failedRows.length).map((err, i) => (
                      <tr key={i}>
                        <td style={{ ...styles.td, color: '#d02b20' }}>{err}</td>
                        {csvHeaders.map((h) => <td key={h} style={styles.td}>{failedRows[i]?.[h] ?? ''}</td>)}
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
            onClick={() => onRetry(failedRows)}
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
  );
};

export default StepResults;
