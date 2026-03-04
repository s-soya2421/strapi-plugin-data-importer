/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomePage from '../pages/HomePage';

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
    rows: [
      { title: 'Hello', body: 'World' },
      { title: 'Foo', body: 'Bar' },
    ],
  })),
}));

// URL.createObjectURL is not available in jsdom
global.URL.createObjectURL = jest.fn(() => 'blob:mock');
global.URL.revokeObjectURL = jest.fn();

// ── Test data ──────────────────────────────────────────────────────────────

const mockContentTypes = [
  {
    uid: 'api::article.article',
    displayName: 'Article',
    fields: [
      { name: 'title', type: 'string' },
      { name: 'body', type: 'text' },
    ],
  },
];

const mockContentTypesWithRelationMedia = [
  {
    uid: 'api::post.post',
    displayName: 'Post',
    fields: [
      { name: 'title', type: 'string' },
      { name: 'author', type: 'relation', relationType: 'manyToOne' },
      { name: 'cover', type: 'media', multiple: false },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────

/** Simulate file upload with FileReader mock */
async function simulateFileUpload(content = 'title,body\nHello,World\nFoo,Bar') {
  let readerInstance: any;
  global.FileReader = jest.fn(function (this: any) {
    readerInstance = this;
    this.readAsText = jest.fn(() => {
      Promise.resolve().then(() => {
        readerInstance.onload?.({ target: { result: content } });
      });
    });
  }) as any;

  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([content], 'test.csv', { type: 'text/csv' });
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [file] } });
    await Promise.resolve();
  });
}

/** Select a content type and upload a CSV file */
async function selectContentTypeAndUpload(uid = 'api::article.article') {
  await waitFor(() => {
    expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
  });

  const contentTypeSelect = screen.getAllByRole('combobox')[0];
  fireEvent.change(contentTypeSelect, { target: { value: uid } });

  await simulateFileUpload();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('HomePage', () => {
  beforeEach(() => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/data-importer/content-types') {
        return Promise.resolve({ data: { data: mockContentTypes } });
      }
      if (url === '/data-importer/mappings') {
        return Promise.resolve({ data: { data: {} } });
      }
      if (url === '/data-importer/history') {
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.resolve({ data: { data: null } });
    });
    mockPost.mockResolvedValue({
      data: { data: { success: 2, updated: 0, failed: 0, errors: [], failedRows: [] } },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  test('renders the page title', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Data Importer');
  });

  test('renders Step 1 label and placeholder option', () => {
    render(<HomePage />);
    expect(screen.getByText('Step 1: Select content type')).toBeInTheDocument();
    expect(screen.getByText('-- Select a content type --')).toBeInTheDocument();
  });

  test('Step 2 is not visible before a content type is selected', () => {
    render(<HomePage />);
    expect(screen.queryByText('Step 2: Upload file (CSV or JSON)')).not.toBeInTheDocument();
  });

  // ── Content type loading ─────────────────────────────────────────────────

  test('fetches and displays content types in the dropdown', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });
    expect(mockGet).toHaveBeenCalledWith('/data-importer/content-types');
  });

  test('shows an error message when content type fetch fails', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/data-importer/content-types') {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ data: { data: {} } });
    });

    render(<HomePage />);
    await waitFor(() => {
      expect(
        screen.getByText('Failed to fetch content types: Network error')
      ).toBeInTheDocument();
    });
  });

  // ── Step 1 → Step 2 transition ───────────────────────────────────────────

  test('shows Step 2 and download button after selecting a content type', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    expect(screen.getByText('Step 2: Upload file (CSV or JSON)')).toBeInTheDocument();
    expect(screen.getByText('Download CSV template')).toBeInTheDocument();
  });

  // ── Download template ────────────────────────────────────────────────────

  test('triggers CSV template download when the button is clicked', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    const downloadBtn = screen.getByText('Download CSV template');
    fireEvent.click(downloadBtn);

    expect(global.URL.createObjectURL).toHaveBeenCalled();
  });

  // ── CSV upload → Step 3 / Step 4 ─────────────────────────────────────────

  test('shows Step 3 mapping table and Step 4 import button after CSV upload', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload('title,body\nHello,World');

    await waitFor(() => {
      expect(screen.getByText('Step 3: Map columns to Strapi fields')).toBeInTheDocument();
    });
    expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    expect(screen.getByText('Column')).toBeInTheDocument();
    expect(screen.getByText('Strapi Field')).toBeInTheDocument();
  });

  test('shows row count in the warning after CSV upload', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    // parseCSV mock returns 2 rows
    await waitFor(() => {
      expect(screen.getByText(/2 rows detected/)).toBeInTheDocument();
    });
  });

  // ── Preview table ─────────────────────────────────────────────────────────

  test('shows preview table with first 5 rows after CSV upload', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Preview (first 5 rows):')).toBeInTheDocument();
    });
    // The mock parseCSV returns rows with 'Hello' and 'Foo'
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  // ── Import ────────────────────────────────────────────────────────────────

  test('calls the import API and shows Step 5 results', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload('title,body\nHello,World');

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    // Click the import button
    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Step 5: Results')).toBeInTheDocument();
    });
    expect(screen.getByText('Created: 2 | Updated: 0 | Failed: 0')).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledWith('/data-importer/import', expect.any(Object));
  });

  test('shows import error message when the API call fails', async () => {
    mockPost.mockRejectedValue(new Error('Server error'));

    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload('title,body\nHello,World');

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Import failed: Server error')).toBeInTheDocument();
    });
  });

  // ── dry-run ────────────────────────────────────────────────────────────────

  test('shows dry-run checkbox in Step 4', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    expect(screen.getByText('Dry run (no data will be written)')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
  });

  test('dry-run checkbox can be toggled', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  test('passes dryRun=true to the API when checkbox is checked', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/data-importer/import', expect.objectContaining({ dryRun: true }));
    });
  });

  test('shows (dry run) label in results when dryRun is active', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Step 5: Results')).toBeInTheDocument();
    });
    expect(screen.getByText('(dry run)')).toBeInTheDocument();
  });

  // ── retry failed rows ──────────────────────────────────────────────────────

  test('shows retry button when there are failed rows', async () => {
    mockPost.mockResolvedValue({
      data: { data: { success: 1, failed: 1, errors: ['Row 3: error'], failedRows: [{ title: 'Bad' }] } },
    });

    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Step 5: Results')).toBeInTheDocument();
    });
    expect(screen.getByText(/Retry failed \(1 rows\)/)).toBeInTheDocument();
  });

  test('retry button imports only failed rows', async () => {
    const failedRow = { title: 'Bad' };
    mockPost.mockResolvedValueOnce({
      data: { data: { success: 1, failed: 1, errors: ['Row 3: error'], failedRows: [failedRow] } },
    });
    mockPost.mockResolvedValueOnce({
      data: { data: { success: 1, failed: 0, errors: [], failedRows: [] } },
    });

    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Retry failed/)).toBeInTheDocument();
    });

    const retryBtn = screen.getByText(/Retry failed/);
    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await waitFor(() => {
      // Second call should include only the failed row
      expect(mockPost).toHaveBeenNthCalledWith(2, '/data-importer/import', expect.objectContaining({
        rows: [failedRow],
      }));
    });
  });

  test('no retry button when all rows succeed', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Step 5: Results')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Retry failed/)).not.toBeInTheDocument();
  });

  // ── format note for relation/media ────────────────────────────────────────

  test('shows format note when content type has relation or media fields', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/data-importer/content-types') {
        return Promise.resolve({ data: { data: mockContentTypesWithRelationMedia } });
      }
      if (url === '/data-importer/mappings') {
        return Promise.resolve({ data: { data: {} } });
      }
      if (url === '/data-importer/history') {
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.resolve({ data: { data: null } });
    });

    const { parseCSV } = require('../utils/parseCSV');
    parseCSV.mockReturnValue({
      headers: ['title'],
      rows: [{ title: 'Hello' }],
    });

    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Post (api::post.post)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::post.post' } });

    await simulateFileUpload('title\nHello');

    await waitFor(() => {
      expect(screen.getByText('Step 3: Map columns to Strapi fields')).toBeInTheDocument();
    });

    expect(screen.getByText(
      'Relation fields: enter comma-separated documentIds. Media fields: enter comma-separated numeric file IDs.'
    )).toBeInTheDocument();
  });

  test('does not show format note when no relation or media fields', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 3: Map columns to Strapi fields')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Relation fields:/)).not.toBeInTheDocument();
  });

  // ── field labels for relation/media ───────────────────────────────────────

  test('shows relation type in field option label', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/data-importer/content-types') {
        return Promise.resolve({ data: { data: mockContentTypesWithRelationMedia } });
      }
      if (url === '/data-importer/mappings') {
        return Promise.resolve({ data: { data: {} } });
      }
      if (url === '/data-importer/history') {
        return Promise.resolve({ data: { data: [] } });
      }
      return Promise.resolve({ data: { data: null } });
    });

    const { parseCSV } = require('../utils/parseCSV');
    parseCSV.mockReturnValue({
      headers: ['title'],
      rows: [{ title: 'Hello' }],
    });

    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Post (api::post.post)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::post.post' } });

    await simulateFileUpload('title\nHello');

    await waitFor(() => {
      expect(screen.getByText('Step 3: Map columns to Strapi fields')).toBeInTheDocument();
    });

    // The field select options should show relation type
    expect(screen.getByText('author (relation: manyToOne)')).toBeInTheDocument();
    expect(screen.getByText('cover (media: single ID)')).toBeInTheDocument();
  });

  // ── JSON upload ───────────────────────────────────────────────────────────

  test('shows format radio buttons after selecting a content type', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    expect(screen.getByText('File format:')).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute('value', 'csv');
    expect(radios[1]).toHaveAttribute('value', 'json');
  });

  test('shows mapping table after selecting JSON format and uploading a JSON file', async () => {
    const { parseJSON } = require('../utils/parseJSON');
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    // Switch to JSON format
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]); // JSON radio

    let readerInstance: any;
    global.FileReader = jest.fn(function (this: any) {
      readerInstance = this;
      this.readAsText = jest.fn(() => {
        Promise.resolve().then(() => {
          readerInstance.onload?.({ target: { result: '[{"title":"Hello","body":"World"}]' } });
        });
      });
    }) as any;

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['[{"title":"Hello","body":"World"}]'], 'data.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('Step 3: Map columns to Strapi fields')).toBeInTheDocument();
    });
    expect(parseJSON).toHaveBeenCalled();
  });

  test('calls the import API with JSON data and shows results', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    // Switch to JSON format
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[1]);

    let readerInstance: any;
    global.FileReader = jest.fn(function (this: any) {
      readerInstance = this;
      this.readAsText = jest.fn(() => {
        Promise.resolve().then(() => {
          readerInstance.onload?.({ target: { result: '[{"title":"Hello","body":"World"}]' } });
        });
      });
    }) as any;

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['[{"title":"Hello","body":"World"}]'], 'data.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Step 5: Results')).toBeInTheDocument();
    });
    expect(screen.getByText('Created: 2 | Updated: 0 | Failed: 0')).toBeInTheDocument();
    expect(mockPost).toHaveBeenCalledWith('/data-importer/import', expect.any(Object));
  });

  // ── Reset ─────────────────────────────────────────────────────────────────

  test('reset button hides Steps 3–5 and clears CSV state', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload('title,body\nHello,World');

    await waitFor(() => {
      expect(screen.getByText('Step 3: Map columns to Strapi fields')).toBeInTheDocument();
    });

    // Click Reset
    const resetBtn = screen.getByText('Reset');
    fireEvent.click(resetBtn);

    expect(screen.queryByText('Step 3: Map columns to Strapi fields')).not.toBeInTheDocument();
    expect(screen.queryByText('Step 4: Run import')).not.toBeInTheDocument();
  });

  // ── Upsert UI ─────────────────────────────────────────────────────────────

  test('shows import mode radio buttons after file upload', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Import mode:')).toBeInTheDocument();
    });
    expect(screen.getByText('Create only')).toBeInTheDocument();
    expect(screen.getByText('Upsert (create or update)')).toBeInTheDocument();
  });

  test('key field dropdown is hidden when create mode is selected', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Import mode:')).toBeInTheDocument();
    });

    expect(screen.queryByText('Key field:')).not.toBeInTheDocument();
  });

  test('key field dropdown appears when upsert mode is selected', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Import mode:')).toBeInTheDocument();
    });

    // Switch to upsert mode
    const upsertRadio = screen.getByDisplayValue('upsert');
    fireEvent.click(upsertRadio);

    expect(screen.getByText('Key field:')).toBeInTheDocument();
    expect(screen.getByText('-- Select key field --')).toBeInTheDocument();
  });

  test('passes importMode and keyField to the API', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    // Switch to upsert
    const upsertRadio = screen.getByDisplayValue('upsert');
    fireEvent.click(upsertRadio);

    // Select key field
    const keyFieldSelect = screen.getAllByRole('combobox').find(
      (el) => el.getAttribute('value') === '' && el.querySelector('option[value="title"]')
    ) ?? screen.getAllByRole('combobox')[screen.getAllByRole('combobox').length - 1];
    fireEvent.change(keyFieldSelect, { target: { value: 'title' } });

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/data-importer/import', expect.objectContaining({
        importMode: 'upsert',
        keyField: 'title',
      }));
    });
  });

  test('shows updated count in results', async () => {
    mockPost.mockResolvedValue({
      data: { data: { success: 1, updated: 2, failed: 0, errors: [], failedRows: [] } },
    });

    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Article (api::article.article)')).toBeInTheDocument();
    });

    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'api::article.article' } });

    await simulateFileUpload();

    await waitFor(() => {
      expect(screen.getByText('Step 4: Run import')).toBeInTheDocument();
    });

    const importBtn = screen.getByText(/Import \d+ records/);
    await act(async () => {
      fireEvent.click(importBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Created: 1 | Updated: 2 | Failed: 0')).toBeInTheDocument();
    });
  });

  // ── Import history ────────────────────────────────────────────────────────

  test('shows empty history message when no history', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText('Import history')).toBeInTheDocument();
    });
    expect(screen.getByText('No import history yet.')).toBeInTheDocument();
  });

  test('shows history table when history entries exist', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/data-importer/content-types') {
        return Promise.resolve({ data: { data: mockContentTypes } });
      }
      if (url === '/data-importer/mappings') {
        return Promise.resolve({ data: { data: {} } });
      }
      if (url === '/data-importer/history') {
        return Promise.resolve({
          data: {
            data: [
              { id: '1', timestamp: '2024-01-15T10:30:00.000Z', uid: 'api::article.article', displayName: 'Article', dryRun: false, mode: 'create', success: 5, updated: 0, failed: 1, totalRows: 6 },
            ],
          },
        });
      }
      return Promise.resolve({ data: { data: null } });
    });

    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('Import history')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText('No import history yet.')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Date/Time')).toBeInTheDocument();
    expect(screen.getByText('Content Type')).toBeInTheDocument();
    expect(screen.getByText('Mode')).toBeInTheDocument();
  });

  test('history section calls GET /data-importer/history on mount', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/data-importer/history');
    });
  });
});
