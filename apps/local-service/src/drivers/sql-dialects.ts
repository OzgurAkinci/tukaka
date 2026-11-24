
import type { SqlDialect } from './database-driver.interface';

const quoteDouble = (name: string) => `"${name.replace(/"/g, '""')}"`;

function literal(
  value: unknown,
  options: { booleans: 'keyword' | 'number'; backslashEscapes: boolean },
): string {
  if (value === null || value === undefined) return 'NULL';

  if (typeof value === 'boolean') {
    return options.booleans === 'keyword'
      ? value ? 'TRUE' : 'FALSE'
      : value ? '1' : '0';
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }

  const text =
    typeof value === 'string'
      ? value
      : value instanceof Date
        ? value.toISOString()
        : JSON.stringify(value);

  const escaped = options.backslashEscapes
    ? text.replace(/\\/g, '\\\\').replace(/'/g, "''")
    : text.replace(/'/g, "''");

  return `'${escaped}'`;
}

const limitOffset = (limit: number, offset: number) =>
  ` LIMIT ${limit} OFFSET ${offset}`;

export const postgresDialect: SqlDialect = {
  quoteIdentifier: quoteDouble,
  placeholder: (index) => `$${index}`,
  castToText: (expression) => `CAST(${expression} AS TEXT)`,
  caseInsensitiveLike: 'ILIKE',
  formatLiteral: (value) =>
    literal(value, { booleans: 'keyword', backslashEscapes: false }),
  insertDefaultValues: (tableRef) => `INSERT INTO ${tableRef} DEFAULT VALUES`,
  paginate: limitOffset,
};

export const mysqlDialect: SqlDialect = {
  quoteIdentifier: (name) => '`' + name.replace(/`/g, '``') + '`',
  placeholder: () => '?',
  castToText: (expression) => `CAST(${expression} AS CHAR)`,
  // MySQL'in varsayılan collation'ları büyük/küçük harf duyarsızdır.
  caseInsensitiveLike: 'LIKE',
  formatLiteral: (value) =>
    literal(value, { booleans: 'keyword', backslashEscapes: true }),
  insertDefaultValues: (tableRef) => `INSERT INTO ${tableRef} () VALUES ()`,
  paginate: limitOffset,
};

export const sqliteDialect: SqlDialect = {
  quoteIdentifier: quoteDouble,
  placeholder: () => '?',
  castToText: (expression) => `CAST(${expression} AS TEXT)`,
  // SQLite LIKE, ASCII karakterlerde büyük/küçük harf duyarsızdır.
  caseInsensitiveLike: 'LIKE',
  formatLiteral: (value) =>
    literal(value, { booleans: 'number', backslashEscapes: false }),
  insertDefaultValues: (tableRef) => `INSERT INTO ${tableRef} DEFAULT VALUES`,
  paginate: limitOffset,
};

export const mssqlDialect: SqlDialect = {
  quoteIdentifier: (name) => `[${name.replace(/]/g, ']]')}]`,
  placeholder: (index) => `@p${index}`,
  castToText: (expression) => `CAST(${expression} AS NVARCHAR(MAX))`,
  // Varsayılan collation (CI) büyük/küçük harf duyarsızdır.
  caseInsensitiveLike: 'LIKE',
  formatLiteral: (value) =>
    typeof value === 'string'
      ? `N${literal(value, { booleans: 'number', backslashEscapes: false })}`
      : literal(value, { booleans: 'number', backslashEscapes: false }),
  insertDefaultValues: (tableRef) => `INSERT INTO ${tableRef} DEFAULT VALUES`,
  // OFFSET/FETCH bir ORDER BY gerektirir.
  paginate: (limit, offset, hasOrderBy) =>
    `${hasOrderBy ? '' : ' ORDER BY (SELECT NULL)'} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
};

export const oracleDialect: SqlDialect = {
  quoteIdentifier: quoteDouble,
  // oracledb konumsal bağlamada adlar değil sıra kullanılır: :1, :2…
  placeholder: (index) => `:${index}`,
  // ILIKE yok: her iki taraf UPPER ile karşılaştırılır.
  castToText: (expression) => `UPPER(TO_CHAR(${expression}))`,
  caseInsensitiveLike: 'LIKE',
  likeParameter: (placeholder) => `UPPER(${placeholder})`,
  formatLiteral: (value) =>
    literal(value, { booleans: 'number', backslashEscapes: false }),
  // Oracle'da DEFAULT VALUES yok; bir kolonu DEFAULT ile vermek gerekir.
  insertDefaultValues: (tableRef, firstColumn) =>
    `INSERT INTO ${tableRef} (${firstColumn}) VALUES (DEFAULT)`,
  // 12c+: ORDER BY gerektirmeyen OFFSET/FETCH.
  paginate: (limit, offset) => ` OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`,
};

/**
 * Db2 for i (IBM i / AS400). Tipsiz `?` fonksiyon argümanı olamaz (SQL0418);
 * bu yüzden LIKE parametresi önce VARCHAR'a çevrilir.
 */
export const db2iDialect: SqlDialect = {
  quoteIdentifier: quoteDouble,
  placeholder: () => '?',
  castToText: (expression) => `UPPER(CAST(${expression} AS VARCHAR(4000)))`,
  caseInsensitiveLike: 'LIKE',
  likeParameter: (placeholder) => `UPPER(CAST(${placeholder} AS VARCHAR(4000)))`,
  formatLiteral: (value) =>
    literal(value, { booleans: 'number', backslashEscapes: false }),
  insertDefaultValues: (tableRef, firstColumn) =>
    `INSERT INTO ${tableRef} (${firstColumn}) VALUES (DEFAULT)`,
  // 7.1 TR11 / 7.2 ve üzeri.
  paginate: (limit, offset) => ` OFFSET ${offset} ROWS FETCH FIRST ${limit} ROWS ONLY`,
};

export const clickhouseDialect: SqlDialect = {
  quoteIdentifier: (name) => '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`',
  placeholder: (index) => `{p${index}:String}`,
  castToText: (expression) => `toString(${expression})`,
  caseInsensitiveLike: 'ILIKE',
  formatLiteral: (value) =>
    literal(value, { booleans: 'number', backslashEscapes: true }),
  insertDefaultValues: (tableRef) => `INSERT INTO ${tableRef} VALUES ()`,
  paginate: limitOffset,
};

/**
 * Önizleme için parametre yer tutucularını SQL sabitleriyle değiştirir.
 * Yalnızca kullanıcıya gösterilir; çalıştırmada parametreler ayrı gönderilir.
 */
export function renderStatement(
  dialect: SqlDialect,
  sql: string,
  parameters: unknown[],
): string {
  const usesNumbered = dialect.placeholder(1) !== dialect.placeholder(2);

  if (!usesNumbered) {
    let index = 0;
    return sql.replace(/\?/g, () => dialect.formatLiteral(parameters[index++]));
  }

  // $1, @p1, {p1:String} biçimleri; büyük numaralar önce (ör. $10, $1'den önce).
  let rendered = sql;

  for (let index = parameters.length; index >= 1; index--) {
    rendered = rendered
      .split(dialect.placeholder(index))
      .join(dialect.formatLiteral(parameters[index - 1]));
  }

  return rendered;
}
