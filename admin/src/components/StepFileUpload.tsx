import React, { type ChangeEvent, type RefObject } from 'react';
import { useIntl } from 'react-intl';
import { styles } from '../styles';

interface Props {
  fileFormat: 'csv' | 'json';
  onFormatChange: (format: 'csv' | 'json') => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  csvRows: Record<string, string>[];
  csvHeaders: string[];
}

const StepFileUpload = ({ fileFormat, onFormatChange, fileInputRef, onFileChange, csvRows, csvHeaders }: Props) => {
  const { formatMessage } = useIntl();

  return (
    <div style={styles.section}>
      <label style={styles.label}>
        {formatMessage({ id: 'data-importer.step2.label', defaultMessage: 'Step 2: Upload file (CSV or JSON)' })}
      </label>
      <div style={{ marginBottom: '8px' }}>
        <span style={{ fontWeight: 600, marginRight: '12px' }}>
          {formatMessage({ id: 'data-importer.step2.format', defaultMessage: 'File format:' })}
        </span>
        {(['csv', 'json'] as const).map((fmt) => (
          <label key={fmt} style={{ marginRight: '12px', cursor: 'pointer' }}>
            <input
              type="radio"
              name="fileFormat"
              value={fmt}
              checked={fileFormat === fmt}
              onChange={() => onFormatChange(fmt)}
              style={{ marginRight: '4px' }}
            />
            {formatMessage({ id: `data-importer.step2.format${fmt.toUpperCase()}`, defaultMessage: fmt.toUpperCase() })}
          </label>
        ))}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={fileFormat === 'csv' ? '.csv,text/csv' : '.json,application/json'}
        onChange={onFileChange}
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
      {csvRows.length > 10000 && (
        <div style={{ ...styles.warning, background: '#fcecea', color: '#d02b20', marginTop: '4px' }}>
          {formatMessage(
            {
              id: 'data-importer.step2.largeFileWarning',
              defaultMessage:
                'Large file detected ({rows} rows). All rows are loaded into browser memory. Consider splitting the file into smaller chunks if you experience performance issues.',
            },
            { rows: csvRows.length }
          )}
        </div>
      )}
      {csvRows.length > 0 && csvHeaders.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <strong style={{ fontSize: '13px' }}>
            {formatMessage({ id: 'data-importer.step2.preview', defaultMessage: 'Preview (first 5 rows):' })}
          </strong>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...styles.table, fontSize: '12px' }}>
              <thead>
                <tr>{csvHeaders.map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {csvRows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {csvHeaders.map((h) => <td key={h} style={styles.td}>{row[h] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default StepFileUpload;
