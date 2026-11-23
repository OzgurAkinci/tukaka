import { isBlankSql, splitSqlSegments } from './sql-splitter';

describe('splitSqlSegments', () => {
  it('splits on semicolons', () => {
    expect(splitSqlSegments('SELECT 1; SELECT 2;')).toEqual([
      'SELECT 1;',
      ' SELECT 2;',
    ]);
  });

  it('keeps a trailing statement without semicolon', () => {
    expect(splitSqlSegments('SELECT 1; SELECT 2')).toEqual([
      'SELECT 1;',
      ' SELECT 2',
    ]);
  });

  it('ignores semicolons in strings, identifiers and comments', () => {
    const sql = [
      "SELECT 'a;b', \"c;d\", `e;f`, [g;h] -- x;y",
      '/* p;q */ FROM t;',
      "SELECT 'it''s; fine';",
    ].join('\n');

    expect(splitSqlSegments(sql)).toHaveLength(2);
  });

  it('detects blank SQL', () => {
    expect(isBlankSql('  -- only a comment\n /* block */ ; ')).toBe(true);
    expect(isBlankSql('SELECT 1')).toBe(false);
  });
});
