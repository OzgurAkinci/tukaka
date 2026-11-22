
import { ConnectionProfile } from '../connections/connections.service';

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  durationMs: number;
}

export interface DatabaseSchema {
  name: string;
}

export interface DatabaseTable {
  name: string;
  schema: string;
  type: 'table' | 'view';
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
    parameters?: unknown[],
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
}
