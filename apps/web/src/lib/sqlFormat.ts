import { format, type SqlLanguage } from 'sql-formatter';
import type { DatabaseType } from '@tukaka/contracts';

/** Bağlantı tipinin sql-formatter karşılığı. */
const languages: Record<DatabaseType, SqlLanguage> = {
  postgresql: 'postgresql',
  mysql: 'mysql',
  mariadb: 'mariadb',
  sqlite: 'sqlite',
  mssql: 'transactsql',
  clickhouse: 'clickhouse',
  oracle: 'plsql',
  db2i: 'db2i',
};

/**
 * SQL'i biçimlendirir: anahtar kelimeler büyük harf, 2 boşluk girinti.
 * Diyalekt metni ayrıştıramazsa standart SQL ile yeniden denenir; o da
 * başarısız olursa hata fırlatılır.
 */
export function formatSql(text: string, databaseType?: DatabaseType | null): string {
  const options = {
    keywordCase: 'upper',
    dataTypeCase: 'upper',
    functionCase: 'upper',
    tabWidth: 2,
    linesBetweenQueries: 1,
  } as const;

  const language = databaseType ? languages[databaseType] : 'sql';

  try {
    return format(text, { ...options, language });
  } catch (error) {
    if (language === 'sql') throw error;
    return format(text, { ...options, language: 'sql' });
  }
}
