import fs from 'fs';
import path from 'path';

const DATE_TYPES = ['date', 'datetime', 'time'];

function validateValue(value: string, attr: any, fieldName: string, rowNum: number): string | null {
  const type = attr.type;
  if (type === 'integer' || type === 'biginteger') {
    if (!/^-?\d+$/.test(value)) {
      return `Row ${rowNum}: field '${fieldName}' expects integer, got '${value}'`;
    }
  } else if (type === 'float' || type === 'decimal') {
    if (isNaN(parseFloat(value))) {
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

  const _readHistory = async (): Promise<HistoryEntry[]> => {
    try {
      const data = fs.readFileSync(historyPath, 'utf-8');
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  return {
    async getMappings(): Promise<Record<string, Record<string, string>>> {
      const mappingPath = path.join(process.cwd(), 'config', 'data-importer-mappings.json');
      try {
        return JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
      } catch {
        return {};
      }
    },

    async getContentTypes() {
      const contentTypes = strapi.contentTypes;
      const result: Array<{ uid: string; displayName: string; fields: Array<{ name: string; type: string; relationType?: string; multiple?: boolean }> }> = [];

      for (const [uid, contentType] of Object.entries(contentTypes) as [string, any][]) {
        if (!uid.startsWith('api::')) continue;

        const fields = Object.entries(contentType.attributes as Record<string, any>)
          .filter(([, attr]) => {
            const type = attr.type;
            return !['component', 'dynamiczone'].includes(type);
          })
          .map(([name, attr]) => {
            const field: { name: string; type: string; relationType?: string; multiple?: boolean } = { name, type: attr.type };
            if (attr.type === 'relation') {
              field.relationType = attr.relationType;
            }
            if (attr.type === 'media') {
              field.multiple = attr.multiple ?? false;
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
      rollbackOnFailure = false
    ) {
      const contentType = strapi.contentTypes[uid];
      if (!contentType) {
        throw new Error(`Content type ${uid} not found`);
      }

      const attributes = contentType.attributes as Record<string, any>;
      const results = { success: 0, updated: 0, failed: 0, errors: [] as string[], failedRows: [] as Record<string, string>[] };

      const mappedStrapiFields = new Set(Object.values(fieldMapping).filter(Boolean));
      const createdDocumentIds: string[] = [];
      const succeededRows: Record<string, string>[] = [];

      outer: for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = batchOffset + i + 2;

        // Feature 5: field type validation before data build
        for (const [csvColumn, strapiField] of Object.entries(fieldMapping)) {
          if (!strapiField || !csvColumn) continue;
          const rawValue = row[csvColumn];
          if (rawValue === undefined || rawValue === '') continue;
          const attr = attributes[strapiField];
          if (!attr) continue;
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
            data[strapiField] = parseInt(rawValue, 10);
          } else if (type === 'float' || type === 'decimal') {
            data[strapiField] = parseFloat(rawValue);
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
          if (DATE_TYPES.includes(attr.type) && !mappedStrapiFields.has(fieldName) && !(fieldName in data)) {
            if (attr.type === 'date') {
              data[fieldName] = now.toISOString().split('T')[0];
            } else if (attr.type === 'time') {
              data[fieldName] = now.toTimeString().split(' ')[0];
            } else {
              data[fieldName] = now.toISOString();
            }
          }
        }

        try {
          if (!dryRun) {
            if (importMode === 'upsert' && keyField && data[keyField] !== undefined) {
              const existing = await strapi.documents(uid).findMany({
                filters: { [keyField]: data[keyField] },
                limit: 1,
              });
              if (existing.length > 0) {
                await strapi.documents(uid).update({ documentId: existing[0].documentId, data });
                results.updated++;
                continue;
              }
            }
            const created = await strapi.documents(uid).create({ data });
            if (rollbackOnFailure) createdDocumentIds.push(created.documentId);
          }
          results.success++;
          if (rollbackOnFailure) succeededRows.push(row);
        } catch (err: any) {
          results.failed++;
          results.failedRows.push(row);
          const details: string[] = err.details?.errors?.map(
            (e: any) => `${e.path?.join('.') ?? 'unknown'}: ${e.message}`
          ) ?? [];
          const detail = details.length > 0 ? ` (${details.join(', ')})` : '';
          results.errors.push(`Row ${rowNum}: ${err.message ?? String(err)}${detail}`);
        }
      }

      // Feature 4: rollback created records if any row failed
      if (rollbackOnFailure && results.failed > 0 && !dryRun) {
        for (const documentId of createdDocumentIds) {
          await strapi.documents(uid).delete({ documentId });
        }
        results.failed += results.success;
        results.failedRows.push(...succeededRows);
        results.success = 0;
        results.updated = 0;
        results.errors.unshift(`Rolled back ${createdDocumentIds.length} record(s) due to errors.`);
      }

      try {
        const history = await _readHistory();
        history.unshift({
          id: Date.now().toString(),
          timestamp: new Date().toISOString(),
          uid,
          displayName: contentType.info?.displayName ?? uid,
          dryRun,
          mode: importMode,
          success: results.success,
          updated: results.updated,
          failed: results.failed,
          totalRows: rows.length,
        });
        fs.writeFileSync(historyPath, JSON.stringify(history.slice(0, 50), null, 2), 'utf-8');
      } catch {
        // ignore history write errors
      }

      return results;
    },
  };
};
