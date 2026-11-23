import type { DatabaseColumn } from '@tukaka/contracts';

import { oracleConnectString, planRowsToNodes } from './oracle.driver';
import { oracleDialect, renderStatement } from './sql-dialects';
import { splitOracleScript } from './sql-splitter';
import { buildRowChangeStatements } from './table-data/row-changes';
import { buildTableDataQuery } from './table-data/table-data-query';
import { makeProfile } from './test-helpers';

describe('Oracle support', () => {
  describe('splitOracleScript', () => {
    it('strips trailing semicolons from plain statements', () => {
      expect(splitOracleScript('SELECT 1 FROM DUAL;\nSELECT 2 FROM DUAL;')).toEqual([
        'SELECT 1 FROM DUAL',
        'SELECT 2 FROM DUAL',
      ]);
    });

    it('keeps PL/SQL blocks intact up to a "/" line', () => {
      const script = [
        "INSERT INTO log VALUES ('a;b');",
        'CREATE OR REPLACE FUNCTION add_one(n NUMBER) RETURN NUMBER IS',
        'BEGIN',
        '  RETURN n + 1;',
        'END;',
        '/',
        'BEGIN',
        "  DBMS_OUTPUT.PUT_LINE('x;y');",
        'END;',
        '/',
        '-- trailing comment',
        'SELECT add_one(1) FROM DUAL',
      ].join('\n');

      expect(splitOracleScript(script)).toEqual([
        "INSERT INTO log VALUES ('a;b')",
        'CREATE OR REPLACE FUNCTION add_one(n NUMBER) RETURN NUMBER IS\nBEGIN\n  RETURN n + 1;\nEND;',
        "BEGIN\n  DBMS_OUTPUT.PUT_LINE('x;y');\nEND;",
        'SELECT add_one(1) FROM DUAL',
      ]);
    });

    it('treats an unterminated PL/SQL block as the rest of the script', () => {
      expect(splitOracleScript('DECLARE x NUMBER; BEGIN x := 1; END;')).toEqual([
        'DECLARE x NUMBER; BEGIN x := 1; END;',
      ]);
    });

    it('ignores comment-only input', () => {
      expect(splitOracleScript('-- nothing\n/* here */')).toEqual([]);
    });
  });

  it('pages with OFFSET/FETCH and does case-insensitive LIKE via UPPER', () => {
    const query = buildTableDataQuery(oracleDialect, {
      schema: 'HR',
      table: 'EMPLOYEES',
      limit: 50,
      offset: 100,
      sort: { column: 'LAST_NAME', direction: 'asc' },
      filters: [
        { column: 'FIRST_NAME', operator: 'contains', value: 'al' },
        { column: 'SALARY', operator: 'gte', value: '1000' },
      ],
    });

    expect(query.dataSql).toBe(
      `SELECT * FROM "HR"."EMPLOYEES" WHERE UPPER(TO_CHAR("FIRST_NAME")) LIKE UPPER(:1) ESCAPE '!' AND "SALARY" >= :2 ORDER BY "LAST_NAME" ASC OFFSET 100 ROWS FETCH NEXT 51 ROWS ONLY`,
    );
    expect(query.parameters).toEqual(['%al%', '1000']);
  });

  it('builds row changes with positional binds and DEFAULT inserts', () => {
    const column = (name: string, isPrimaryKey = false): DatabaseColumn => ({
      name,
      dataType: 'NUMBER',
      nullable: !isPrimaryKey,
      defaultValue: null,
      isPrimaryKey,
      isForeignKey: false,
      position: 1,
    });

    const [update, insert] = buildRowChangeStatements(
      oracleDialect,
      'HR',
      'DEPT',
      [column('ID', true), column('NAME')],
      [
        { type: 'update', key: { ID: 10 }, values: { NAME: "R&D's" } },
        { type: 'insert', values: {} },
      ],
    );

    expect(update.sql).toBe('UPDATE "HR"."DEPT" SET "NAME" = :1 WHERE "ID" = :2');
    expect(renderStatement(oracleDialect, update.sql, update.parameters)).toBe(
      `UPDATE "HR"."DEPT" SET "NAME" = 'R&D''s' WHERE "ID" = 10`,
    );
    expect(insert.sql).toBe('INSERT INTO "HR"."DEPT" ("ID") VALUES (DEFAULT)');
  });

  it('builds Easy Connect strings for each SSL mode', () => {
    const profile = (ssl_mode: string) =>
      makeProfile({ type: 'oracle', host: 'db.example.com', port: 1521, database: 'FREEPDB1', ssl_mode });

    expect(oracleConnectString(profile('prefer'))).toBe(
      'db.example.com:1521/FREEPDB1?connect_timeout=10',
    );
    expect(oracleConnectString(profile('require'))).toBe(
      'tcps://db.example.com:1521/FREEPDB1?connect_timeout=10&ssl_server_dn_match=false',
    );
    expect(oracleConnectString(profile('verify-full'))).toBe(
      'tcps://db.example.com:1521/FREEPDB1?connect_timeout=10&ssl_server_dn_match=true',
    );
  });

  it('turns PLAN_TABLE rows into a tree', () => {
    const nodes = planRowsToNodes([
      { id: 0, parentId: null, operation: 'SELECT STATEMENT', options: null, objectName: null, cost: 3, cardinality: 1, accessPredicates: null, filterPredicates: null },
      { id: 2, parentId: 1, operation: 'INDEX', options: 'UNIQUE SCAN', objectName: 'EMP_PK', cost: 0, cardinality: 1, accessPredicates: '"ID"=10', filterPredicates: null },
      { id: 1, parentId: 0, operation: 'TABLE ACCESS', options: 'BY INDEX ROWID', objectName: 'EMPLOYEES', cost: 1, cardinality: 1, accessPredicates: null, filterPredicates: null },
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe('SELECT STATEMENT');
    expect(nodes[0].children[0].label).toBe('TABLE ACCESS BY INDEX ROWID EMPLOYEES');
    expect(nodes[0].children[0].children[0]).toMatchObject({
      label: 'INDEX UNIQUE SCAN EMP_PK',
      detail: 'access: "ID"=10',
    });
  });
});
