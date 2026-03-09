/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useImport } from '../hooks/useImport';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('react-intl', () => ({
  useIntl: () => ({
    formatMessage: (
      { defaultMessage }: { defaultMessage: string },
      values?: Record<string, unknown>
    ) => {
      if (!values) return defaultMessage;
      return defaultMessage.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
    },
  }),
}));

const mockGet = jest.fn();
const mockPost = jest.fn();

jest.mock('@strapi/admin/strapi-admin', () => ({
  useFetchClient: () => ({ get: mockGet, post: mockPost }),
}));

jest.mock('../utils/parseCSV', () => ({
  parseCSV: jest.fn(() => ({
    headers: ['title', 'body'],
    rows: [
      { title: 'Hello', body: 'World' },
      { title: 'Foo', body: 'Bar' },
    ],
  })),
}));

jest.mock('../utils/parseJSON', () => ({
  parseJSON: jest.fn(() => ({
    headers: ['title', 'body'],
    rows: [{ title: 'Hello', body: 'World' }],
  })),
}));

global.URL.createObjectURL = jest.fn(() => 'blob:mock');
global.URL.revokeObjectURL = jest.fn();

// ── Test data ──────────────────────────────────────────────────────────────

const mockContentTypes = [
  {
    uid: 'api::article.article',
    displayName: 'Article',
    fields: [
      { name: 'title', type: 'string', required: true, unique: true },
      { name: 'body', type: 'text' },
    ],
  },
];

const makeGetMock = (extraHistory: unknown[] = []) =>
  (url: string) => {
    if (url === '/data-importer/content-types')
      return Promise.resolve({ data: { data: mockContentTypes } });
    if (url === '/data-importer/mappings')
      return Promise.resolve({ data: { data: {} } });
    if (url === '/data-importer/history')
      return Promise.resolve({ data: { data: extraHistory } });
    return Promise.resolve({ data: { data: null } });
  };

// ── Helpers ────────────────────────────────────────────────────────────────

/** Render the hook and wait for initial useEffect to settle */
async function setupHook() {
  mockGet.mockImplementation(makeGetMock());
  const utils = renderHook(() => useImport());
  await waitFor(() => expect(utils.result.current.contentTypes).toHaveLength(1));
  return utils;
}

type HookResult = ReturnType<typeof useImport>;

/** Select a content type and load a CSV file via handleFileChange */
async function loadFile(result: { current: HookResult }) {
  act(() => { result.current.handleUidChange('api::article.article'); });

  let readerInstance: { onload?: (e: { target: { result: string } }) => void; readAsText: jest.Mock };
  global.FileReader = jest.fn(function (this: typeof readerInstance) {
    readerInstance = this;
    this.readAsText = jest.fn(() => {
      Promise.resolve().then(() => {
        readerInstance.onload?.({ target: { result: 'title,body\nHello,World\nFoo,Bar' } });
      });
    });
  }) as unknown as typeof FileReader;

  await act(async () => {
    result.current.handleFileChange({
      target: { files: [new File(['title,body\nHello,World\nFoo,Bar'], 'test.csv')] },
    } as unknown as React.ChangeEvent<HTMLInputElement>);
    await Promise.resolve();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

afterEach(() => jest.clearAllMocks());

describe('initial state', () => {
  it('loads content types and history on mount', async () => {
    const { result } = await setupHook();
    expect(result.current.contentTypes).toHaveLength(1);
    expect(result.current.contentTypes[0].uid).toBe('api::article.article');
    expect(result.current.history).toEqual([]);
  });

  it('starts with no error, no result, loading=false', async () => {
    const { result } = await setupHook();
    expect(result.current.error).toBeNull();
    expect(result.current.importResult).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('sets error when content types fetch fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/data-importer/content-types') return Promise.reject(new Error('Network error'));
      return Promise.resolve({ data: { data: [] } });
    });
    const { result } = renderHook(() => useImport());
    await waitFor(() => expect(result.current.error).toMatch(/Network error/));
  });
});

describe('handleUidChange', () => {
  it('sets selectedUid', async () => {
    const { result } = await setupHook();
    act(() => { result.current.handleUidChange('api::article.article'); });
    expect(result.current.selectedUid).toBe('api::article.article');
  });

  it('exposes selectedContentType after uid is set', async () => {
    const { result } = await setupHook();
    act(() => { result.current.handleUidChange('api::article.article'); });
    expect(result.current.selectedContentType?.displayName).toBe('Article');
  });
});

describe('handleReset', () => {
  it('clears csvHeaders, csvRows and importResult', async () => {
    const { result } = await setupHook();
    await loadFile(result);
    expect(result.current.csvHeaders).toHaveLength(2);

    act(() => { result.current.handleReset(); });

    expect(result.current.csvHeaders).toHaveLength(0);
    expect(result.current.csvRows).toHaveLength(0);
    expect(result.current.importResult).toBeNull();
  });

  it('resets dryRun, rollbackOnFailure, importMode, batchSize to defaults', async () => {
    const { result } = await setupHook();
    act(() => {
      result.current.setDryRun(true);
      result.current.setRollbackOnFailure(true);
      result.current.setImportMode('upsert');
      result.current.setBatchSize(10);
    });
    act(() => { result.current.handleReset(); });

    expect(result.current.dryRun).toBe(false);
    expect(result.current.rollbackOnFailure).toBe(false);
    expect(result.current.importMode).toBe('create');
    expect(result.current.batchSize).toBe(100);
  });
});

describe('clearFileState', () => {
  it('clears only file-related state, preserving other settings', async () => {
    const { result } = await setupHook();
    await loadFile(result);
    act(() => { result.current.setDryRun(true); });

    act(() => { result.current.clearFileState(); });

    expect(result.current.csvHeaders).toHaveLength(0);
    expect(result.current.csvRows).toHaveLength(0);
    expect(result.current.dryRun).toBe(true); // preserved
  });
});

describe('handleFileChange', () => {
  it('sets headers, rows and auto-maps matching fields', async () => {
    const { result } = await setupHook();
    await loadFile(result);

    expect(result.current.csvHeaders).toEqual(['title', 'body']);
    expect(result.current.csvRows).toHaveLength(2);
    expect(result.current.fieldMapping['title']).toBe('title'); // auto-mapped
  });
});

describe('handleMappingChange', () => {
  it('updates fieldMapping for a column', async () => {
    const { result } = await setupHook();
    await loadFile(result);

    act(() => { result.current.handleMappingChange('title', 'body'); });
    expect(result.current.fieldMapping['title']).toBe('body');
  });
});

describe('handleImport — validation', () => {
  it('sets error when same Strapi field is mapped to multiple columns', async () => {
    const { result } = await setupHook();
    await loadFile(result);
    act(() => {
      result.current.handleMappingChange('title', 'body'); // both title+body → body
    });

    await act(async () => { await result.current.handleImport(); });

    expect(result.current.error).toMatch(/mapped more than once/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sets error in upsert mode when no unique field exists', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/data-importer/content-types')
        return Promise.resolve({
          data: {
            data: [{
              uid: 'api::article.article',
              displayName: 'Article',
              fields: [{ name: 'title', type: 'string' }], // no unique
            }],
          },
        });
      return Promise.resolve({ data: { data: [] } });
    });
    const { result } = renderHook(() => useImport());
    await waitFor(() => expect(result.current.contentTypes).toHaveLength(1));
    await loadFile(result);
    act(() => { result.current.setImportMode('upsert'); });

    await act(async () => { await result.current.handleImport(); });

    expect(result.current.error).toMatch(/at least one unique field/);
  });

  it('sets error in upsert mode when no key field is selected', async () => {
    const { result } = await setupHook();
    await loadFile(result);
    act(() => { result.current.setImportMode('upsert'); });
    // keyField remains ''

    await act(async () => { await result.current.handleImport(); });

    expect(result.current.error).toMatch(/requires selecting a key field/);
  });

  it('sets error in upsert mode when key field is not mapped', async () => {
    const { result } = await setupHook();
    await loadFile(result);
    act(() => {
      result.current.setImportMode('upsert');
      result.current.setKeyField('title');
      result.current.handleMappingChange('title', ''); // unmap title
    });

    await act(async () => { await result.current.handleImport(); });

    expect(result.current.error).toMatch(/not mapped to any input column/);
  });
});

describe('handleImport — success', () => {
  it('posts correct payload and sets importResult', async () => {
    mockPost.mockResolvedValue({
      data: { data: { success: 2, updated: 0, failed: 0, errors: [], failedRows: [], completed: true } },
    });
    const { result } = await setupHook();
    await loadFile(result);

    await act(async () => { await result.current.handleImport(); });

    expect(mockPost).toHaveBeenCalledWith('/data-importer/import', expect.objectContaining({
      uid: 'api::article.article',
      rows: expect.any(Array),
      fieldMapping: expect.any(Object),
      dryRun: false,
    }));
    expect(result.current.importResult?.success).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it('refreshes history after import', async () => {
    mockPost.mockResolvedValue({
      data: { data: { success: 1, updated: 0, failed: 0, errors: [], failedRows: [], completed: true } },
    });
    const historyEntry = { id: '1', timestamp: new Date().toISOString(), uid: 'api::article.article', displayName: 'Article', dryRun: false, mode: 'create', success: 1, updated: 0, failed: 0, totalRows: 2 };
    mockGet.mockImplementation(makeGetMock([historyEntry]));

    const { result } = renderHook(() => useImport());
    await waitFor(() => expect(result.current.contentTypes).toHaveLength(1));
    await loadFile(result);

    await act(async () => { await result.current.handleImport(); });

    await waitFor(() => expect(result.current.history).toHaveLength(1));
  });

  it('stops processing chunks when rollbackApplied is true', async () => {
    mockPost.mockResolvedValue({
      data: { data: { success: 0, updated: 0, failed: 1, errors: ['err'], failedRows: [], rollbackApplied: true } },
    });
    const { result } = await setupHook();
    await loadFile(result);
    act(() => { result.current.setBatchSize(1); }); // 2 rows → 2 chunks

    await act(async () => { await result.current.handleImport(); });

    expect(mockPost).toHaveBeenCalledTimes(1); // stopped after first chunk
  });
});

describe('handleImport — error', () => {
  it('sets error message when API throws', async () => {
    mockPost.mockRejectedValue(new Error('Server error'));
    const { result } = await setupHook();
    await loadFile(result);

    await act(async () => { await result.current.handleImport(); });

    expect(result.current.error).toMatch(/Server error/);
    expect(result.current.loading).toBe(false);
  });
});
