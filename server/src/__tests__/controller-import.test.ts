import importControllerFactory from '../controllers/import';

// ────────────────────────────
// モックヘルパー
// ────────────────────────────
function buildCtx(body: any = {}) {
  return {
    request: { body },
    body: undefined as any,
    badRequest: jest.fn((msg: string) => msg),
  };
}

function buildStrapi(serviceOverrides: Record<string, jest.Mock> = {}) {
  const defaultService = {
    getMappings: jest.fn().mockResolvedValue({}),
    getContentTypes: jest.fn().mockResolvedValue([]),
    getHistory: jest.fn().mockResolvedValue([]),
    importRecords: jest.fn().mockResolvedValue({ success: 0, updated: 0, failed: 0, errors: [], failedRows: [] }),
    ...serviceOverrides,
  };

  return {
    plugin: jest.fn().mockReturnValue({
      service: jest.fn().mockReturnValue(defaultService),
    }),
  };
}

// ────────────────────────────
// getMappings
// ────────────────────────────
describe('importController.getMappings()', () => {
  test('サービスの結果を ctx.body にセットする', async () => {
    const mockData = { 'api::test.test': { '名前': 'hoge' } };
    const strapi = buildStrapi({ getMappings: jest.fn().mockResolvedValue(mockData) });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx();
    await controller.getMappings(ctx);

    expect(ctx.body).toEqual({ data: mockData });
  });

  test('マッピングが存在しない場合は空オブジェクトを返す', async () => {
    const strapi = buildStrapi({ getMappings: jest.fn().mockResolvedValue({}) });
    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx();
    await controller.getMappings(ctx);

    expect(ctx.body).toEqual({ data: {} });
  });
});

// ────────────────────────────
// getContentTypes
// ────────────────────────────
describe('importController.getContentTypes()', () => {
  test('サービスの結果を ctx.body にセットする', async () => {
    const mockData = [{ uid: 'api::article.article', displayName: 'Article', fields: [] }];
    const strapi = buildStrapi({
      getContentTypes: jest.fn().mockResolvedValue(mockData),
    });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx();
    await controller.getContentTypes(ctx);

    expect(ctx.body).toEqual({ data: mockData });
  });

  test('サービスが空配列を返す場合も正常にレスポンスする', async () => {
    const strapi = buildStrapi({ getContentTypes: jest.fn().mockResolvedValue([]) });
    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx();
    await controller.getContentTypes(ctx);

    expect(ctx.body).toEqual({ data: [] });
  });
});

// ────────────────────────────
// importRecords
// ────────────────────────────
describe('importController.importRecords()', () => {
  const validBody = {
    uid: 'api::article.article',
    rows: [{ col_title: 'Hello' }],
    fieldMapping: { col_title: 'title' },
  };

  test('正常リクエストでサービスを呼び出し結果を返す', async () => {
    const importResult = { success: 1, updated: 0, failed: 0, errors: [], failedRows: [] };
    const strapi = buildStrapi({
      importRecords: jest.fn().mockResolvedValue(importResult),
    });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx(validBody);
    await controller.importRecords(ctx);

    expect(ctx.body).toEqual({ data: importResult });
  });

  test('uid が欠けている場合は badRequest を返す', async () => {
    const strapi = buildStrapi();
    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx({ rows: [], fieldMapping: {} });
    await controller.importRecords(ctx);

    expect(ctx.badRequest).toHaveBeenCalled();
  });

  test('rows が配列でない場合は badRequest を返す', async () => {
    const strapi = buildStrapi();
    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx({ uid: 'api::article.article', rows: 'not-array', fieldMapping: {} });
    await controller.importRecords(ctx);

    expect(ctx.badRequest).toHaveBeenCalled();
  });

  test('fieldMapping が欠けている場合は badRequest を返す', async () => {
    const strapi = buildStrapi();
    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx({ uid: 'api::article.article', rows: [] });
    await controller.importRecords(ctx);

    expect(ctx.badRequest).toHaveBeenCalled();
  });

  test('rows が空配列でも正常に処理する', async () => {
    const importResult = { success: 0, failed: 0, errors: [], failedRows: [] };
    const strapi = buildStrapi({
      importRecords: jest.fn().mockResolvedValue(importResult),
    });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx({ uid: 'api::article.article', rows: [], fieldMapping: {} });
    await controller.importRecords(ctx);

    expect(ctx.body).toEqual({ data: importResult });
  });

  test('サービスに正しい引数を渡す (dryRun/batchOffset/importMode のデフォルト値含む)', async () => {
    const importRecordsMock = jest.fn().mockResolvedValue({ success: 1, updated: 0, failed: 0, errors: [], failedRows: [] });
    const strapi = buildStrapi({ importRecords: importRecordsMock });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx(validBody);
    await controller.importRecords(ctx);

    expect(importRecordsMock).toHaveBeenCalledWith(
      validBody.uid,
      validBody.rows,
      validBody.fieldMapping,
      false,
      0,
      'create',
      undefined
    );
  });

  test('dryRun: true がサービスに渡る', async () => {
    const importRecordsMock = jest.fn().mockResolvedValue({ success: 1, updated: 0, failed: 0, errors: [], failedRows: [] });
    const strapi = buildStrapi({ importRecords: importRecordsMock });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx({ ...validBody, dryRun: true });
    await controller.importRecords(ctx);

    expect(importRecordsMock).toHaveBeenCalledWith(
      validBody.uid,
      validBody.rows,
      validBody.fieldMapping,
      true,
      0,
      'create',
      undefined
    );
  });

  test('batchOffset: 100 がサービスに渡る', async () => {
    const importRecordsMock = jest.fn().mockResolvedValue({ success: 1, updated: 0, failed: 0, errors: [], failedRows: [] });
    const strapi = buildStrapi({ importRecords: importRecordsMock });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx({ ...validBody, batchOffset: 100 });
    await controller.importRecords(ctx);

    expect(importRecordsMock).toHaveBeenCalledWith(
      validBody.uid,
      validBody.rows,
      validBody.fieldMapping,
      false,
      100,
      'create',
      undefined
    );
  });

  test('importMode: upsert と keyField がサービスに渡る', async () => {
    const importRecordsMock = jest.fn().mockResolvedValue({ success: 0, updated: 1, failed: 0, errors: [], failedRows: [] });
    const strapi = buildStrapi({ importRecords: importRecordsMock });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx({ ...validBody, importMode: 'upsert', keyField: 'col_title' });
    await controller.importRecords(ctx);

    expect(importRecordsMock).toHaveBeenCalledWith(
      validBody.uid,
      validBody.rows,
      validBody.fieldMapping,
      false,
      0,
      'upsert',
      'col_title'
    );
  });

  test('failedRows が ctx.body に含まれる', async () => {
    const failedRow = { col_title: 'B' };
    const importResult = {
      success: 1,
      updated: 0,
      failed: 1,
      errors: ['Row 3: DB error'],
      failedRows: [failedRow],
    };
    const strapi = buildStrapi({
      importRecords: jest.fn().mockResolvedValue(importResult),
    });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx(validBody);
    await controller.importRecords(ctx);

    expect(ctx.body).toEqual({ data: importResult });
    expect(ctx.body.data.failedRows).toEqual([failedRow]);
  });

  test('サービスが部分失敗を返した場合もそのまま ctx.body にセットする', async () => {
    const importResult = {
      success: 2,
      updated: 0,
      failed: 1,
      errors: ['Row 3: Something went wrong'],
      failedRows: [{ col_title: 'B' }],
    };
    const strapi = buildStrapi({
      importRecords: jest.fn().mockResolvedValue(importResult),
    });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx(validBody);
    await controller.importRecords(ctx);

    expect(ctx.body).toEqual({ data: importResult });
  });
});

// ────────────────────────────
// getHistory
// ────────────────────────────
describe('importController.getHistory()', () => {
  test('サービスの履歴を ctx.body にセットする', async () => {
    const mockHistory = [
      { id: '1', timestamp: '2024-01-01T00:00:00.000Z', uid: 'api::test.test', displayName: 'Test', dryRun: false, mode: 'create', success: 5, updated: 0, failed: 0, totalRows: 5 },
    ];
    const strapi = buildStrapi({ getHistory: jest.fn().mockResolvedValue(mockHistory) });

    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx();
    await controller.getHistory(ctx);

    expect(ctx.body).toEqual({ data: mockHistory });
  });

  test('履歴が空の場合は空配列を返す', async () => {
    const strapi = buildStrapi({ getHistory: jest.fn().mockResolvedValue([]) });
    const controller = importControllerFactory({ strapi });
    const ctx = buildCtx();
    await controller.getHistory(ctx);

    expect(ctx.body).toEqual({ data: [] });
  });
});
