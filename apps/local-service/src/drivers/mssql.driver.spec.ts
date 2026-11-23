import type { IRecordSet } from 'mssql';

import { recordsetColumns, showplanToNodes } from './mssql.driver';
import { mssqlDialect, renderStatement } from './sql-dialects';
import { buildTableDataQuery } from './table-data/table-data-query';

describe('MssqlDriver helpers', () => {
  it('orders recordset columns by their index', () => {
    const recordset = Object.assign([], {
      columns: {
        b: { index: 1, name: 'b' },
        a: { index: 0, name: 'a' },
      },
    }) as unknown as IRecordSet<Record<string, unknown>>;

    expect(recordsetColumns(recordset)).toEqual(['a', 'b']);
    expect(recordsetColumns(undefined)).toEqual([]);
  });

  it('builds a plan tree from SHOWPLAN_ALL rows', () => {
    const nodes = showplanToNodes([
      { NodeId: 1, Parent: 0, PhysicalOp: null, LogicalOp: null, Argument: null, StmtText: 'SELECT * FROM t WHERE id = 1', EstimateRows: 1, TotalSubtreeCost: 0.0032, Type: 'SELECT' },
      { NodeId: 2, Parent: 1, PhysicalOp: 'Clustered Index Seek', LogicalOp: 'Clustered Index Seek', Argument: 'OBJECT:([db].[dbo].[t].[PK_t])', StmtText: '', EstimateRows: 1, TotalSubtreeCost: 0.0032, Type: 'PLAN_ROW' },
    ]);

    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toContain('SELECT * FROM t');
    expect(nodes[0].children[0]).toMatchObject({
      label: 'Clustered Index Seek',
      detail: 'OBJECT:([db].[dbo].[t].[PK_t])',
      cost: 0.0032,
    });
  });

  it('pages with OFFSET/FETCH and a stable ORDER BY', () => {
    const query = buildTableDataQuery(mssqlDialect, {
      schema: 'dbo',
      table: 'users',
      limit: 10,
      offset: 20,
      filters: [{ column: 'name', operator: 'contains', value: 'ali' }],
    });

    expect(query.dataSql).toBe(
      "SELECT * FROM [dbo].[users] WHERE CAST([name] AS NVARCHAR(MAX)) LIKE @p1 ESCAPE '!' ORDER BY (SELECT NULL) OFFSET 20 ROWS FETCH NEXT 11 ROWS ONLY",
    );
    expect(renderStatement(mssqlDialect, 'UPDATE t SET a = @p1 WHERE id = @p2', ['Çay', 3])).toBe(
      "UPDATE t SET a = N'Çay' WHERE id = 3",
    );
  });
});
