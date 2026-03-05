export interface ParseCSVResult {
  headers: string[];
  rows: Record<string, string>[];
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  const pushRow = () => {
    row.push(current);
    current = '';
    if (row.length === 1 && row[0].trim() === '') {
      row = [];
      return;
    }
    if (row.some((cell) => cell.trim() !== '')) {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ',') {
      row.push(current);
      current = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      pushRow();
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

function mapRowToObject(values: string[], headers: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  headers.forEach((header, index) => {
    obj[header] = values[index] ?? '';
  });
  return obj;
}

export function parseCSV(text: string): ParseCSVResult {
  const normalized = text.replace(/^\uFEFF/, '');
  const parsedRows = parseRows(normalized);
  if (parsedRows.length === 0) return { headers: [], rows: [] };

  const headers = parsedRows[0];
  const rows = parsedRows.slice(1).map((values) => mapRowToObject(values, headers));

  return { headers, rows };
}
