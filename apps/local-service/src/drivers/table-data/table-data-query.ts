
import type {
  FilterOperator,
  TableFilter,
  TableSort,
} from '@tukaka/contracts';

import type { SqlDialect } from '../database-driver.interface';

export interface TableDataQueryInput {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sort?: TableSort;
  filters?: TableFilter[];
}

export interface TableDataQuery {
  /** `limit + 1` satır getirir; fazladan satır `hasMore` için kullanılır. */
  dataSql: string;
  countSql: string;
  parameters: string[];
}

const COMPARISON: Partial<Record<FilterOperator, string>> = {
  eq: '=',
  neq: '<>',
  lt: '<',
  lte: '<=',
  gt: '>',
  gte: '>=',
};

/** LIKE desenindeki özel karakterleri `!` ile kaçırır. */
function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

/**
 * Data Viewer için sayfalı, sıralı ve filtreli SELECT sorgusu üretir.
 *
 * Tanımlayıcılar sürücü diyalektiyle tırnaklanır, filtre değerleri her zaman
 * parametre olarak gönderilir. Kolon adlarının tabloda var olduğu çağıran
 * tarafından ayrıca doğrulanmalıdır.
 */
export function buildTableDataQuery(
  dialect: SqlDialect,
  input: TableDataQueryInput,
): TableDataQuery {
  const quote = dialect.quoteIdentifier;
  const tableRef = `${quote(input.schema)}.${quote(input.table)}`;

  const parameters: string[] = [];
  const nextParameter = (value: string) => {
    parameters.push(value);
    return dialect.placeholder(parameters.length);
  };

  const conditions = (input.filters ?? []).map((filter) => {
    const column = quote(filter.column);
    const value = filter.value ?? '';

    switch (filter.operator) {
      case 'isNull':
        return `${column} IS NULL`;

      case 'isNotNull':
        return `${column} IS NOT NULL`;

      case 'contains':
      case 'notContains':
      case 'startsWith':
      case 'endsWith': {
        const escaped = escapeLike(value);
        const pattern =
          filter.operator === 'startsWith'
            ? `${escaped}%`
            : filter.operator === 'endsWith'
              ? `%${escaped}`
              : `%${escaped}%`;

        const negate = filter.operator === 'notContains' ? 'NOT ' : '';

        return `${dialect.castToText(column)} ${negate}${dialect.caseInsensitiveLike} ${nextParameter(pattern)} ESCAPE '!'`;
      }

      default: {
        const operator = COMPARISON[filter.operator];

        if (!operator) {
          throw new Error(`Unsupported filter operator: ${filter.operator}`);
        }

        return `${column} ${operator} ${nextParameter(value)}`;
      }
    }
  });

  const where = conditions.length
    ? ` WHERE ${conditions.join(' AND ')}`
    : '';

  const orderBy = input.sort
    ? ` ORDER BY ${quote(input.sort.column)} ${input.sort.direction === 'desc' ? 'DESC' : 'ASC'}`
    : '';

  const limit = Math.max(1, Math.floor(input.limit)) + 1;
  const offset = Math.max(0, Math.floor(input.offset));

  return {
    dataSql: `SELECT * FROM ${tableRef}${where}${orderBy}${dialect.paginate(limit, offset, Boolean(input.sort))}`,
    countSql: `SELECT COUNT(*) AS total FROM ${tableRef}${where}`,
    parameters,
  };
}
