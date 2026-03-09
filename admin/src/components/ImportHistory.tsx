import React from 'react';
import { useIntl } from 'react-intl';
import type { HistoryEntry } from '../types';
import { styles } from '../styles';

interface Props {
  history: HistoryEntry[];
}

const ImportHistory = ({ history }: Props) => {
  const { formatMessage } = useIntl();

  return (
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
  );
};

export default ImportHistory;
