import fs from 'fs';
import path from 'path';

const DATE_TYPES = ['date', 'datetime', 'time'];
const FLOAT_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const SYSTEM_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);
const NON_IMPORTABLE_FIELD_TYPES = new Set(['component', 'dynamiczone']);
const IMPORT_RUN_TTL_MS = 30 * 60 * 1000;

interface FsPromisesLike {
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  writeFile?: (filePath: string, data: string, encoding: BufferEncoding) => Promise<void>;
}

export interface ImportResult {
  success: number;
  updated: number;
  failed: number;
  errors: string[];
  failedRows: Record<string, string>[];
  rollbackApplied?: boolean;
  completed?: boolean;
}

interface ImportRunState {
  uid: string;
  displayName: string;
  dryRun: boolean;
  mode: 'create' | 'upsert';
  totalRows: number;
  createdDocumentIds: string[];
  createdRows: Record<string, string>[];
  result: ImportResult;
  lastTouchedAt: number;
}

function createEmptyImportResult(): ImportResult {
  return { success: 0, updated: 0, failed: 0, errors: [], failedRows: [] };
}

function getFsPromisesApi(): FsPromisesLike | undefined {
  return (fs as unknown as { promises?: FsPromisesLike }).promises;
}

async function readTextFile(filePath: string): Promise<string> {
  const promisesApi = getFsPromisesApi();
  if (typeof promisesApi?.readFile === 'function') {
    return promisesApi.readFile(filePath, 'utf-8');
  }
  return fs.readFileSync(filePath, 'utf-8');
}

async function writeTextFile(filePath: string, data: string): Promise<void> {
  const promisesApi = getFsPromisesApi();
  if (typeof promisesApi?.writeFile === 'function') {
    await promisesApi.writeFile(filePath, data, 'utf-8');
    return;
  }
  fs.writeFileSync(filePath, data, 'utf-8');
}

function validateValue(value: string, attr: any, fieldName: string, rowNum: number): string | null {
  const type = attr.type;
  if (type === 'integer' || type === 'biginteger') {
    if (!/^-?\d+$/.test(value.trim())) {
      return `Row ${rowNum}: field '${fieldName}' expects integer, got '${value}'`;
    }
  } else if (type === 'float' || type === 'decimal') {
    if (!FLOAT_PATTERN.test(value.trim())) {
      return `Row ${rowNum}: field '${fieldName}' expects number, got '${value}'`;
    }
  } else if (type === 'boolean') {
    if (!['true', 'false', '1', '0'].includes(value.toLowerCase())) {
      return `Row ${rowNum}: field '${fieldName}' expects boolean (true/false/1/0), got '${value}'`;
    }
  } else if (type === 'email') {
    if (!/@.+\..+/.test(value)) {
      return `Row ${rowNum}: field '${fieldName}' expects email, got '${value}'`;
    }
  } else if (type === 'enumeration') {
    if (!attr.enum?.includes(value)) {
      return `Row ${rowNum}: field '${fieldName}' expects one of [${attr.enum?.join(', ') ?? ''}], got '${value}'`;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isImportableAttribute(attr: any): boolean {
  if (!attr || typeof attr !== 'object') return false;
  return !NON_IMPORTABLE_FIELD_TYPES.has(attr.type);
}

function findDuplicateMappedFields(fieldMapping: Record<string, string>): string[] {
  const counts = new Map<string, number>();
  for (const mappedField of Object.values(fieldMapping)) {
    if (!mappedField) continue;
    counts.set(mappedField, (counts.get(mappedField) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([field]) => field);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorDetails(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) return [];
  const details = (error as { details?: unknown }).details;
  if (!isPlainObject(details) || !Array.isArray(details.errors)) return [];

  const messages: string[] = [];
  for (const detail of details.errors) {
    if (!isPlainObject(detail)) continue;
    const pathValue = detail.path;
    const messageValue = detail.message;
    const pathText = Array.isArray(pathValue) ? pathValue.join('.') : 'unknown';
    const messageText =
      typeof messageValue === 'string' && messageValue.trim() !== ''
        ? messageValue
        : 'Validation failed';
    messages.push(`${pathText}: ${messageText}`);
  }
  return messages;
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object' && value !== null) {
    const connect = (value as { connect?: unknown[] }).connect;
    if (Array.isArray(connect)) return connect.length === 0;
  }
  return false;
}

export interface HistoryEntry {
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

export default ({ strapi }: { strapi: any }) => {
  const historyPath = path.join(process.cwd(), 'config', 'data-importer-history.json');
  const importRuns = new Map<string, ImportRunState>();
  let historyWriteQueue: Promise<void> = Promise.resolve();

  const queueHistoryWrite = async (writeOperation: () => Promise<void>) => {
    const pending = historyWriteQueue.then(writeOperation, writeOperation);
    historyWriteQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  };

  const cleanupStaleRuns = () => {
    const now = Date.now();
    for (const [id, state] of importRuns.entries()) {
      if (now - state.lastTouchedAt > IMPORT_RUN_TTL_MS) {
        importRuns.delete(id);
      }
    }
  };

  const _readHistory = async (): Promise<HistoryEntry[]> => {
    try {
      const data = await readTextFile(historyPath);
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const _writeHistoryEntry = async (
    uid: string,
    displayName: string,
    dryRun: boolean,
    mode: 'create' | 'upsert',
    result: ImportResult,
    totalRows: number
  ) => {
    return queueHistoryWrite(async () => {
      const history = await _readHistory();
      history.unshift({
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        uid,
        displayName,
        dryRun,
        mode,
        success: result.success,
        updated: result.updated,
        failed: result.failed,
        totalRows,
      });
      await writeTextFile(historyPath, JSON.stringify(history.slice(0, 50), null, 2));
    });
  };

  const _rollbackCreatedDocuments = async (
    uid: string,
    createdDocumentIds: string[],
    result: ImportResult,
    createdRows: Record<string, string>[]
  ) => {
    const rollbackDeleteErrors: string[] = [];
    for (const documentId of createdDocumentIds) {
      try {
        await strapi.documents(uid).delete({ documentId });
      } catch (err: unknown) {
        rollbackDeleteErrors.push(
          `Failed to rollback documentId '${documentId}': ${getErrorMessage(err)}`
        );
      }
    }

    result.failed += createdRows.length;
    const rollbackRowMessage = 'Rolled back: this row was created earlier in the same import run.';
    result.errors.push(...createdRows.map(() => rollbackRowMessage));
    result.failedRows.push(...createdRows);
    result.success = 0;
    result.rollbackApplied = true;
    result.errors.push(`Rolled back ${createdDocumentIds.length} record(s) due to errors.`);
    if (rollbackDeleteErrors.length > 0) {
      result.errors.push(...rollbackDeleteErrors);
    }
  };

  return {
    async getMappings(): Promise<Record<string, Record<string, string>>> {
      const mappingPath = path.join(process.cwd(), 'config', 'data-importer-mappings.json');
      try {
        const raw = await readTextFile(mappingPath);
        const parsed = JSON.parse(raw);
        return isPlainObject(parsed) ? (parsed as Record<string, Record<string, string>>) : {};
      } catch {
        return {};
      }
    },

    async getContentTypes() {
      const contentTypes = strapi.contentTypes;
      const result: Array<{ uid: string; displayName: string; fields: Array<{ name: string; type: string; relationType?: string; multiple?: boolean; required?: boolean; unique?: boolean }> }> = [];

      for (const [uid, contentType] of Object.entries(contentTypes) as [string, any][]) {
        if (!uid.startsWith('api::')) continue;

        const fields = Object.entries(contentType.attributes as Record<string, any>)
          .filter(([name, attr]) => {
            if (SYSTEM_FIELDS.has(name)) return false;
            return isImportableAttribute(attr);
          })
          .map(([name, attr]) => {
            const field: { name: string; type: string; relationType?: string; multiple?: boolean; required?: boolean; unique?: boolean } = { name, type: attr.type };
            if (attr.type === 'relation') {
              field.relationType = attr.relationType;
            }
            if (attr.type === 'media') {
              field.multiple = attr.multiple ?? false;
            }
            if (attr.required === true) {
              field.required = true;
            }
            if (attr.unique === true) {
              field.unique = true;
            }
            return field;
          });

        result.push({
          uid,
          displayName: contentType.info?.displayName ?? uid,
          fields,
        });
      }

      return result;
    },

    async getHistory(): Promise<HistoryEntry[]> {
      return _readHistory();
    },

    async importRecords(
      uid: string,
      rows: Record<string, string>[],
      fieldMapping: Record<string, string>,
      dryRun = false,
      batchOffset = 0,
      importMode: 'create' | 'upsert' = 'create',
      keyField?: string,
      rollbackOnFailure = false,
      runId?: string,
      isFinalChunk = false,
      totalRows?: number
    ) {
      cleanupStaleRuns();

      if (typeof uid !== 'string' || uid.trim() === '') {
        throw new Error('uid must be a non-empty string');
      }
      if (!Array.isArray(rows)) {
        throw new Error('rows must be an array');
      }
      if (!isPlainObject(fieldMapping)) {
        throw new Error('fieldMapping must be an object');
      }
      const hasInvalidMappingValue = Object.values(fieldMapping).some(
        (value) => typeof value !== 'string'
      );
      if (hasInvalidMappingValue) {
        throw new Error('fieldMapping values must be strings');
      }
      const duplicateMappedFields = findDuplicateMappedFields(fieldMapping);
      if (duplicateMappedFields.length > 0) {
        throw new Error(
          `fieldMapping maps multiple columns to the same field: ${duplicateMappedFields.join(', ')}`
        );
      }

      const contentType = strapi.contentTypes[uid];
      if (!contentType) {
        throw new Error(`Content type ${uid} not found`);
      }

      const attributes = contentType.attributes as Record<string, any>;
      const results = createEmptyImportResult();

      const mappedStrapiFields = new Set(
        Object.values(fieldMapping).filter((field): field is string => field.length > 0)
      );
      if (importMode === 'upsert') {
        if (!keyField) {
          throw new Error('keyField is required in upsert mode');
        }
        if (!attributes[keyField]) {
          throw new Error(`keyField '${keyField}' does not exist on ${uid}`);
        }
        if (attributes[keyField].unique !== true) {
          throw new Error(`keyField '${keyField}' must be unique for upsert`);
        }
        if (!mappedStrapiFields.has(keyField)) {
          throw new Error(`keyField '${keyField}' must be mapped to an input column`);
        }
      }

      const createdDocumentIds: string[] = [];
      const createdRows: Record<string, string>[] = [];

      let runState: ImportRunState | null = null;
      if (runId) {
        const existingState = importRuns.get(runId);
        if (existingState) {
          if (existingState.uid !== uid || existingState.mode !== importMode || existingState.dryRun !== dryRun) {
            throw new Error(`runId '${runId}' does not match current import settings`);
          }
          if (typeof totalRows === 'number' && totalRows > 0) {
            existingState.totalRows = totalRows;
          }
          existingState.lastTouchedAt = Date.now();
          runState = existingState;
        } else {
          runState = {
            uid,
            displayName: contentType.info?.displayName ?? uid,
            dryRun,
            mode: importMode,
            totalRows: typeof totalRows === 'number' && totalRows > 0 ? totalRows : rows.length,
            createdDocumentIds: [],
            createdRows: [],
            result: createEmptyImportResult(),
            lastTouchedAt: Date.now(),
          };
          importRuns.set(runId, runState);
        }
      }

      outer: for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = batchOffset + i + 2;

        // Feature 5: field type validation before data build
        for (const [csvColumn, strapiField] of Object.entries(fieldMapping)) {
          if (!strapiField || !csvColumn) continue;
          const rawValue = row[csvColumn];
          const attr = attributes[strapiField];
          if (!attr) continue;

          if (rawValue === undefined || rawValue === '') continue;
          const validationError = validateValue(rawValue, attr, strapiField, rowNum);
          if (validationError) {
            results.failed++;
            results.failedRows.push(row);
            results.errors.push(validationError);
            continue outer;
          }
        }

        const data: Record<string, any> = {};

        for (const [csvColumn, strapiField] of Object.entries(fieldMapping)) {
          if (!strapiField || !csvColumn) continue;
          const rawValue = row[csvColumn];
          if (rawValue === undefined || rawValue === '') continue;

          const attr = attributes[strapiField];
          if (!attr) continue;

          const type = attr.type;
          if (type === 'integer' || type === 'biginteger') {
            data[strapiField] = parseInt(rawValue.trim(), 10);
          } else if (type === 'float' || type === 'decimal') {
            data[strapiField] = parseFloat(rawValue.trim());
          } else if (type === 'boolean') {
            data[strapiField] =
              rawValue.toLowerCase() === 'true' || rawValue === '1';
          } else if (type === 'relation') {
            const ids = rawValue.split(',').map((s: string) => s.trim()).filter(Boolean);
            data[strapiField] = { connect: ids.map((documentId: string) => ({ documentId })) };
          } else if (type === 'media') {
            const ids = rawValue.split(',').map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => !isNaN(n));
            data[strapiField] = { connect: ids.map((id: number) => ({ id })) };
          } else {
            data[strapiField] = rawValue;
          }
        }

        // 日付系フィールドを現在日時で自動補完（マッピング済みフィールドは除く）
        const now = new Date();
        for (const [fieldName, attr] of Object.entries(attributes)) {
          if (
            SYSTEM_FIELDS.has(fieldName) ||
            !isImportableAttribute(attr) ||
            !DATE_TYPES.includes(attr.type) ||
            mappedStrapiFields.has(fieldName) ||
            fieldName in data
          ) {
            continue;
          }

          if (attr.type === 'date') {
            data[fieldName] = now.toISOString().split('T')[0];
          } else if (attr.type === 'time') {
            data[fieldName] = now.toTimeString().split(' ')[0];
          } else {
            data[fieldName] = now.toISOString();
          }
        }

        // Feature 6: required field check (includes unmapped required fields)
        for (const [fieldName, attr] of Object.entries(attributes)) {
          if (
            SYSTEM_FIELDS.has(fieldName) ||
            !isImportableAttribute(attr) ||
            attr.required !== true
          ) {
            continue;
          }

          if (isMissingRequiredValue(data[fieldName])) {
            results.failed++;
            results.failedRows.push(row);
            results.errors.push(`Row ${rowNum}: field '${fieldName}' is required`);
            continue outer;
          }
        }

        if (importMode === 'upsert' && keyField && data[keyField] === undefined) {
          results.failed++;
          results.failedRows.push(row);
          results.errors.push(`Row ${rowNum}: key field '${keyField}' is required for upsert`);
          continue;
        }

        try {
          if (!dryRun) {
            if (importMode === 'upsert' && keyField && data[keyField] !== undefined) {
              const existing = await strapi.documents(uid).findMany({
                filters: { [keyField]: data[keyField] },
                limit: 2,
              });
              if (existing.length > 1) {
                results.failed++;
                results.failedRows.push(row);
                results.errors.push(
                  `Row ${rowNum}: multiple records matched key field '${keyField}' with value '${data[keyField]}'`
                );
                continue;
              }
              if (existing.length === 1) {
                await strapi.documents(uid).update({ documentId: existing[0].documentId, data });
                results.updated++;
                continue;
              }
            }
            const created = await strapi.documents(uid).create({ data });
            if (rollbackOnFailure) {
              createdDocumentIds.push(created.documentId);
              createdRows.push(row);
            }
          }
          results.success++;
        } catch (err: unknown) {
          results.failed++;
          results.failedRows.push(row);
          const details = getErrorDetails(err);
          const detail = details.length > 0 ? ` (${details.join(', ')})` : '';
          results.errors.push(`Row ${rowNum}: ${getErrorMessage(err)}${detail}`);
        }
      }

      if (runState) {
        runState.lastTouchedAt = Date.now();
        runState.result.success += results.success;
        runState.result.updated += results.updated;
        runState.result.failed += results.failed;
        runState.result.errors.push(...results.errors);
        runState.result.failedRows.push(...results.failedRows);
        runState.createdDocumentIds.push(...createdDocumentIds);
        runState.createdRows.push(...createdRows);

        if (rollbackOnFailure && runState.result.failed > 0 && !dryRun && runState.createdDocumentIds.length > 0) {
          await _rollbackCreatedDocuments(uid, runState.createdDocumentIds, runState.result, runState.createdRows);
          runState.createdDocumentIds = [];
          runState.createdRows = [];
        }

        const completed = isFinalChunk || runState.result.rollbackApplied === true;
        runState.result.completed = completed;

        if (completed) {
          try {
            await _writeHistoryEntry(
              uid,
              runState.displayName,
              runState.dryRun,
              runState.mode,
              runState.result,
              runState.totalRows
            );
          } catch {
            // ignore history write errors
          } finally {
            if (runId) {
              importRuns.delete(runId);
            }
          }
        }

        return {
          ...runState.result,
          errors: [...runState.result.errors],
          failedRows: [...runState.result.failedRows],
        };
      }

      // Non-chunked call (backward-compatible path)
      if (rollbackOnFailure && results.failed > 0 && !dryRun && createdDocumentIds.length > 0) {
        await _rollbackCreatedDocuments(uid, createdDocumentIds, results, createdRows);
      }

      try {
        await _writeHistoryEntry(
          uid,
          contentType.info?.displayName ?? uid,
          dryRun,
          importMode,
          results,
          typeof totalRows === 'number' && totalRows > 0 ? totalRows : rows.length
        );
      } catch {
        // ignore history write errors
      }

      return results;
    },
  };
};
