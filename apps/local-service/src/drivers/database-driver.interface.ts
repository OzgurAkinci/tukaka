
import { ConnectionProfile } from '../connections/connections.service';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  /**
   * Okuma sorgularında döndürülen satır sayısı (limit uygulanmış),
   * yazma sorgularında etkilenen satır sayısı.
   */
  rowCount: number;
  durationMs: number;
  /**
   * Sonuç `maxRows` sınırı nedeniyle kesildiyse true.
   */
  truncated: boolean;
  /**
   * Gönderilen SQL içindeki çalıştırılan ifade sayısı (bilinmiyorsa null).
   * Birden fazla ifade varsa sonuç olarak son ifadenin sonucu döner.
   */
  statementCount: number | null;
}

export interface QueryOptions {
  /**
   * Arayüze döndürülecek en fazla satır sayısı.
   */
  maxRows: number;
  /**
   * Sorgu zaman aşımı (milisaniye).
   */
  timeoutMs: number;
}

export const DEFAULT_QUERY_OPTIONS: QueryOptions = {
  maxRows: 1000,
  timeoutMs: 30_000,
};

export interface DatabaseSchema {
  name: string;
}

export interface DatabaseTable {
  name: string;
  schema: string;
  type: 'table' | 'view';
}

export interface DatabaseColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  position: number;
}

export interface DatabaseDriver {
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
   * Bağlantıya ait havuzu / açık handle'ı kapatır.
   */
  release(connectionId: string): Promise<void>;

  /**
   * Tüm havuzları kapatır (servis kapanırken).
   */
  releaseAll(): Promise<void>;
}
