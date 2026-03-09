import React from 'react';
import { useIntl } from 'react-intl';
import type { ContentTypeInfo, FieldMapping } from '../types';
import { getFieldLabel } from '../utils/fieldLabel';
import { styles } from '../styles';

interface Props {
  csvHeaders: string[];
  selectedContentType: ContentTypeInfo;
  fieldMapping: FieldMapping;
  onMappingChange: (csvColumn: string, strapiField: string) => void;
  hasRelationOrMediaFields: boolean;
  selectedFieldCounts: Map<string, number>;
}

const StepFieldMapping = ({
  csvHeaders,
  selectedContentType,
  fieldMapping,
  onMappingChange,
  hasRelationOrMediaFields,
  selectedFieldCounts,
}: Props) => {
  const { formatMessage } = useIntl();

  return (
    <div style={styles.section}>
      <label style={styles.label}>
        {formatMessage({ id: 'data-importer.step3.label', defaultMessage: 'Step 3: Map columns to Strapi fields' })}
      </label>
      {hasRelationOrMediaFields && (
        <div style={styles.formatNote}>
          {formatMessage({
            id: 'data-importer.step3.formatNote',
            defaultMessage:
              'Relation fields: enter comma-separated documentIds. Media fields: enter comma-separated numeric file IDs.',
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
            const currentMappedField = fieldMapping[header] ?? '';
            const isAutoMapped = currentMappedField !== '';
            return (
              <tr key={header}>
                <td style={styles.td}>
                  {header}
                  {isAutoMapped && (
                    <span style={{ marginLeft: '6px', fontSize: '11px', background: '#328048', color: '#fff', fontWeight: 600, padding: '1px 5px', borderRadius: '3px' }}>
                      {formatMessage({ id: 'data-importer.step3.auto', defaultMessage: 'Auto' })}
                    </span>
                  )}
                </td>
                <td style={styles.td}>
                  <select
                    style={{ ...styles.select, width: 'auto' }}
                    value={fieldMapping[header] ?? ''}
                    onChange={(e) => onMappingChange(header, e.target.value)}
                  >
                    <option value="">
                      {formatMessage({ id: 'data-importer.step3.skip', defaultMessage: '-- Skip --' })}
                    </option>
                    {selectedContentType.fields.map((f) => {
                      const alreadyMappedByOtherColumn =
                        (selectedFieldCounts.get(f.name) ?? 0) > 0 && currentMappedField !== f.name;
                      return (
                        <option key={f.name} value={f.name} disabled={alreadyMappedByOtherColumn}>
                          {getFieldLabel(f)}
                        </option>
                      );
                    })}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default StepFieldMapping;
