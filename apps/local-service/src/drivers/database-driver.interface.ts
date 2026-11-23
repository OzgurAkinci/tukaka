
import type {
  ConnectionProfile,
  DatabaseColumn,
  DatabaseSchema,
  DatabaseTable,
  QueryResult,
} from '@tukaka/contracts';

export type {
  DatabaseColumn,
  DatabaseSchema,
  DatabaseTable,
  QueryResult,
} from '@tukaka/contracts';

export interface QueryOptions {
  /**
   * Arayüze döndürülecek en fazla satır sayısı.
   */
  maxRows: number;
  /**
   * Sorgu zaman aşımı (milisaniye).
   */
  timeoutMs: number;
  /**
   * Sürücü sorguyu başlattığında, sorguyu iptal edecek fonksiyonu bildirir.
   * İptali desteklemeyen sürücüler (SQLite) bunu hiç çağırmaz.
   */
  onCancelAvailable?: (cancel: () => Promise<void>) => void;
}

export const DEFAULT_QUERY_OPTIONS = {
  maxRows: 1000,
  timeoutMs: 30_000,
} as const;

export interface CompletionData {
  defaultSchema: string | null;
  schemas: Record<string, Record<string, string[]>>;
  truncated: boolean;
}

/**
 * Sürücüye özgü SQL sözdizimi farkları.
 */
export interface SqlDialect {
  /** Tanımlayıcıyı (tablo/kolon adı) güvenli şekilde tırnaklar. */
  quoteIdentifier: (name: string) => string;
  /** 1 tabanlı parametre yer tutucusu ($1 ya da ?). */
  placeholder: (index: number) => string;
  /** İfadeyi metne dönüştürür (LIKE karşılaştırmaları için). */
  castToText: (expression: string) => string;
  /** Büyük/küçük harf duyarsız LIKE operatörü. */
  caseInsensitiveLike: string;
}

export interface DatabaseDriver {
  readonly dialect: SqlDialect;

  /** Çalışan sorgular iptal edilebilir mi? */
  readonly supportsCancel: boolean;

  /**
   * Veritabanına bağlantıyı test eder.
   */
  testConnection(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<void>;

  /**
   * SQL sorgusunu çalıştırır ve sonucu döndürür.
   */
  executeQuery(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
    parameters: unknown[],
    options: QueryOptions,
  ): Promise<QueryResult>;

  /**
   * Bağlantıdaki schema listesini getirir.
   */
  getSchemas(
    connection: ConnectionProfile,
    password: string | null,
  ): Promise<DatabaseSchema[]>;

  /**
   * Belirtilen schema içerisindeki tablo ve view listesini getirir.
   */
  getTables(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseTable[]>;

  /**
   * Belirtilen tablonun kolon metadata bilgilerini getirir.
   */
  getColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseColumn[]>;

  /**
   * Editör otomatik tamamlaması için şema/tablo/kolon adlarını getirir.
   */
  getCompletionData(
    connection: ConnectionProfile,
    password: string | null,
    maxColumns: number,
  ): Promise<CompletionData>;

  /**
   * Bağlantıya ait havuzu / açık handle'ı kapatır.
   */
  release(connectionId: string): Promise<void>;

  /**
   * Tüm havuzları kapatır (servis kapanırken).
   */
  releaseAll(): Promise<void>;
}

/**
 * Düz (şema, tablo, kolon) satırlarını iç içe yapıya çevirir.
 */
export function groupCompletionRows(
  rows: Array<{ schema: string; table: string; column: string }>,
  maxColumns: number,
): Pick<CompletionData, 'schemas' | 'truncated'> {
  const schemas: CompletionData['schemas'] = {};

  for (const row of rows.slice(0, maxColumns)) {
    const tables = (schemas[row.schema] ??= {});
    (tables[row.table] ??= []).push(row.column);
  }

  return { schemas, truncated: rows.length > maxColumns };
}
