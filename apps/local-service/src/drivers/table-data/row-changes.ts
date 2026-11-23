
import type { DatabaseColumn, RowChange } from '@tukaka/contracts';

import type {
  ParameterizedStatement,
  SqlDialect,
} from '../database-driver.interface';

export class RowChangeError extends Error {}

/**
 * Data Viewer'daki satır değişikliklerini parametreli INSERT/UPDATE/DELETE
 * ifadelerine çevirir.
 *
 * - Kolon adları tablonun gerçek kolonlarıyla doğrulanır.
 * - UPDATE/DELETE yalnızca birincil anahtarın tamamıyla yapılabilir ve tam
 *   olarak 1 satırı etkilemelidir (aksi halde transaction geri alınır).
 */
export function buildRowChangeStatements(
  dialect: SqlDialect,
  schema: string,
  table: string,
  columns: DatabaseColumn[],
  changes: RowChange[],
): ParameterizedStatement[] {
  const quote = dialect.quoteIdentifier;
  const tableRef = `${quote(schema)}.${quote(table)}`;
  const known = new Set(columns.map((column) => column.name));
  const primaryKey = columns
    .filter((column) => column.isPrimaryKey)
    .map((column) => column.name);

  const assertColumns = (names: string[]) => {
    const unknown = names.filter((name) => !known.has(name));

    if (unknown.length > 0) {
      throw new RowChangeError(`Unknown column(s): ${unknown.join(', ')}`);
    }
  };

  const whereKey = (key: Record<string, unknown>, offset: number) => {
    if (primaryKey.length === 0) {
      throw new RowChangeError(
        'This table has no primary key; rows can only be inserted, not edited or deleted.',
      );
    }

    const keyColumns = Object.keys(key).sort();

    if (
      keyColumns.length !== primaryKey.length ||
      ![...primaryKey].sort().every((name, index) => name === keyColumns[index])
    ) {
      throw new RowChangeError(
        `Rows must be identified by the full primary key (${primaryKey.join(', ')}).`,
      );
    }

    const parameters = primaryKey.map((name) => key[name]);

    if (parameters.some((value) => value === null || value === undefined)) {
      throw new RowChangeError('Primary key values cannot be NULL.');
    }

    return {
      sql: primaryKey
        .map((name, index) => `${quote(name)} = ${dialect.placeholder(offset + index + 1)}`)
        .join(' AND '),
      parameters,
    };
  };

  return changes.map((change): ParameterizedStatement => {
    switch (change.type) {
      case 'insert': {
        const names = Object.keys(change.values);
        assertColumns(names);

        if (names.length === 0) {
          return {
            sql: dialect.insertDefaultValues(tableRef, quote(columns[0]?.name ?? '')),
            parameters: [],
            expectedRows: 1,
          };
        }

        return {
          sql: `INSERT INTO ${tableRef} (${names.map(quote).join(', ')}) VALUES (${names
            .map((_, index) => dialect.placeholder(index + 1))
            .join(', ')})`,
          parameters: names.map((name) => change.values[name]),
          expectedRows: 1,
        };
      }

      case 'update': {
        const names = Object.keys(change.values);

        if (names.length === 0) {
          throw new RowChangeError('An update must change at least one column.');
        }

        assertColumns(names);

        const where = whereKey(change.key, names.length);

        return {
          sql: `UPDATE ${tableRef} SET ${names
            .map((name, index) => `${quote(name)} = ${dialect.placeholder(index + 1)}`)
            .join(', ')} WHERE ${where.sql}`,
          parameters: [...names.map((name) => change.values[name]), ...where.parameters],
          expectedRows: 1,
        };
      }

      case 'delete': {
        const where = whereKey(change.key, 0);

        return {
          sql: `DELETE FROM ${tableRef} WHERE ${where.sql}`,
          parameters: where.parameters,
          expectedRows: 1,
        };
      }

      default:
        throw new RowChangeError('Unknown change type.');
    }
  });
}
