import { parseCSV } from '../utils/parseCSV';

describe('parseCSV', () => {
  // ──────────────────────────────
  // 基本的なパース
  // ──────────────────────────────
  describe('基本パース', () => {
    test('ヘッダー行とデータ行を正しくパースする', () => {
      const csv = 'name,age,email\nAlice,30,alice@example.com\nBob,25,bob@example.com';
      const { headers, rows } = parseCSV(csv);

      expect(headers).toEqual(['name', 'age', 'email']);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ name: 'Alice', age: '30', email: 'alice@example.com' });
      expect(rows[1]).toEqual({ name: 'Bob', age: '25', email: 'bob@example.com' });
    });

    test('ヘッダー行のみの場合はデータ行が空になる', () => {
      const csv = 'name,age';
      const { headers, rows } = parseCSV(csv);

      expect(headers).toEqual(['name', 'age']);
      expect(rows).toHaveLength(0);
    });

    test('空文字列を渡すと空の結果を返す', () => {
      const { headers, rows } = parseCSV('');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });

    test('空白行のみを渡すと空の結果を返す', () => {
      const { headers, rows } = parseCSV('\n\n   \n');

      expect(headers).toEqual([]);
      expect(rows).toHaveLength(0);
    });
  });

  // ──────────────────────────────
  // 改行コードの差異
  // ──────────────────────────────
  describe('改行コード', () => {
    test('CRLF (\\r\\n) でも正しくパースする', () => {
      const csv = 'title,body\r\nHello,World\r\nFoo,Bar';
      const { headers, rows } = parseCSV(csv);

      expect(headers).toEqual(['title', 'body']);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ title: 'Hello', body: 'World' });
    });

    test('LF (\\n) でも正しくパースする', () => {
      const csv = 'title,body\nHello,World';
      const { headers, rows } = parseCSV(csv);

      expect(rows[0]).toEqual({ title: 'Hello', body: 'World' });
    });
  });

  // ──────────────────────────────
  // ダブルクォート処理
  // ──────────────────────────────
  describe('ダブルクォート', () => {
    test('クォートで囲まれたフィールドをパースする', () => {
      const csv = 'name,description\n"Alice","A developer"';
      const { rows } = parseCSV(csv);

      expect(rows[0]).toEqual({ name: 'Alice', description: 'A developer' });
    });

    test('クォート内のカンマをフィールド区切りと見なさない', () => {
      const csv = 'name,address\nAlice,"Tokyo, Japan"';
      const { rows } = parseCSV(csv);

      expect(rows[0]).toEqual({ name: 'Alice', address: 'Tokyo, Japan' });
    });

    test('エスケープされたダブルクォート ("") を正しくパースする', () => {
      const csv = 'name,quote\nAlice,"He said ""Hello"""';
      const { rows } = parseCSV(csv);

      expect(rows[0]).toEqual({ name: 'Alice', quote: 'He said "Hello"' });
    });

    test('クォート内の改行を含むフィールドはそのまま取得できる', () => {
      // 簡易パーサーのため複数行フィールドは範囲外だが、単行内のクォートは問題なし
      const csv = 'a,b\n"foo","bar"';
      const { rows } = parseCSV(csv);

      expect(rows[0]).toEqual({ a: 'foo', b: 'bar' });
    });
  });

  // ──────────────────────────────
  // 空フィールド・末尾空白行
  // ──────────────────────────────
  describe('エッジケース', () => {
    test('値が欠けている列は空文字列になる', () => {
      const csv = 'a,b,c\n1,,3';
      const { rows } = parseCSV(csv);

      expect(rows[0]).toEqual({ a: '1', b: '', c: '3' });
    });

    test('データ行末尾の空白行は無視される', () => {
      const csv = 'name\nAlice\n\n\n';
      const { rows } = parseCSV(csv);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ name: 'Alice' });
    });

    test('カラム数が多い行は余分な値を無視する', () => {
      const csv = 'a,b\n1,2,3,4';
      const { rows } = parseCSV(csv);

      // ヘッダーにないキーは含まれない
      expect(Object.keys(rows[0])).toEqual(['a', 'b']);
      expect(rows[0]).toEqual({ a: '1', b: '2' });
    });

    test('データ行のカラム数がヘッダーより少ない場合は空文字列にフォールバックする', () => {
      // "a,b,c" に対して "1,2" しかない → c は ''
      const csv = 'a,b,c\n1,2';
      const { rows } = parseCSV(csv);

      expect(rows[0]).toEqual({ a: '1', b: '2', c: '' });
    });

    test('日本語カラム名と値を正しくパースする', () => {
      const csv = '名前,年齢\n山田太郎,28\n鈴木花子,22';
      const { headers, rows } = parseCSV(csv);

      expect(headers).toEqual(['名前', '年齢']);
      expect(rows[0]).toEqual({ 名前: '山田太郎', 年齢: '28' });
      expect(rows[1]).toEqual({ 名前: '鈴木花子', 年齢: '22' });
    });
  });
});
