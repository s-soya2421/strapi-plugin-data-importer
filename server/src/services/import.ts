import fs from 'fs';
import path from 'path';
import { errors } from '@strapi/utils';

const { ForbiddenError } = errors;

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
const HISTORY_STORE_KEY = 'plugin_data-importer_history';
const RUN_STORE_KEY_PREFIX = 'plugin_data-importer_run:';
const STORE_SCOPE = {
  type: 'plugin',
  tag: 'data-importer',
};

type ImportMode = 'create' | 'upsert';

type ContentTypeAttributes = Record<string, any>;

type ImportRow = Record<string, string>;

type QueryLike = {
  findOne?: (params: { where: Record<string, unknown> }) => Promise<any>;
  create?: (params: { data: Record<string, unknown> }) => Promise<any>;
  update?: (params: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }) => Promise<any>;
  delete?: (params: { where: Record<string, unknown> }) => Promise<any>;
  deleteMany?: (params: { where: Record<string, unknown> }) => Promise<any>;
};

type PermissionChecker = {
  cannot?: {
    read?: (entity?: unknown, field?: string) => boolean;
    create?: (entity?: unknown, field?: string) => boolean;
    update?: (entity?: unknown, field?: string) => boolean;
  };
  sanitizeCreateInput?: (data: Record<string, any>) => Promise<Record<string, any>> | Record<string, any>;
  sanitizeUpdateInput?: (
    entity: Record<string, any>
  ) =>
    | ((data: Record<string, any>) => Promise<Record<string, any>> | Record<string, any>)
    | undefined;
  sanitizedQuery?: {
    read?: (query: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
    update?: (query: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  };
};

interface FsPromisesLike {
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
}

export interface ImportResult {
  success: number;
  updated: number;
  failed: number;
  errors: string[];
  failedRows: ImportRow[];
  rollbackApplied?: boolean;
  completed?: boolean;
}

interface ImportRunState {
  uid: string;
  displayName: string;
  dryRun: boolean;
  mode: ImportMode;
  totalRows: number;
  createdDocumentIds: string[];
  createdRows: ImportRow[];
  result: ImportResult;
  lastTouchedAt: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  uid: string;
  displayName: string;
  dryRun: boolean;
  mode: ImportMode;
  success: number;
  updated: number;
  failed: number;
  totalRows: number;
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

function getStoreWhere(strapi: any, key: string) {
  return {
    key,
    ...STORE_SCOPE,
    environment: strapi?.config?.environment ?? '',
  };
}

function getCoreStoreQuery(strapi: any): QueryLike | null {
  if (typeof strapi?.db?.query === 'function') {
    return strapi.db.query('strapi::core-store');
  }
  if (typeof strapi?.query === 'function') {
    return strapi.query('strapi::core-store');
  }
  return null;
}

async function readCoreStoreJson<T>(strapi: any, key: string, fallback: T): Promise<T> {
  const query = getCoreStoreQuery(strapi);
  if (!query?.findOne) return fallback;

  try {
    const entry = await query.findOne({ where: getStoreWhere(strapi, key) });
    if (!entry || typeof entry.value !== 'string') {
      return fallback;
    }

    return JSON.parse(entry.value) as T;
  } catch {
    return fallback;
  }
}

async function writeCoreStoreJson(strapi: any, key: string, value: unknown): Promise<void> {
  const query = getCoreStoreQuery(strapi);
  if (!query?.create || !query?.update) return;

  const where = getStoreWhere(strapi, key);
  const data = {
    ...where,
    value: JSON.stringify(value),
  };
  const existing = query.findOne ? await query.findOne({ where }) : null;

  if (existing) {
    await query.update({ where, data });
    return;
  }

  await query.create({ data });
}

async function deleteCoreStoreJson(strapi: any, key: string): Promise<void> {
  const query = getCoreStoreQuery(strapi);
  if (!query) return;

  const where = getStoreWhere(strapi, key);
  if (typeof query.delete === 'function') {
    await query.delete({ where });
    return;
  }
  if (typeof query.deleteMany === 'function') {
    await query.deleteMany({ where });
    return;
  }
}

function getImportRunKey(runId: string): string {
  return `${RUN_STORE_KEY_PREFIX}${runId}`;
}

function getPermissionChecker(strapi: any, model: string): PermissionChecker | null {
  const userAbility = strapi?.requestContext?.get?.()?.state?.userAbility;
  const permissionCheckerService = strapi?.plugin?.('content-manager')?.service?.('permission-checker');

  if (!userAbility || typeof permissionCheckerService?.create !== 'function') {
    return null;
  }

  return permissionCheckerService.create({ userAbility, model }) as PermissionChecker;
}

function requirePermissionChecker(strapi: any, model: string): PermissionChecker {
  const permissionChecker = getPermissionChecker(strapi, model);
  if (!permissionChecker) {
    throw new ForbiddenError('Unable to verify content permissions for this request');
  }
  return permissionChecker;
}

function isActionForbidden(
  permissionChecker: PermissionChecker | null,
  action: 'read' | 'create' | 'update',
  entity?: unknown
): boolean {
  const cannot = permissionChecker?.cannot?.[action];
  if (typeof cannot !== 'function') {
    return false;
  }
  return cannot(entity) === true;
}

async function sanitizePermissionQuery(
  permissionChecker: PermissionChecker,
  action: 'read' | 'update',
  query: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const sanitizer = permissionChecker.sanitizedQuery?.[action];
  if (typeof sanitizer !== 'function') {
    return query;
  }
  return sanitizer(query);
}

async function sanitizeCreateData(
  permissionChecker: PermissionChecker,
  data: Record<string, any>
): Promise<Record<string, any>> {
  if (typeof permissionChecker.sanitizeCreateInput !== 'function') {
    return data;
  }
  return permissionChecker.sanitizeCreateInput(data);
}

async function sanitizeUpdateData(
  permissionChecker: PermissionChecker,
  entity: Record<string, any>,
  data: Record<string, any>
): Promise<Record<string, any>> {
  if (typeof permissionChecker.sanitizeUpdateInput !== 'function') {
    return data;
  }

  const sanitizer = permissionChecker.sanitizeUpdateInput(entity);
  if (typeof sanitizer !== 'function') {
    return data;
  }

  return sanitizer(data);
}

function fillDefaultRequiredDateFields(
  data: Record<string, any>,
  attributes: ContentTypeAttributes,
  mappedFields: Set<string>
): Record<string, any> {
  const nextData = { ...data };
  const now = new Date();

  for (const [fieldName, attr] of Object.entries(attributes)) {
    if (
      SYSTEM_FIELDS.has(fieldName) ||
      !isImportableAttribute(attr) ||
      attr.required !== true ||
      !DATE_TYPES.includes(attr.type) ||
      mappedFields.has(fieldName) ||
      fieldName in nextData
    ) {
      continue;
    }

    if (attr.type === 'date') {
      nextData[fieldName] = now.toISOString().split('T')[0];
    } else if (attr.type === 'time') {
      nextData[fieldName] = now.toTimeString().split(' ')[0];
    } else {
      nextData[fieldName] = now.toISOString();
    }
  }

  return nextData;
}

function getRequiredFieldError(
  attributes: ContentTypeAttributes,
  data: Record<string, any>,
  rowNum: number
): string | null {
  for (const [fieldName, attr] of Object.entries(attributes)) {
    if (
      SYSTEM_FIELDS.has(fieldName) ||
      !isImportableAttribute(attr) ||
      attr.required !== true
    ) {
      continue;
    }

    if (isMissingRequiredValue(data[fieldName])) {
      return `Row ${rowNum}: field '${fieldName}' is required`;
    }
  }

  return null;
}

function cloneImportResult(result: ImportResult): ImportResult {
  return {
    ...result,
    errors: [...result.errors],
    failedRows: [...result.failedRows],
  };
}

function buildRowPermissionError(rowNum: number, action: 'create' | 'update', uid: string): string {
  return `Row ${rowNum}: you do not have permission to ${action} records for '${uid}'`;
}

export default ({ strapi }: { strapi: any }) => {
  const mappingPath = path.join(process.cwd(), 'config', 'data-importer-mappings.json');
  let historyWriteQueue: Promise<void> = Promise.resolve();

  const queueHistoryWrite = async (writeOperation: () => Promise<void>) => {
    const pending = historyWriteQueue.then(writeOperation, writeOperation);
    historyWriteQueue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  };

  const readHistory = async (): Promise<HistoryEntry[]> => {
    const history = await readCoreStoreJson<unknown>(strapi, HISTORY_STORE_KEY, []);
    return Array.isArray(history) ? (history as HistoryEntry[]) : [];
  };

  const writeHistoryEntry = async (
    uid: string,
    displayName: string,
    dryRun: boolean,
    mode: ImportMode,
    result: ImportResult,
    totalRows: number
  ) => {
    return queueHistoryWrite(async () => {
      const history = await readHistory();
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
      await writeCoreStoreJson(strapi, HISTORY_STORE_KEY, history.slice(0, 50));
    });
  };

  const loadRunState = async (runId: string): Promise<ImportRunState | null> => {
    const runState = await readCoreStoreJson<ImportRunState | null>(
      strapi,
      getImportRunKey(runId),
      null
    );

    if (!runState || !isPlainObject(runState)) {
      return null;
    }

    if (Date.now() - Number(runState.lastTouchedAt ?? 0) > IMPORT_RUN_TTL_MS) {
      await deleteCoreStoreJson(strapi, getImportRunKey(runId));
      return null;
    }

    return runState;
  };

  const saveRunState = async (runId: string, state: ImportRunState) => {
    await writeCoreStoreJson(strapi, getImportRunKey(runId), state);
  };

  const deleteRunState = async (runId: string) => {
    await deleteCoreStoreJson(strapi, getImportRunKey(runId));
  };

  const rollbackCreatedDocuments = async (
    uid: string,
    createdDocumentIds: string[],
    result: ImportResult,
    createdRows: ImportRow[]
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
      const result: Array<{
        uid: string;
        displayName: string;
        fields: Array<{
          name: string;
          type: string;
          relationType?: string;
          multiple?: boolean;
          required?: boolean;
          unique?: boolean;
        }>;
      }> = [];

      for (const [uid, contentType] of Object.entries(contentTypes) as [string, any][]) {
        if (!uid.startsWith('api::')) continue;

        const permissionChecker = getPermissionChecker(strapi, uid);
        const hasAccess =
          !permissionChecker ||
          !isActionForbidden(permissionChecker, 'read') ||
          !isActionForbidden(permissionChecker, 'create') ||
          !isActionForbidden(permissionChecker, 'update');
        if (!hasAccess) {
          continue;
        }

        const fields = Object.entries(contentType.attributes as Record<string, any>)
          .filter(([name, attr]) => {
            if (SYSTEM_FIELDS.has(name)) return false;
            return isImportableAttribute(attr);
          })
          .map(([name, attr]) => {
            const field: {
              name: string;
              type: string;
              relationType?: string;
              multiple?: boolean;
              required?: boolean;
              unique?: boolean;
            } = { name, type: attr.type };
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
      return readHistory();
    },

    async importRecords(
      uid: string,
      rows: ImportRow[],
      fieldMapping: Record<string, string>,
      dryRun = false,
      batchOffset = 0,
      importMode: ImportMode = 'create',
      keyField?: string,
      rollbackOnFailure = false,
      runId?: string,
      isFinalChunk = false,
      totalRows?: number
    ) {
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

      const permissionChecker = requirePermissionChecker(strapi, uid);
      if (importMode === 'create' && isActionForbidden(permissionChecker, 'create')) {
        throw new ForbiddenError(`You do not have permission to create records for '${uid}'`);
      }
      if (importMode === 'upsert' && isActionForbidden(permissionChecker, 'read')) {
        throw new ForbiddenError(`You do not have permission to read records for '${uid}'`);
      }
      if (
        importMode === 'upsert' &&
        isActionForbidden(permissionChecker, 'create') &&
        isActionForbidden(permissionChecker, 'update')
      ) {
        throw new ForbiddenError(
          `You do not have permission to create or update records for '${uid}'`
        );
      }

      const attributes = contentType.attributes as ContentTypeAttributes;
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
      const createdRows: ImportRow[] = [];

      let runState: ImportRunState | null = null;
      if (runId) {
        const existingState = await loadRunState(runId);
        if (existingState) {
          if (
            existingState.uid !== uid ||
            existingState.mode !== importMode ||
            existingState.dryRun !== dryRun
          ) {
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
        }
      }

      outer: for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = batchOffset + i + 2;

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
            data[strapiField] = rawValue.toLowerCase() === 'true' || rawValue === '1';
          } else if (type === 'relation') {
            const ids = rawValue.split(',').map((s: string) => s.trim()).filter(Boolean);
            data[strapiField] = { connect: ids.map((documentId: string) => ({ documentId })) };
          } else if (type === 'media') {
            const ids = rawValue
              .split(',')
              .map((s: string) => parseInt(s.trim(), 10))
              .filter((n: number) => !isNaN(n));
            data[strapiField] = { connect: ids.map((id: number) => ({ id })) };
          } else {
            data[strapiField] = rawValue;
          }
        }

        let operation: 'create' | 'update' = 'create';
        let existingDocument: Record<string, any> | undefined;

        if (importMode === 'upsert' && keyField) {
          if (data[keyField] === undefined) {
            results.failed++;
            results.failedRows.push(row);
            results.errors.push(`Row ${rowNum}: key field '${keyField}' is required for upsert`);
            continue;
          }

          const readQuery = await sanitizePermissionQuery(permissionChecker, 'read', {
            filters: { [keyField]: data[keyField] },
            limit: 2,
          });
          const existing = await strapi.documents(uid).findMany(readQuery);

          if (existing.length > 1) {
            results.failed++;
            results.failedRows.push(row);
            results.errors.push(
              `Row ${rowNum}: multiple records matched key field '${keyField}' with value '${data[keyField]}'`
            );
            continue;
          }

          if (existing.length === 1) {
            if (isActionForbidden(permissionChecker, 'update')) {
              results.failed++;
              results.failedRows.push(row);
              results.errors.push(buildRowPermissionError(rowNum, 'update', uid));
              continue;
            }

            const updateQuery = await sanitizePermissionQuery(permissionChecker, 'update', {
              filters: { documentId: existing[0].documentId },
              limit: 1,
            });
            const updatableRecords = await strapi.documents(uid).findMany(updateQuery);
            if (updatableRecords.length === 0) {
              results.failed++;
              results.failedRows.push(row);
              results.errors.push(buildRowPermissionError(rowNum, 'update', uid));
              continue;
            }

            existingDocument = updatableRecords[0];
            if (isActionForbidden(permissionChecker, 'update', existingDocument)) {
              results.failed++;
              results.failedRows.push(row);
              results.errors.push(buildRowPermissionError(rowNum, 'update', uid));
              continue;
            }

            operation = 'update';
          } else if (isActionForbidden(permissionChecker, 'create')) {
            results.failed++;
            results.failedRows.push(row);
            results.errors.push(buildRowPermissionError(rowNum, 'create', uid));
            continue;
          }
        }

        try {
          if (operation === 'update' && existingDocument) {
            const updateData = await sanitizeUpdateData(permissionChecker, existingDocument, data);
            if (!dryRun) {
              await strapi.documents(uid).update({
                documentId: existingDocument.documentId,
                data: updateData,
              });
            }
            results.updated++;
            continue;
          }

          const createData = await sanitizeCreateData(
            permissionChecker,
            fillDefaultRequiredDateFields(data, attributes, mappedStrapiFields)
          );
          const requiredFieldError = getRequiredFieldError(attributes, createData, rowNum);
          if (requiredFieldError) {
            results.failed++;
            results.failedRows.push(row);
            results.errors.push(requiredFieldError);
            continue;
          }

          if (!dryRun) {
            const created = await strapi.documents(uid).create({ data: createData });
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

      if (runState && runId) {
        runState.lastTouchedAt = Date.now();
        runState.result.success += results.success;
        runState.result.updated += results.updated;
        runState.result.failed += results.failed;
        runState.result.errors.push(...results.errors);
        runState.result.failedRows.push(...results.failedRows);
        runState.createdDocumentIds.push(...createdDocumentIds);
        runState.createdRows.push(...createdRows);

        if (
          rollbackOnFailure &&
          runState.result.failed > 0 &&
          !dryRun &&
          runState.createdDocumentIds.length > 0
        ) {
          await rollbackCreatedDocuments(
            uid,
            runState.createdDocumentIds,
            runState.result,
            runState.createdRows
          );
          runState.createdDocumentIds = [];
          runState.createdRows = [];
        }

        const completed = isFinalChunk || runState.result.rollbackApplied === true;
        runState.result.completed = completed;

        if (completed) {
          try {
            await writeHistoryEntry(
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
            await deleteRunState(runId);
          }
        } else {
          await saveRunState(runId, runState);
        }

        return cloneImportResult(runState.result);
      }

      if (rollbackOnFailure && results.failed > 0 && !dryRun && createdDocumentIds.length > 0) {
        await rollbackCreatedDocuments(uid, createdDocumentIds, results, createdRows);
      }

      try {
        await writeHistoryEntry(
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
