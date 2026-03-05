import { ParseCSVResult } from './parseCSV';

interface RecordWithUnknownValues {
  [key: string]: unknown;
}

export interface ParseJSONResult extends ParseCSVResult {
  error?: string;
}

function emptyResult(error?: string): ParseJSONResult {
  if (error) {
    return { headers: [], rows: [], error };
  }
  return { headers: [], rows: [] };
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    const first = value[0];
    if (typeof first === 'object' && first !== null) {
      if ('documentId' in first) {
        return value
          .map((item) =>
            typeof item === 'object' && item !== null && 'documentId' in item
              ? String((item as { documentId?: unknown }).documentId)
              : ''
          )
          .filter(Boolean)
          .join(',');
      }
      if ('id' in first) {
        return value
          .map((item) =>
            typeof item === 'object' && item !== null && 'id' in item
              ? String((item as { id?: unknown }).id)
              : ''
          )
          .filter(Boolean)
          .join(',');
      }
      return JSON.stringify(value);
    }
    return value.map((v) => String(v)).join(',');
  }
  return JSON.stringify(value);
}

export function parseJSON(text: string): ParseJSONResult {
  if (!text.trim()) return emptyResult();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyResult('Invalid JSON syntax.');
  }

  if (!Array.isArray(parsed)) {
    return emptyResult('JSON root must be an array of objects.');
  }
  if (parsed.length === 0) return emptyResult();

  const records = parsed.filter(
    (item): item is RecordWithUnknownValues =>
      typeof item === 'object' && item !== null && !Array.isArray(item)
  );

  if (records.length === 0) {
    return emptyResult('JSON array must contain at least one object.');
  }

  const seenHeaders = new Set<string>();
  const headers: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (!seenHeaders.has(key)) {
        seenHeaders.add(key);
        headers.push(key);
      }
    }
  }

  const rows = records.map((record) => {
    const obj: Record<string, string> = {};
    headers.forEach((h) => {
      obj[h] = valueToString(record[h]);
    });
    return obj;
  });

  return { headers, rows };
}
