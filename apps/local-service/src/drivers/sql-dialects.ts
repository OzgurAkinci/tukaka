
import type { SqlDialect } from './database-driver.interface';

const quoteDouble = (name: string) => `"${name.replace(/"/g, '""')}"`;

export const postgresDialect: SqlDialect = {
  quoteIdentifier: quoteDouble,
  placeholder: (index) => `$${index}`,
  castToText: (expression) => `CAST(${expression} AS TEXT)`,
  caseInsensitiveLike: 'ILIKE',
};

export const mysqlDialect: SqlDialect = {
  quoteIdentifier: (name) => '`' + name.replace(/`/g, '``') + '`',
  placeholder: () => '?',
  castToText: (expression) => `CAST(${expression} AS CHAR)`,
  // MySQL'in varsayılan collation'ları büyük/küçük harf duyarsızdır.
  caseInsensitiveLike: 'LIKE',
};

export const sqliteDialect: SqlDialect = {
  quoteIdentifier: quoteDouble,
  placeholder: () => '?',
  castToText: (expression) => `CAST(${expression} AS TEXT)`,
  // SQLite LIKE, ASCII karakterlerde büyük/küçük harf duyarsızdır.
  caseInsensitiveLike: 'LIKE',
};
