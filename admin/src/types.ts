export interface FieldInfo {
  name: string;
  type: string;
  relationType?: string;
  multiple?: boolean;
  required?: boolean;
  unique?: boolean;
}

export interface ContentTypeInfo {
  uid: string;
  displayName: string;
  fields: FieldInfo[];
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

export interface DataResponse<T> {
  data?: {
    data?: T;
  };
}

export type FieldMapping = Record<string, string>;
export type AllMappings = Record<string, FieldMapping>;
