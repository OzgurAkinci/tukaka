import type { DatabaseColumn } from '@tukaka/contracts';

import {
  mssqlDialect,
  mysqlDialect,
  postgresDialect,
  renderStatement,
  sqliteDialect,
} from '../sql-dialects';
import { buildRowChangeStatements, RowChangeError } from './row-changes';

const column = (name: string, isPrimaryKey = false): DatabaseColumn => ({
  name,
  dataType: 'text',
  nullable: !isPrimaryKey,
  defaultValue: null,
  isPrimaryKey,
  isForeignKey: false,
  position: 1,
});

const columns = [column('id', true), column('name'), column('note')];

describe('buildRowChangeStatements', () => {
  it('builds parameterized INSERT/UPDATE/DELETE for PostgreSQL', () => {
    const statements = buildRowChangeStatements(postgresDialect, 'public', 'users', columns, [
      { type: 'insert', values: { name: 'Ada', note: null } },
      { type: 'update', key: { id: 7 }, values: { name: "O'Hara" } },
      { type: 'delete', key: { id: 9 } },
    ]);

    expect(statements).toEqual([
      {
        sql: 'INSERT INTO "public"."users" ("name", "note") VALUES ($1, $2)',
        parameters: ['Ada', null],
        expectedRows: 1,
      },
      {
        sql: 'UPDATE "public"."users" SET "name" = $1 WHERE "id" = $2',
        parameters: ["O'Hara", 7],
        expectedRows: 1,
      },
      {
        sql: 'DELETE FROM "public"."users" WHERE "id" = $1',
        parameters: [9],
        expectedRows: 1,
      },
    ]);

    expect(
      renderStatement(postgresDialect, statements[1].sql, statements[1].parameters),
    ).toBe(`UPDATE "public"."users" SET "name" = 'O''Hara' WHERE "id" = 7`);
  });

  it('uses dialect specific quoting and placeholders', () => {
    const [mysql] = buildRowChangeStatements(mysqlDialect, 'shop', 'items', columns, [
      { type: 'update', key: { id: 1 }, values: { note: 'a\\b' } },
    ]);
    expect(mysql.sql).toBe('UPDATE `shop`.`items` SET `note` = ? WHERE `id` = ?');
    expect(renderStatement(mysqlDialect, mysql.sql, mysql.parameters)).toBe(
      "UPDATE `shop`.`items` SET `note` = 'a\\\\b' WHERE `id` = 1",
    );

    const [mssql] = buildRowChangeStatements(mssqlDialect, 'dbo', 'items', columns, [
      { type: 'delete', key: { id: 1 } },
    ]);
    expect(mssql.sql).toBe('DELETE FROM [dbo].[items] WHERE [id] = @p1');
  });

  it('supports composite keys and default-value inserts', () => {
    const composite = [column('a', true), column('b', true), column('v')];

    const [update, insert] = buildRowChangeStatements(sqliteDialect, 'main', 't', composite, [
      { type: 'update', key: { b: 2, a: 1 }, values: { v: true } },
      { type: 'insert', values: {} },
    ]);

    expect(update.sql).toBe('UPDATE "main"."t" SET "v" = ? WHERE "a" = ? AND "b" = ?');
    expect(update.parameters).toEqual([true, 1, 2]);
    expect(insert.sql).toBe('INSERT INTO "main"."t" DEFAULT VALUES');
  });

  it('renders numbered placeholders without clobbering $1 vs $10', () => {
    const sql = Array.from({ length: 11 }, (_, i) => `$${i + 1}`).join(',');
    const parameters = Array.from({ length: 11 }, (_, i) => i + 1);

    expect(renderStatement(postgresDialect, sql, parameters)).toBe(
      '1,2,3,4,5,6,7,8,9,10,11',
    );
  });

  it.each([
    [{ type: 'update', key: { id: 1 }, values: { nope: 1 } }, /Unknown column/],
    [{ type: 'update', key: { name: 'x' }, values: { note: 1 } }, /full primary key/],
    [{ type: 'update', key: { id: null }, values: { note: 1 } }, /cannot be NULL/],
    [{ type: 'update', key: { id: 1 }, values: {} }, /at least one column/],
  ] as const)('rejects invalid change %#', (change, message) => {
    expect(() =>
      buildRowChangeStatements(postgresDialect, 'public', 'users', columns, [change as never]),
    ).toThrow(message);
  });

  it('refuses edits on tables without a primary key', () => {
    const noKey = [column('a'), column('b')];

    expect(() =>
      buildRowChangeStatements(postgresDialect, 'public', 'log', noKey, [
        { type: 'delete', key: { a: 1 } },
      ]),
    ).toThrow(RowChangeError);

    expect(
      buildRowChangeStatements(postgresDialect, 'public', 'log', noKey, [
        { type: 'insert', values: { a: 1 } },
      ]),
    ).toHaveLength(1);
  });
});
