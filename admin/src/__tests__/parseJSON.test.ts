import { parseJSON } from '../utils/parseJSON';

describe('parseJSON', () => {
  // ──────────────────────────────
  // 基本的なパース
  // ──────────────────────────────
  describe('基本パース', () => {
    test('ヘッダーとデータ行を正しくパースする', () => {
      const json = JSON.stringify([
        { name: 'Alice', age: 30, email: 'alice@example.com' },
        { name: 'Bob', age: 25, email: 'bob@example.com' },
      ]);
      const { headers, rows } = parseJSON(json);

      expect(headers).toEqual(['name', 'age', 'email']);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ name: 'Alice', age: '30', email: 'alice@example.com' });
      expect(rows[1]).toEqual({ name: 'Bob', age: '25', email: 'bob@example.com' });
    });

    test('1 要素の配列を正しくパースする', () => {
      const json = JSON.stringify([{ title: 'Hello', body: 'World' }]);
      const { headers, rows } = parseJSON(json);

      expect(headers).toEqual(['title', 'body']);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ title: 'Hello', body: 'World' });
    });
  });

  // ──────────────────────────────
  // 空・不正入力
  // ──────────────────────────────
  describe('空・不正入力', () => {
    test('空配列を渡すと空の結果を返す', () => {
      const { headers, rows } = parseJSON('[]');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });

    test('空文字列を渡すと空の結果を返す', () => {
      const { headers, rows } = parseJSON('');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });

    test('空白文字のみを渡すと空の結果を返す', () => {
      const { headers, rows } = parseJSON('   \n');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });

    test('不正な JSON を渡すと空の結果を返す', () => {
      const { headers, rows } = parseJSON('{invalid json');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });
  });

  // ──────────────────────────────
  // 配列以外の JSON
  // ──────────────────────────────
  describe('配列以外の JSON', () => {
    test('オブジェクトを渡すと空の結果を返す', () => {
      const { headers, rows } = parseJSON('{"name": "Alice"}');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });

    test('文字列を渡すと空の結果を返す', () => {
      const { headers, rows } = parseJSON('"hello"');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });

    test('数値を渡すと空の結果を返す', () => {
      const { headers, rows } = parseJSON('42');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });
  });

  // ──────────────────────────────
  // 値の型変換
  // ──────────────────────────────
  describe('値の型変換', () => {
    test('null 値は空文字列に変換される', () => {
      const json = JSON.stringify([{ name: 'Alice', nickname: null }]);
      const { rows } = parseJSON(json);

      expect(rows[0]).toEqual({ name: 'Alice', nickname: '' });
    });

    test('boolean 値は文字列に変換される', () => {
      const json = JSON.stringify([{ active: true, verified: false }]);
      const { rows } = parseJSON(json);

      expect(rows[0]).toEqual({ active: 'true', verified: 'false' });
    });

    test('number 値は文字列に変換される', () => {
      const json = JSON.stringify([{ age: 28, score: 3.14 }]);
      const { rows } = parseJSON(json);

      expect(rows[0]).toEqual({ age: '28', score: '3.14' });
    });
  });

  // ──────────────────────────────
  // 日本語
  // ──────────────────────────────
  describe('日本語', () => {
    test('日本語カラム名と値を正しくパースする', () => {
      const json = JSON.stringify([
        { 名前: '山田太郎', 年齢: 28 },
        { 名前: '鈴木花子', 年齢: 22 },
      ]);
      const { headers, rows } = parseJSON(json);

      expect(headers).toEqual(['名前', '年齢']);
      expect(rows[0]).toEqual({ 名前: '山田太郎', 年齢: '28' });
      expect(rows[1]).toEqual({ 名前: '鈴木花子', 年齢: '22' });
    });
  });

  // ──────────────────────────────
  // ネストされた値の型変換
  // ──────────────────────────────
  describe('ネストされた値の型変換', () => {
    test('documentId を持つオブジェクト配列はカンマ区切りの documentId に変換される', () => {
      const json = JSON.stringify([
        { title: 'Post', tags: [{ documentId: 'a' }, { documentId: 'b' }] },
      ]);
      const { rows } = parseJSON(json);
      expect(rows[0].tags).toBe('a,b');
    });

    test('id を持つオブジェクト配列はカンマ区切りの id に変換される', () => {
      const json = JSON.stringify([
        { title: 'Post', media: [{ id: 1 }, { id: 2 }] },
      ]);
      const { rows } = parseJSON(json);
      expect(rows[0].media).toBe('1,2');
    });

    test('プリミティブの配列はカンマ区切りの文字列に変換される', () => {
      const json = JSON.stringify([{ nums: [1, 2, 3] }]);
      const { rows } = parseJSON(json);
      expect(rows[0].nums).toBe('1,2,3');
    });

    test('プレーンオブジェクトは JSON.stringify に変換される', () => {
      const json = JSON.stringify([{ addr: { city: 'Tokyo' } }]);
      const { rows } = parseJSON(json);
      expect(rows[0].addr).toBe('{"city":"Tokyo"}');
    });

    test('documentId も id も持たないオブジェクト配列は JSON.stringify に変換される', () => {
      const json = JSON.stringify([{ items: [{ name: 'a' }, { name: 'b' }] }]);
      const { rows } = parseJSON(json);
      expect(rows[0].items).toBe('[{"name":"a"},{"name":"b"}]');
    });

    test('空配列は空文字列に変換される', () => {
      const json = JSON.stringify([{ items: [] }]);
      const { rows } = parseJSON(json);
      expect(rows[0].items).toBe('');
    });
  });
});
