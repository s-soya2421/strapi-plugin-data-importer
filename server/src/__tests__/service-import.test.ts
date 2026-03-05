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
      delete: jest.fn().mockResolvedValue({}),
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
        eventAt: { type: 'datetime' },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const fields = result[0].fields.map((f: any) => f.name);
    expect(fields).toContain('name');
    expect(fields).toContain('startDate');
    expect(fields).toContain('startTime');
    expect(fields).toContain('eventAt');
  });

  test('システムフィールドは除外される', async () => {
    const strapi = buildStrapi({
      'api::post.post': buildContentType({
        title: { type: 'string' },
        createdAt: { type: 'datetime' },
        updatedAt: { type: 'datetime' },
        publishedAt: { type: 'datetime' },
        createdBy: { type: 'relation', relationType: 'oneToOne' },
        updatedBy: { type: 'relation', relationType: 'oneToOne' },
        locale: { type: 'string' },
        localizations: { type: 'relation', relationType: 'oneToMany' },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const fields = result[0].fields.map((f: any) => f.name);
    expect(fields).toContain('title');
    expect(fields).not.toContain('createdAt');
    expect(fields).not.toContain('updatedAt');
    expect(fields).not.toContain('publishedAt');
    expect(fields).not.toContain('createdBy');
    expect(fields).not.toContain('updatedBy');
    expect(fields).not.toContain('locale');
    expect(fields).not.toContain('localizations');
  });

  test('required=true のフィールドに required プロパティが付与される', async () => {
    const strapi = buildStrapi({
      'api::post.post': buildContentType({
        title: { type: 'string', required: true },
        body: { type: 'text' },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const titleField = result[0].fields.find((f: any) => f.name === 'title');
    const bodyField = result[0].fields.find((f: any) => f.name === 'body');
    expect(titleField?.required).toBe(true);
    expect(bodyField?.required).toBeUndefined();
  });

  test('unique=true のフィールドに unique プロパティが付与される', async () => {
    const strapi = buildStrapi({
      'api::post.post': buildContentType({
        slug: { type: 'string', unique: true },
        title: { type: 'string' },
      }),
    });

    const service = importServiceFactory({ strapi });
    const result = await service.getContentTypes();

    const slugField = result[0].fields.find((f: any) => f.name === 'slug');
    const titleField = result[0].fields.find((f: any) => f.name === 'title');
    expect(slugField?.unique).toBe(true);
    expect(titleField?.unique).toBeUndefined();
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
    title: { type: 'string', unique: true },
    score: { type: 'integer' },
    price: { type: 'decimal' },
    published: { type: 'boolean' },
    views: { type: 'biginteger' },
    ratio: { type: 'float' },
  };

  // ──────────────────────────
  // 入力バリデーション
  // ──────────────────────────
  describe('入力バリデーション', () => {
    test('fieldMapping で同一フィールドに重複マッピングがある場合はエラーを投げる', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await expect(
        service.importRecords(
          uid,
          [{ col_a: 'A', col_b: 'B' }],
          { col_a: 'title', col_b: 'title' }
        )
      ).rejects.toThrow(/fieldMapping maps multiple columns to the same field: title/i);
      expect(createFn).not.toHaveBeenCalled();
    });

    test('fieldMapping に文字列以外の値がある場合はエラーを投げる', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      await expect(
        service.importRecords(
          uid,
          [{ col_a: 'A' }],
          { col_a: 123 as unknown as string }
        )
      ).rejects.toThrow(/fieldMapping values must be strings/i);
      expect(createFn).not.toHaveBeenCalled();
    });
  });

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
        [uid]: buildContentType({ title: { type: 'string' }, eventAt: { type: 'datetime' } }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_title: 'Hello' }], { col_title: 'title' });

      expect(createFn).toHaveBeenCalledWith({
        data: { title: 'Hello', eventAt: fakeNow.toISOString() },
      });
    });

    test('システムフィールド(publishedAt)は自動補完しない', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({ title: { type: 'string' }, publishedAt: { type: 'datetime' } }),
      }, createFn);
      const service = importServiceFactory({ strapi });

      await service.importRecords(uid, [{ col_title: 'Hello' }], { col_title: 'title' });

      expect(createFn).toHaveBeenCalledWith({
        data: { title: 'Hello' },
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
  // Feature 5: フィールド型バリデーション
  // ──────────────────────────
  describe('フィールド型バリデーション', () => {
    test('integer フィールドに非数値を渡すと失敗しcreateは呼ばれない', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_score: 'abc' }], { col_score: 'score' });

      expect(createFn).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
      expect(result.failedRows[0]).toEqual({ col_score: 'abc' });
      expect(result.errors[0]).toMatch(/Row 2/);
      expect(result.errors[0]).toMatch(/score/);
      expect(result.errors[0]).toMatch(/integer/);
    });

    test('biginteger フィールドに小数を渡すと失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_views: '3.14' }], { col_views: 'views' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/views/);
      expect(result.errors[0]).toMatch(/integer/);
    });

    test('decimal フィールドに非数値を渡すと失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_price: 'not-a-number' }], { col_price: 'price' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/price/);
      expect(result.errors[0]).toMatch(/number/);
    });

    test('float フィールドに非数値を渡すと失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_ratio: 'xyz' }], { col_ratio: 'ratio' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/ratio/);
    });

    test('decimal フィールドに部分一致の数値文字列を渡すと失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_price: '12abc' }], { col_price: 'price' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/price/);
      expect(result.errors[0]).toMatch(/number/);
      expect(createFn).not.toHaveBeenCalled();
    });

    test('boolean フィールドに "yes" を渡すと失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_pub: 'yes' }], { col_pub: 'published' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/published/);
      expect(result.errors[0]).toMatch(/boolean/);
    });

    test('boolean フィールドに有効な値を渡すと成功する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      for (const val of ['true', 'false', '1', '0', 'True', 'FALSE']) {
        jest.clearAllMocks();
        const result = await service.importRecords(uid, [{ col_pub: val }], { col_pub: 'published' });
        expect(result.failed).toBe(0);
      }
    });

    test('email フィールドに無効な値を渡すと失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { ...attributes, email: { type: 'email' } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_email: 'not-an-email' }], { col_email: 'email' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/email/);
    });

    test('email フィールドに有効なメールを渡すと成功する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { ...attributes, email: { type: 'email' } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_email: 'test@example.com' }], { col_email: 'email' });

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
    });

    test('enumeration フィールドに無効な値を渡すと失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { ...attributes, status: { type: 'enumeration', enum: ['draft', 'published', 'archived'] } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_status: 'pending' }], { col_status: 'status' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/status/);
      expect(result.errors[0]).toMatch(/draft, published, archived/);
    });

    test('enumeration フィールドに有効な値を渡すと成功する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { ...attributes, status: { type: 'enumeration', enum: ['draft', 'published', 'archived'] } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_status: 'draft' }], { col_status: 'status' });

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
    });

    test('バリデーションエラーの行はスキップし他の行は処理される', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_score: 'abc' }, { col_score: '42' }],
        { col_score: 'score' }
      );

      expect(createFn).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });

    test('空文字列の値はバリデーションをスキップする（オプション扱い）', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_score: '' }], { col_score: 'score' });

      expect(result.failed).toBe(0);
      expect(result.success).toBe(1);
    });
  });

  // ──────────────────────────
  // Feature 6: 必須フィールドバリデーション
  // ──────────────────────────
  describe('必須フィールドバリデーション', () => {
    test('required フィールドに値がない場合は失敗し create を呼ばない', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { title: { type: 'string', required: true } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_title: '' }], { col_title: 'title' });

      expect(createFn).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
      expect(result.failedRows[0]).toEqual({ col_title: '' });
      expect(result.errors[0]).toMatch(/Row 2/);
      expect(result.errors[0]).toMatch(/title/);
      expect(result.errors[0]).toMatch(/required/);
    });

    test('required フィールドが undefined の場合も失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { title: { type: 'string', required: true } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{}], { col_title: 'title' });

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/title/);
      expect(result.errors[0]).toMatch(/required/);
    });

    test('required フィールドに値がある場合は成功する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { title: { type: 'string', required: true } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_title: 'Hello' }], { col_title: 'title' });

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
    });

    test('required でないフィールドは空文字でも成功する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { title: { type: 'string' } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_title: '' }], { col_title: 'title' });

      expect(result.failed).toBe(0);
      expect(result.success).toBe(1);
    });

    test('required 行は失敗し、その後の行は処理される', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { title: { type: 'string', required: true } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: '' }, { col_title: 'Good' }],
        { col_title: 'title' }
      );

      expect(result.failed).toBe(1);
      expect(result.success).toBe(1);
      expect(createFn).toHaveBeenCalledTimes(1);
    });

    test('required フィールドが未マッピングの場合も失敗する', async () => {
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const attrs = { title: { type: 'string', required: true }, body: { type: 'text' } };
      const strapi = buildStrapi({ [uid]: buildContentType(attrs) }, createFn);
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(uid, [{ col_body: 'Hello' }], { col_body: 'body' }, true);

      expect(createFn).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/title/);
      expect(result.errors[0]).toMatch(/required/);
    });
  });

  // ──────────────────────────
  // Feature 4: ロールバック
  // ──────────────────────────
  describe('ロールバック (rollbackOnFailure)', () => {
    test('rollbackOnFailure=true で失敗行があると作成済みレコードを削除する', async () => {
      const deleteFn = jest.fn().mockResolvedValue({});
      const createFn = jest.fn()
        .mockResolvedValueOnce({ documentId: 'doc-1' })
        .mockRejectedValueOnce(new Error('DB error'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, { delete: deleteFn });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'A' }, { col_title: 'B' }],
        { col_title: 'title' },
        false, 0, 'create', undefined,
        true // rollbackOnFailure
      );

      expect(deleteFn).toHaveBeenCalledWith({ documentId: 'doc-1' });
      expect(result.success).toBe(0);
      expect(result.failed).toBe(2);
      expect(result.failedRows).toHaveLength(2);
      expect(result.errors[0]).toMatch(/Row 3: DB error/);
      expect(result.errors[1]).toMatch(/Rolled back: this row was created earlier/);
      expect(result.errors.some((e) => e.includes('Rolled back 1 record(s) due to errors.'))).toBe(true);
    });

    test('rollbackOnFailure=true で成功行が failedRows に追加される', async () => {
      const deleteFn = jest.fn().mockResolvedValue({});
      const createFn = jest.fn()
        .mockResolvedValueOnce({ documentId: 'doc-1' })
        .mockRejectedValueOnce(new Error('DB error'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, { delete: deleteFn });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'A' }, { col_title: 'B' }],
        { col_title: 'title' },
        false, 0, 'create', undefined,
        true
      );

      // failedRows should contain both: original failed (B) and rolled-back succeeded (A)
      expect(result.failedRows).toHaveLength(2);
      const titles = result.failedRows.map((r) => r.col_title);
      expect(titles).toContain('A');
      expect(titles).toContain('B');
    });

    test('rollbackOnFailure=true で全行成功の場合はロールバックしない', async () => {
      const deleteFn = jest.fn().mockResolvedValue({});
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, { delete: deleteFn });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'A' }, { col_title: 'B' }],
        { col_title: 'title' },
        false, 0, 'create', undefined,
        true
      );

      expect(deleteFn).not.toHaveBeenCalled();
      expect(result.success).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    test('rollbackOnFailure=false (デフォルト) の場合はロールバックしない', async () => {
      const deleteFn = jest.fn().mockResolvedValue({});
      const createFn = jest.fn()
        .mockResolvedValueOnce({ documentId: 'doc-1' })
        .mockRejectedValueOnce(new Error('DB error'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, { delete: deleteFn });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'A' }, { col_title: 'B' }],
        { col_title: 'title' }
      );

      expect(deleteFn).not.toHaveBeenCalled();
      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });

    test('rollbackOnFailure=true でもdryRun=true の場合はロールバックしない', async () => {
      const deleteFn = jest.fn().mockResolvedValue({});
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, { delete: deleteFn });
      const service = importServiceFactory({ strapi });

      // Use validation error to create a failed row without needing create() to throw
      const result = await service.importRecords(
        uid,
        [{ col_score: 'not-a-number' }],
        { col_score: 'score' },
        true,  // dryRun
        0, 'create', undefined,
        true   // rollbackOnFailure
      );

      expect(deleteFn).not.toHaveBeenCalled();
      expect(result.failed).toBe(1);
      expect(result.errors.some((e) => e.includes('Rolled back'))).toBe(false);
    });

    test('ロールバック後も updated は保持される（更新は巻き戻せない）', async () => {
      const deleteFn = jest.fn().mockResolvedValue({});
      // Row A finds existing → update; Row B finds nothing → create (which fails)
      const findManyFn = jest.fn()
        .mockResolvedValueOnce([{ documentId: 'existing-doc' }])
        .mockResolvedValueOnce([]);
      const updateFn = jest.fn().mockResolvedValue({ documentId: 'existing-doc' });
      const createFn = jest.fn().mockRejectedValue(new Error('DB error'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        delete: deleteFn,
        findMany: findManyFn,
        update: updateFn,
      });
      const service = importServiceFactory({ strapi });

      // Row A: upsert-update (updated++), Row B: create fails → created rows only rollback
      const result = await service.importRecords(
        uid,
        [{ col_title: 'existing' }, { col_title: 'new-fail' }],
        { col_title: 'title' },
        false, 0, 'upsert', 'title',
        true
      );

      expect(result.success).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors.some((e) => e.includes('Rolled back'))).toBe(false);
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

    test('keyField が指定されていない場合はエラーを投げる', async () => {
      const findManyFn = jest.fn();
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
      });
      const service = importServiceFactory({ strapi });

      await expect(service.importRecords(
        uid,
        [{ col_title: 'Hello' }],
        { col_title: 'title' },
        false,
        0,
        'upsert'
      )).rejects.toThrow(/keyField is required/i);
      expect(findManyFn).not.toHaveBeenCalled();
      expect(createFn).not.toHaveBeenCalled();
    });

    test('keyField がマッピングされていない場合はエラーを投げる', async () => {
      const findManyFn = jest.fn();
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({
        [uid]: buildContentType({
          ...attributes,
          externalId: { type: 'string', unique: true },
        }),
      }, createFn, {
        findMany: findManyFn,
      });
      const service = importServiceFactory({ strapi });

      await expect(service.importRecords(
        uid,
        [{ col_title: 'Hello' }],
        { col_title: 'title' },
        false,
        0,
        'upsert',
        'externalId'
      )).rejects.toThrow(/must be mapped/i);
      expect(findManyFn).not.toHaveBeenCalled();
      expect(createFn).not.toHaveBeenCalled();
    });

    test('keyField が unique でない場合はエラーを投げる', async () => {
      const findManyFn = jest.fn();
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
      });
      const service = importServiceFactory({ strapi });

      await expect(service.importRecords(
        uid,
        [{ col_score: '10' }],
        { col_score: 'score' },
        false,
        0,
        'upsert',
        'score'
      )).rejects.toThrow(/must be unique/i);
      expect(findManyFn).not.toHaveBeenCalled();
      expect(createFn).not.toHaveBeenCalled();
    });

    test('upsert で keyField の値が空行は失敗し create されない', async () => {
      const findManyFn = jest.fn();
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
      });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: '' }],
        { col_title: 'title' },
        false,
        0,
        'upsert',
        'title'
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/key field 'title' is required/i);
      expect(findManyFn).not.toHaveBeenCalled();
      expect(createFn).not.toHaveBeenCalled();
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

    test('upsert で key の一致レコードが複数ある場合は失敗にする', async () => {
      const findManyFn = jest.fn().mockResolvedValue([{ documentId: 'a' }, { documentId: 'b' }]);
      const updateFn = jest.fn();
      const createFn = jest.fn();
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, {
        findMany: findManyFn,
        update: updateFn,
      });
      const service = importServiceFactory({ strapi });

      const result = await service.importRecords(
        uid,
        [{ col_title: 'dup' }],
        { col_title: 'title' },
        false,
        0,
        'upsert',
        'title'
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toMatch(/multiple records matched key field 'title'/i);
      expect(updateFn).not.toHaveBeenCalled();
      expect(createFn).not.toHaveBeenCalled();
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

  describe('チャンク実行 (runId)', () => {
    test('runId 指定時は結果を累積し最終チャンクで履歴を1件だけ保存する', async () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
      const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn);
      const service = importServiceFactory({ strapi });

      const first = await service.importRecords(
        uid,
        [{ col_title: 'A' }],
        { col_title: 'title' },
        false,
        0,
        'create',
        undefined,
        false,
        'run-1',
        false,
        2
      );
      expect(first.success).toBe(1);
      expect(first.completed).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();

      const second = await service.importRecords(
        uid,
        [{ col_title: 'B' }],
        { col_title: 'title' },
        false,
        1,
        'create',
        undefined,
        false,
        'run-1',
        true,
        2
      );
      expect(second.success).toBe(2);
      expect(second.completed).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

      const historyJson = (fs.writeFileSync as jest.Mock).mock.calls[0][1];
      const history = JSON.parse(historyJson);
      expect(history[0].success).toBe(2);
      expect(history[0].totalRows).toBe(2);
    });

    test('runId 指定 + rollbackOnFailure で後続チャンク失敗時に前チャンク作成分も削除する', async () => {
      (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
      const deleteFn = jest.fn().mockResolvedValue({});
      const createFn = jest.fn()
        .mockResolvedValueOnce({ documentId: 'doc-1' })
        .mockRejectedValueOnce(new Error('DB error'));
      const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, { delete: deleteFn });
      const service = importServiceFactory({ strapi });

      await service.importRecords(
        uid,
        [{ col_title: 'A' }],
        { col_title: 'title' },
        false,
        0,
        'create',
        undefined,
        true,
        'run-2',
        false,
        2
      );

      const second = await service.importRecords(
        uid,
        [{ col_title: 'B' }],
        { col_title: 'title' },
        false,
        1,
        'create',
        undefined,
        true,
        'run-2',
        false,
        2
      );

      expect(deleteFn).toHaveBeenCalledWith({ documentId: 'doc-1' });
      expect(second.success).toBe(0);
      expect(second.failed).toBe(2);
      expect(second.rollbackApplied).toBe(true);
      expect(second.completed).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    test('古い runId 状態は TTL 超過で自動削除される', async () => {
      jest.useFakeTimers();
      try {
        (fs.readFileSync as jest.Mock).mockImplementation(() => { throw new Error('ENOENT'); });
        const findManyFn = jest.fn().mockResolvedValue([]);
        const createFn = jest.fn().mockResolvedValue({ documentId: 'doc-1' });
        const strapi = buildStrapi({ [uid]: buildContentType(attributes) }, createFn, { findMany: findManyFn });
        const service = importServiceFactory({ strapi });

        await service.importRecords(
          uid,
          [{ col_title: 'A' }],
          { col_title: 'title' },
          false,
          0,
          'create',
          undefined,
          false,
          'stale-run',
          false,
          1
        );

        jest.advanceTimersByTime(30 * 60 * 1000 + 1);

        const result = await service.importRecords(
          uid,
          [{ col_title: 'B' }],
          { col_title: 'title' },
          false,
          0,
          'upsert',
          'title',
          false,
          'stale-run',
          true,
          1
        );

        expect(result.failed).toBe(0);
        expect(result.completed).toBe(true);
      } finally {
        jest.useRealTimers();
      }
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
