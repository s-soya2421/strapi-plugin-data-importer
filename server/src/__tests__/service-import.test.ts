import fs from 'fs';
import importServiceFactory from '../services/import';

jest.mock('fs');

// ────────────────────────────
// Strapi モックヘルパー
// ────────────────────────────
function buildStrapi(contentTypes: Record<string, any>, createFn?: jest.Mock, extraDocMethods: Record<string, jest.Mock> = {}) {
  return {
    contentTypes,
    documents: jest.fn().mockReturnValue({
      create: createFn ?? jest.fn().mockResolvedValue({ documentId: 'doc-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ documentId: 'doc-1' }),
      ...extraDocMethods,
    }),
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

function buildContentType(attributes: Record<string, any>, displayName = 'Test') {
  return { info: { displayName }, attributes };
}

// ────────────────────────────
// getMappings
// ────────────────────────────
describe('importService.getMappings()', () => {
  test('マッピングファイルが存在する場合はパースして返す', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(
      JSON.stringify({ 'api::test.test': { '名前': 'hoge' } })
    );
    const service = importServiceFactory({ strapi: buildStrapi({}) });
    const result = await service.getMappings();
    expect(result).toEqual({ 'api::test.test': { '名前': 'hoge' } });
  });

  test('ファイルが存在しない場合は空オブジェクトを返す', async () => {
    (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
    const service = importServiceFactory({ strapi: buildStrapi({}) });
    const result = await service.getMappings();
    expect(result).toEqual({});
  });

  test('JSONが不正な場合は空オブジェクトを返す', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('invalid json {{{');
    const service = importServiceFactory({ strapi: buildStrapi({}) });
    const result = await service.getMappings();
    expect(result).toEqual({});
  });
});

// ────────────────────────────
// getContentTypes
// ────────────────────────────
describe('importService.getContentTypes()', () => {
  test('api:: プレフィックスのコンテンツタイプのみ返す', async () => {
    const strapi = buildStrapi({
      'api::article.article': buildContentType({ title: { type: 'string' } }, 'Article'),
      'plugin::users-permissions.user': buildContentType({ username: { type: 'string' } }),
      'admin::permission': buildContentType({ action: { type: 'string' } }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('api::article.article');
    expect(result[0].displayName).toBe('Article');
  });

  test('component / dynamiczone フィールドのみ除外する（relation/media は含む）', async () => {
    const strapi = buildStrapi({
      'api::post.post': buildContentType({
        title: { type: 'string' },
        author: { type: 'relation', relationType: 'manyToOne' },
        cover: { type: 'media', multiple: false },
        sections: { type: 'dynamiczone' },
        seo: { type: 'component' },
        body: { type: 'richtext' },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const fields = result[0].fields.map((f: any) => f.name);
    expect(fields).toContain('title');
    expect(fields).toContain('body');
    expect(fields).toContain('author');
    expect(fields).toContain('cover');
    expect(fields).not.toContain('sections');
    expect(fields).not.toContain('seo');
  });

  test('relation フィールドに relationType が付与される', async () => {
    const strapi = buildStrapi({
      'api::post.post': buildContentType({
        author: { type: 'relation', relationType: 'manyToOne' },
        tags: { type: 'relation', relationType: 'manyToMany' },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const authorField = result[0].fields.find((f: any) => f.name === 'author');
    const tagsField = result[0].fields.find((f: any) => f.name === 'tags');
    expect(authorField?.relationType).toBe('manyToOne');
    expect(tagsField?.relationType).toBe('manyToMany');
  });

  test('media フィールドに multiple が付与される', async () => {
    const strapi = buildStrapi({
      'api::post.post': buildContentType({
        cover: { type: 'media', multiple: false },
        gallery: { type: 'media', multiple: true },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const coverField = result[0].fields.find((f: any) => f.name === 'cover');
    const galleryField = result[0].fields.find((f: any) => f.name === 'gallery');
    expect(coverField?.multiple).toBe(false);
    expect(galleryField?.multiple).toBe(true);
  });

  test('date / datetime / time フィールドを含む', async () => {
    const strapi = buildStrapi({
      'api::event.event': buildContentType({
        name: { type: 'string' },
        startDate: { type: 'date' },
        startTime: { type: 'time' },
        createdAt: { type: 'datetime' },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const fields = result[0].fields.map((f: any) => f.name);
    expect(fields).toContain('name');
    expect(fields).toContain('startDate');
    expect(fields).toContain('startTime');
    expect(fields).toContain('createdAt');
  });

  test('info.displayName がない場合は uid をフォールバックとして使う', async () => {
    const strapi = buildStrapi({
      'api::thing.thing': { attributes: { name: { type: 'string' } } },
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    expect(result[0].displayName).toBe('api::thing.thing');
  });

  test('コンテンツタイプが存在しない場合は空配列を返す', async () => {
    const strapi = buildStrapi({});
    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    expect(result).toEqual([]);
  });
});

// ────────────────────────────
// importRecords
// ────────────────────────────
describe('importService.importRecords()', () => {
  const uid = 'api::article.article';

  const attributes = {
    title: { type: 'string' },
    score: { type: 'integer' },
    price: { type: 'decimal' },
    published: { type: 'boolean' },
    views: { type: 'biginteger' },
    ratio: { type: 'float' },
  };

  // ──────────────────────────
  // 型変換
  // ──────────────────────────
  describe('フィールド型変換', () => {
    test('integer フィールドを parseInt で変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_score: '42' }], { col_score: 'score' });

      expect(createFn).toHaveBeenCalledWith({ data: { score: 42 } });
    });

    test('biginteger フィールドを parseInt で変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_views: '9999999' }], { col_views: 'views' });

      expect(createFn).toHaveBeenCalledWith({ data: { views: 9999999 } });
    });

    test('decimal フィールドを parseFloat で変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_price: '9.99' }], { col_price: 'price' });

      expect(createFn).toHaveBeenCalledWith({ data: { price: 9.99 } });
    });

    test('float フィールドを parseFloat で変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_ratio: '0.75' }], { col_ratio: 'ratio' });

      expect(createFn).toHaveBeenCalledWith({ data: { ratio: 0.75 } });
    });

    test('boolean "true" → true に変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_pub: 'true' }], { col_pub: 'published' });

      expect(createFn).toHaveBeenCalledWith({ data: { published: true } });
    });

    test('boolean "1" → true に変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_pub: '1' }], { col_pub: 'published' });

      expect(createFn).toHaveBeenCalledWith({ data: { published: true } });
    });

    test('boolean "false" → false に変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_pub: 'false' }], { col_pub: 'published' });

      expect(createFn).toHaveBeenCalledWith({ data: { published: false } });
    });

    test('string フィールドはそのままの値を渡す', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_title: 'Hello World' }], { col_title: 'title' });

      expect(createFn).toHaveBeenCalledWith({ data: { title: 'Hello World' } });
    });

    test('relation フィールドをカンマ区切り documentId から connect 形式に変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({
          ...attributes,
          author: { type: 'relation', relationType: 'manyToOne' },
          tags: { type: 'relation', relationType: 'manyToMany' },
        }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_author: 'abc123', col_tags: 'id1, id2, id3' }],
        { col_author: 'author', col_tags: 'tags' }
      );

      expect(createFn).toHaveBeenCalledWith({
        data: {
          author: { connect: [{ documentId: 'abc123' }] },
          tags: { connect: [{ documentId: 'id1' }, { documentId: 'id2' }, { documentId: 'id3' }] },
        },
      });
    });

    test('media フィールドをカンマ区切り数値 ID から connect 形式に変換する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({
          ...attributes,
          cover: { type: 'media', multiple: false },
        }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_cover: '10, 20' }],
        { col_cover: 'cover' }
      );

      expect(createFn).toHaveBeenCalledWith({
        data: {
          cover: { connect: [{ id: 10 }, { id: 20 }] },
        },
      });
    });

    test('media フィールドで非数値はフィルタリングされる', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({
          ...attributes,
          cover: { type: 'media', multiple: false },
        }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_cover: '10, abc, 20' }],
        { col_cover: 'cover' }
      );

      expect(createFn).toHaveBeenCalledWith({
        data: {
          cover: { connect: [{ id: 10 }, { id: 20 }] },
        },
      });
    });

    test('date フィールドはマッピングがある場合そのまま値を渡す', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({
          ...attributes,
          pubDate: { type: 'date' },
        }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_date: '2025-01-15' }],
        { col_date: 'pubDate' }
      );

      expect(createFn).toHaveBeenCalledWith({
        data: { pubDate: '2025-01-15' },
      });
    });
  });

  // ──────────────────────────
  // 日付フィールドの自動補完
  // ──────────────────────────
  describe('日付フィールドの自動補完', () => {
    const fakeNow = new Date('2024-03-15T10:30:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(fakeNow);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('date フィールドを YYYY-MM-DD 形式の現在日付で補完する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({ title: { type: 'string' }, pubDate: { type: 'date' } }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_title: 'Hello' }], { col_title: 'title' });

      expect(createFn).toHaveBeenCalledWith({
        data: { title: 'Hello', pubDate: '2024-03-15' },
      });
    });

    test('datetime フィールドを ISO 形式の現在日時で補完する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({ title: { type: 'string' }, createdAt: { type: 'datetime' } }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_title: 'Hello' }], { col_title: 'title' });

      expect(createFn).toHaveBeenCalledWith({
        data: { title: 'Hello', createdAt: fakeNow.toISOString() },
      });
    });

    test('time フィールドを HH:MM:SS 形式の現在時刻で補完する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({ title: { type: 'string' }, startTime: { type: 'time' } }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_title: 'Hello' }], { col_title: 'title' });

      const call = createFn.mock.calls[0][0];
      expect(call.data.title).toBe('Hello');
      expect(call.data.startTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    test('マッピング済みの date フィールドは自動補完しない', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({ title: { type: 'string' }, pubDate: { type: 'date' } }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_title: 'Hello', col_date: '2025-06-01' }],
        { col_title: 'title', col_date: 'pubDate' }
      );

      expect(createFn).toHaveBeenCalledWith({
        data: { title: 'Hello', pubDate: '2025-06-01' },
      });
    });
  });

  // ──────────────────────────
  // dryRun
  // ──────────────────────────
  describe('dryRun モード', () => {
    test('dryRun=true の場合 create が呼ばれない', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'Hello' }, { col_title: 'World' }],
        { col_title: 'title' },
        true
      );

      expect(createFn).not.toHaveBeenCalled();
      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
    });

    test('dryRun=false (デフォルト) の場合 create が呼ばれる', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_title: 'Hello' }], { col_title: 'title' });

      expect(createFn).toHaveBeenCalled();
    });
  });

  // ──────────────────────────
  // batchOffset
  // ──────────────────────────
  describe('batchOffset', () => {
    test('batchOffset がエラー行番号に反映される', async () => {
      const createFn = jest.fn().mockRejectedValue(new Error('DB error'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'A' }, { col_title: 'B' }],
        { col_title: 'title' },
        false,
        100
      );

      expect(result.errors[0]).toMatch(/Row 102/);
      expect(result.errors[1]).toMatch(/Row 103/);
    });

    test('batchOffset=0 (デフォルト) の場合は Row 2 から始まる', async () => {
      const createFn = jest.fn().mockRejectedValue(new Error('DB error'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'A' }],
        { col_title: 'title' }
      );

      expect(result.errors[0]).toMatch(/Row 2/);
    });
  });

  // ──────────────────────────
  // failedRows
  // ──────────────────────────
  describe('failedRows', () => {
    test('失敗した行の元データが failedRows に含まれる', async () => {
      const createFn = jest.fn()
        .mockResolvedValueOnce({ documentId: 'doc-1' })
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ documentId: 'doc-3' });

      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const rows = [
        { col_title: 'A' },
        { col_title: 'B' },
        { col_title: 'C' },
      ];
      const result = await service.importRecords(uid, rows, { col_title: 'title' });

      expect(result.failedRows).toHaveLength(1);
      expect(result.failedRows[0]).toEqual({ col_title: 'B' });
    });

    test('全行成功の場合 failedRows は空配列', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_title: 'A' }], { col_title: 'title' });

      expect(result.failedRows).toEqual([]);
    });
  });

  // ──────────────────────────
  // スキップロジック
  // ──────────────────────────
  describe('スキップロジック', () => {
    test('空文字列の値はフィールドに含めない', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_title: 'Hello', col_score: '' }],
        { col_title: 'title', col_score: 'score' }
      );

      expect(createFn.mock.calls[0][0].data).not.toHaveProperty('score');
    });

    test('マッピング先が空 ("") のカラムはスキップする', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_title: 'Hello', col_skip: 'ignored' }],
        { col_title: 'title', col_skip: '' }
      );

      expect(createFn.mock.calls[0][0].data).not.toHaveProperty('col_skip');
    });

    test('存在しない Strapi フィールドへのマッピングはスキップする', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_title: 'Hello', col_unknown: 'value' }],
        { col_title: 'title', col_unknown: 'nonExistentField' }
      );

      expect(createFn.mock.calls[0][0].data).not.toHaveProperty('nonExistentField');
    });
  });

  // ──────────────────────────
  // 成功・失敗カウント
  // ──────────────────────────
  describe('成功・失敗カウント', () => {
    test('全行成功した場合 success に件数が入る', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const rows = [{ col_title: 'A' }, { col_title: 'B' }, { col_title: 'C' }];
      const result = await service.importRecords(uid, rows, { col_title: 'title' });

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test('documents().create が失敗した行を failed としてカウントしエラーメッセージを記録する', async () => {
      const createFn = jest.fn()
        .mockResolvedValueOnce({ documentId: 'doc-1' })
        .mockRejectedValueOnce(new Error('DB constraint error'))
        .mockResolvedValueOnce({ documentId: 'doc-3' });

      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const rows = [{ col_title: 'A' }, { col_title: 'B' }, { col_title: 'C' }];
      const result = await service.importRecords(uid, rows, { col_title: 'title' });

      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/Row 3/);
      expect(result.errors[0]).toMatch(/DB constraint error/);
    });

    test('全行失敗した場合 failed に総件数が入る', async () => {
      const createFn = jest.fn().mockRejectedValue(new Error('Connection lost'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const rows = [{ col_title: 'A' }, { col_title: 'B' }];
      const result = await service.importRecords(uid, rows, { col_title: 'title' });

      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    test('message プロパティのないエラーオブジェクトは String() でシリアライズする', async () => {
      const createFn = jest.fn().mockRejectedValue({ code: 'ER_DUP_ENTRY' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_title: 'X' }], { col_title: 'title' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain('Row 2:');
    });

    test('バリデーションエラーの details を展開してメッセージに含める', async () => {
      const validationError = Object.assign(new Error('2 errors occurred'), {
        details: {
          errors: [
            { path: ['title'], message: 'must not be empty' },
            { path: ['score'], message: 'must be a number' },
          ],
        },
      });
      const createFn = jest.fn().mockRejectedValue(validationError);
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_title: '' }], { col_title: 'title' });

      expect(result.errors[0]).toMatch(/title: must not be empty/);
      expect(result.errors[0]).toMatch(/score: must be a number/);
    });
  });

  // ──────────────────────────
  // エラーケース
  // ──────────────────────────
  describe('エラーケース', () => {
    test('存在しない uid を指定すると例外をスローする', async () => {
      const strapi = buildStrapi({});
      const service = importServiceFactory({ strapi });

      await expect(
        service.importRecords('api::nonexistent.nonexistent', [], {})
      ).rejects.toThrow('Content type api::nonexistent.nonexistent not found');
    });

    test('rows が空配列の場合は create が呼ばれない', async () => {
      const createFn = jest.fn();
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [], { col_title: 'title' });

      expect(createFn).not.toHaveBeenCalled();
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  // ──────────────────────────
  // 複数フィールドのマッピング
  // ──────────────────────────
  describe('複数フィールドのマッピング', () => {
    test('複数カラムを正しくマッピングして create を呼ぶ', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ csv_title: 'My Post', csv_score: '10', csv_pub: 'true' }],
        { csv_title: 'title', csv_score: 'score', csv_pub: 'published' }
      );

      expect(createFn).toHaveBeenCalledWith({
        data: { title: 'My Post', score: 10, published: true },
      });
    });
  });

  // ──────────────────────────
  // upsert モード
  // ──────────────────────────
  describe('upsert モード', () => {
    test('既存レコードが見つかった場合は update を呼び updated をカウントする', async () => {
      const findManyFn = jest.fn().mockResolvedValue([{ documentId: 'existing-doc' }]);
      const updateFn = jest.fn().mockResolvedValue({ documentId: 'existing-doc' });
      const createFn = jest.fn();
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
        update: updateFn,
      });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'Hello' }],
        { col_title: 'title' },
        false,
        0,
        'upsert',
        'title'
      );

      expect(createFn).not.toHaveBeenCalled();
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'existing-doc' })
      );
      expect(result.updated).toBe(1);
      expect(result.success).toBe(0);
    });

    test('既存レコードが見つからない場合は create を呼び success をカウントする', async () => {
      const findManyFn = jest.fn().mockResolvedValue([]);
      const createFn = jest.fn().mockResolvedValue({ documentId: 'new-doc' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
      });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'New' }],
        { col_title: 'title' },
        false,
        0,
        'upsert',
        'title'
      );

      expect(createFn).toHaveBeenCalled();
      expect(result.success).toBe(1);
      expect(result.updated).toBe(0);
    });

    test('keyField が指定されていない場合は通常 create を呼ぶ', async () => {
      const findManyFn = jest.fn();
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
      });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'Hello' }],
        { col_title: 'title' },
        false,
        0,
        'upsert'
        // keyField は未指定
      );

      expect(findManyFn).not.toHaveBeenCalled();
      expect(createFn).toHaveBeenCalled();
      expect(result.success).toBe(1);
    });

    test('importMode=create では findMany を呼ばない', async () => {
      const findManyFn = jest.fn();
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
      });
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_title: 'Hello' }],
        { col_title: 'title' },
        false,
        0,
        'create',
        'title'
      );

      expect(findManyFn).not.toHaveBeenCalled();
    });

    test('戻り値に updated フィールドが含まれる', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_title: 'A' }], { col_title: 'title' });

      expect(result).toHaveProperty('updated');
      expect(result.updated).toBe(0);
    });
  });
});

// ────────────────────────────
// getHistory
// ────────────────────────────
describe('importService.getHistory()', () => {
  test('ファイルが存在しない場合は空配列を返す', async () => {
    (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
    const service = importServiceFactory({ strapi: buildStrapi({}) });
    const result = await service.getHistory();
    expect(result).toEqual([]);
  });

  test('ファイルが存在する場合はエントリーを返す', async () => {
    const entries = [
      { id: '1', timestamp: '2024-01-01T00:00:00.000Z', uid: 'api::test.test', displayName: 'Test', dryRun: false, mode: 'create', success: 5, updated: 0, failed: 0, totalRows: 5 },
    ];
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(entries));
    const service = importServiceFactory({ strapi: buildStrapi({}) });
    const result = await service.getHistory();
    expect(result).toEqual(entries);
  });

  test('ファイルの内容が配列でない場合は空配列を返す', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ foo: 'bar' }));
    const service = importServiceFactory({ strapi: buildStrapi({}) });
    const result = await service.getHistory();
    expect(result).toEqual([]);
  });

  test('不正な JSON の場合は空配列を返す', async () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('invalid json');
    const service = importServiceFactory({ strapi: buildStrapi({}) });
    const result = await service.getHistory();
    expect(result).toEqual([]);
  });
});
