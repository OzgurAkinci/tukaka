import { mysqlDialect, postgresDialect, sqliteDialect } from '../sql-dialects';
import { buildTableDataQuery } from './table-data-query';

describe('buildTableDataQuery', () => {
  it('builds a simple paged query', () => {
    const query = buildTableDataQuery(postgresDialect, {
      schema: 'public',
      table: 'users',
      limit: 50,
      offset: 100,
    });

    expect(query.dataSql).toBe(
      'SELECT * FROM "public"."users" LIMIT 51 OFFSET 100',
    );
    expect(query.countSql).toBe('SELECT COUNT(*) AS total FROM "public"."users"');
    expect(query.parameters).toEqual([]);
  });

  it('quotes identifiers so they cannot break out', () => {
    const query = buildTableDataQuery(postgresDialect, {
      schema: 'pub"lic',
      table: 'x"; DROP TABLE y; --',
      limit: 10,
      offset: 0,
      sort: { column: 'na"me', direction: 'desc' },
    });

    expect(query.dataSql).toBe(
      'SELECT * FROM "pub""lic"."x""; DROP TABLE y; --" ORDER BY "na""me" DESC LIMIT 11 OFFSET 0',
    );
  });

  it('uses MySQL backticks and ? placeholders', () => {
    const query = buildTableDataQuery(mysqlDialect, {
      schema: 'shop',
      table: 'order`s',
      limit: 10,
      offset: 0,
      filters: [
        { column: 'status', operator: 'eq', value: 'paid' },
        { column: 'note', operator: 'contains', value: '50%_off!' },
      ],
    });

    expect(query.dataSql).toBe(
      "SELECT * FROM `shop`.`order``s` WHERE `status` = ? AND CAST(`note` AS CHAR) LIKE ? ESCAPE '!' LIMIT 11 OFFSET 0",
    );
    expect(query.parameters).toEqual(['paid', '%50!%!_off!!%']);
  });

  it('numbers PostgreSQL placeholders and uses ILIKE', () => {
    const query = buildTableDataQuery(postgresDialect, {
      schema: 'public',
      table: 't',
      limit: 10,
      offset: 0,
      filters: [
        { column: 'a', operator: 'gte', value: '5' },
        { column: 'b', operator: 'startsWith', value: 'ab' },
        { column: 'c', operator: 'isNull' },
        { column: 'd', operator: 'notContains', value: 'x' },
      ],
    });

    expect(query.dataSql).toContain(
      `WHERE "a" >= $1 AND CAST("b" AS TEXT) ILIKE $2 ESCAPE '!' AND "c" IS NULL AND CAST("d" AS TEXT) NOT ILIKE $3 ESCAPE '!'`,
    );
    expect(query.countSql).toContain('WHERE "a" >= $1');
    expect(query.parameters).toEqual(['5', 'ab%', '%x%']);
  });

  it('sanitizes limit and offset', () => {
    const query = buildTableDataQuery(sqliteDialect, {
      schema: 'main',
      table: 't',
      limit: -5,
      offset: -1,
    });

    expect(query.dataSql).toBe('SELECT * FROM "main"."t" LIMIT 2 OFFSET 0');
  });
});
