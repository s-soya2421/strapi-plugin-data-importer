import { ParseCSVResult } from './parseCSV';

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
      const value = record[h];
      obj[h] = value === null ? '' : String(value);
    });
    return obj;
  });

  return { headers, rows };
}
