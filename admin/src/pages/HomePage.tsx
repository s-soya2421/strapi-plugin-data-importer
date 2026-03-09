import React from 'react';
import { useIntl } from 'react-intl';
import { useImport } from '../hooks/useImport';
import { styles } from '../styles';
import StepContentType from '../components/StepContentType';
import StepFileUpload from '../components/StepFileUpload';
import StepFieldMapping from '../components/StepFieldMapping';
import StepRunImport from '../components/StepRunImport';
import StepResults from '../components/StepResults';
import ImportHistory from '../components/ImportHistory';

const HomePage = () => {
  const { formatMessage } = useIntl();
  const {
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
    dryRun, setDryRun,
    rollbackOnFailure, setRollbackOnFailure,
    importMode, setImportMode,
    keyField, setKeyField,
    importProgress,
    progressRows,
    progressTotal,
    batchSize, setBatchSize,
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
  } = useImport();

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>
        {formatMessage({ id: 'data-importer.page.title', defaultMessage: 'Data Importer' })}
      </h1>

      {error && <div style={styles.error}>{error}</div>}

      <StepContentType
        contentTypes={contentTypes}
        selectedUid={selectedUid}
        selectedContentType={selectedContentType}
        onUidChange={handleUidChange}
        onDownloadTemplate={handleDownloadTemplate}
      />

      {selectedUid && (
        <StepFileUpload
          fileFormat={fileFormat}
          onFormatChange={(fmt) => { setFileFormat(fmt); clearFileState(); }}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
          csvRows={csvRows}
          csvHeaders={csvHeaders}
        />
      )}

      {csvHeaders.length > 0 && selectedContentType && (
        <StepFieldMapping
          csvHeaders={csvHeaders}
          selectedContentType={selectedContentType}
          fieldMapping={fieldMapping}
          onMappingChange={handleMappingChange}
          hasRelationOrMediaFields={hasRelationOrMediaFields}
          selectedFieldCounts={selectedFieldCounts}
        />
      )}

      {csvRows.length > 0 && selectedUid && (
        <StepRunImport
          csvRows={csvRows}
          dryRun={dryRun} setDryRun={setDryRun}
          rollbackOnFailure={rollbackOnFailure} setRollbackOnFailure={setRollbackOnFailure}
          batchSize={batchSize} setBatchSize={setBatchSize}
          importMode={importMode} setImportMode={setImportMode}
          keyField={keyField} setKeyField={setKeyField}
          upsertKeyFields={upsertKeyFields}
          loading={loading}
          importProgress={importProgress}
          progressRows={progressRows}
          progressTotal={progressTotal}
          onImport={() => handleImport()}
          onReset={handleReset}
        />
      )}

      {importResult && (
        <StepResults
          importResult={importResult}
          dryRun={dryRun}
          failedRows={failedRows}
          csvHeaders={csvHeaders}
          loading={loading}
          onRetry={(rows) => handleImport(rows, 0)}
        />
      )}

      <ImportHistory history={history} />
    </div>
  );
};

export default HomePage;
