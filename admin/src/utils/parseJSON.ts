import { ParseCSVResult } from './parseCSV';

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
        return (value as any[]).map((item) => String(item.documentId)).join(',');
      }
      if ('id' in first) {
        return (value as any[]).map((item) => String(item.id)).join(',');
      }
      return JSON.stringify(value);
    }
    return (value as any[]).map((v) => String(v)).join(',');
  }
  return JSON.stringify(value);
}

export function parseJSON(text: string): ParseCSVResult {
  if (!text.trim()) return { headers: [], rows: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { headers: [], rows: [] };
  }

  if (!Array.isArray(parsed) || parsed.length === 0) return { headers: [], rows: [] };

  const headers = Object.keys(parsed[0] as Record<string, unknown>);
  const rows = parsed.map((item: unknown) => {
    const record = item as Record<string, unknown>;
    const obj: Record<string, string> = {};
    headers.forEach((h) => {
      obj[h] = valueToString(record[h]);
    });
    return obj;
  });

  return { headers, rows };
}
