import fs from 'fs';
import path from 'path';

const DATE_TYPES = ['date', 'datetime', 'time'];

export default ({ strapi }: { strapi: any }) => ({
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

  async importRecords(
    uid: string,
    rows: Record<string, string>[],
    fieldMapping: Record<string, string>,
    dryRun = false,
    batchOffset = 0
  ) {
    const contentType = strapi.contentTypes[uid];
    if (!contentType) {
      throw new Error(`Content type ${uid} not found`);
    }

    const attributes = contentType.attributes as Record<string, any>;
    const results = { success: 0, failed: 0, errors: [] as string[], failedRows: [] as Record<string, string>[] };

    const mappedStrapiFields = new Set(Object.values(fieldMapping).filter(Boolean));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
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

      const rowNum = batchOffset + i + 2;

      try {
        if (!dryRun) {
          await strapi.documents(uid).create({ data });
        }
        results.success++;
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

    return results;
  },
});
