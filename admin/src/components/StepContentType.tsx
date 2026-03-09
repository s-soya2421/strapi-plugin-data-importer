import React from 'react';
import { useIntl } from 'react-intl';
import type { ContentTypeInfo } from '../types';
import { styles } from '../styles';

interface Props {
  contentTypes: ContentTypeInfo[];
  selectedUid: string;
  selectedContentType: ContentTypeInfo | undefined;
  onUidChange: (uid: string) => void;
  onDownloadTemplate: () => void;
}

const StepContentType = ({ contentTypes, selectedUid, selectedContentType, onUidChange, onDownloadTemplate }: Props) => {
  const { formatMessage } = useIntl();

  return (
    <div style={styles.section}>
      <label style={styles.label}>
        {formatMessage({ id: 'data-importer.step1.label', defaultMessage: 'Step 1: Select content type' })}
      </label>
      <select
        style={styles.select}
        value={selectedUid}
        onChange={(e) => onUidChange(e.target.value)}
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
          onClick={onDownloadTemplate}
        >
          {formatMessage({ id: 'data-importer.step1.downloadTemplate', defaultMessage: 'Download CSV template' })}
        </button>
      )}
    </div>
  );
};

export default StepContentType;
