export interface ImportRequestBody {
  uid?: unknown;
  rows?: unknown;
  fieldMapping?: unknown;
  dryRun?: unknown;
  batchOffset?: unknown;
  importMode?: unknown;
  keyField?: unknown;
  rollbackOnFailure?: unknown;
  runId?: unknown;
  isFinalChunk?: unknown;
  totalRows?: unknown;
}

export interface ControllerCtx {
  request: {
    body?: ImportRequestBody;
  };
  body?: unknown;
  badRequest: (message: string) => unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
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

function normalizeFieldMapping(rawFieldMapping: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [csvColumn, mappedField] of Object.entries(rawFieldMapping)) {
    normalized[csvColumn] = typeof mappedField === 'string' ? mappedField : '';
  }
  return normalized;
}

export default ({ strapi }: { strapi: any }) => ({
  async getMappings(ctx: ControllerCtx) {
    const service = strapi.plugin('data-importer').service('import');
    const mappings = await service.getMappings();
    ctx.body = { data: mappings };
  },

  async getContentTypes(ctx: ControllerCtx) {
    const service = strapi.plugin('data-importer').service('import');
    const contentTypes = await service.getContentTypes();
    ctx.body = { data: contentTypes };
  },

  async getHistory(ctx: ControllerCtx) {
    const service = strapi.plugin('data-importer').service('import');
    const history = await service.getHistory();
    ctx.body = { data: history };
  },

  async importRecords(ctx: ControllerCtx) {
    const body = ctx.request.body ?? {};
    const {
      uid,
      rows,
      fieldMapping,
      dryRun = false,
      batchOffset = 0,
      importMode = 'create',
      keyField,
      rollbackOnFailure,
      runId,
      isFinalChunk = false,
      totalRows,
    } = body;

    if (typeof uid !== 'string' || uid.trim() === '' || !Array.isArray(rows)) {
      return ctx.badRequest('uid must be a non-empty string and rows must be an array');
    }

    if (!isPlainObject(fieldMapping)) {
      return ctx.badRequest('fieldMapping must be an object');
    }

    const hasInvalidMappingValue = Object.values(fieldMapping).some(
      (value) => value !== undefined && value !== null && typeof value !== 'string'
    );
    if (hasInvalidMappingValue) {
      return ctx.badRequest('fieldMapping values must be strings');
    }

    const normalizedFieldMapping = normalizeFieldMapping(fieldMapping);
    const duplicateMappedFields = findDuplicateMappedFields(normalizedFieldMapping);
    if (duplicateMappedFields.length > 0) {
      return ctx.badRequest(
        `fieldMapping maps multiple columns to the same field: ${duplicateMappedFields.join(', ')}`
      );
    }

    const normalizedImportMode = importMode === 'upsert' ? 'upsert' : 'create';
    const normalizedKeyField =
      typeof keyField === 'string' && keyField.trim() !== '' ? keyField : undefined;
    const normalizedBatchOffset =
      typeof batchOffset === 'number' && Number.isFinite(batchOffset) ? batchOffset : 0;
    const normalizedDryRun = dryRun === true;
    const normalizedRollbackOnFailure =
      rollbackOnFailure === undefined ? undefined : rollbackOnFailure === true;
    const normalizedRunId =
      typeof runId === 'string' && runId.trim() !== '' ? runId : undefined;
    const normalizedIsFinalChunk = isFinalChunk === true;
    const normalizedTotalRows =
      typeof totalRows === 'number' && Number.isFinite(totalRows) ? totalRows : undefined;

    const service = strapi.plugin('data-importer').service('import');
    const baseArgs = [
      uid,
      rows,
      normalizedFieldMapping,
      normalizedDryRun,
      normalizedBatchOffset,
      normalizedImportMode,
      normalizedKeyField,
      normalizedRollbackOnFailure,
    ];
    const result = normalizedRunId
      ? await service.importRecords(
          ...baseArgs,
          normalizedRunId,
          normalizedIsFinalChunk,
          normalizedTotalRows
        )
      : await service.importRecords(...baseArgs);
    ctx.body = { data: result };
  },
});
