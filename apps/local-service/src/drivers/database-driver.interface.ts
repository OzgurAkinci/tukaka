
import type {
  ConnectionProfile,
  DatabaseColumn,
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseRoutine,
  DatabaseSchema,
  DatabaseTable,
  ErTable,
  ExplainPlanNode,
  QueryResult,
} from '@tukaka/contracts';

export type {
  DatabaseColumn,
  DatabaseForeignKey,
  DatabaseIndex,
  DatabaseRoutine,
  DatabaseSchema,
  DatabaseTable,
  ErTable,
  ExplainPlanNode,
  QueryResult,
} from '@tukaka/contracts';

/** Transaction içinde çalıştırılacak parametreli ifade. */
export interface ParameterizedStatement {
  sql: string;
  parameters: unknown[];
  /**
   * Verilirse, ifade tam olarak bu kadar satırı etkilemelidir; aksi halde
   * transaction geri alınır (ör. birincil anahtarla güncelleme = 1 satır).
   */
  expectedRows?: number;
}

/** expectedRows denetimi; tüm sürücüler transaction içinde çağırır. */
export function assertAffectedRows(
  statement: ParameterizedStatement,
  affected: number,
  index: number,
): void {
  if (statement.expectedRows !== undefined && affected !== statement.expectedRows) {
    throw new Error(
      `Statement ${index + 1} affected ${affected} row(s) instead of ${statement.expectedRows}. ` +
        'The row may have been changed or deleted by someone else. No changes were saved.',
    );
  }
}

export interface ExplainResult {
  nodes: ExplainPlanNode[];
  raw: string;
}

/** ER diyagramı ve şema geneli işlemler için kolon satırı. */
export type SchemaColumnRow = ErTable['columns'][number] & { table: string };

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
  /** Önizleme için değeri SQL sabitine çevirir (çalıştırmada kullanılmaz). */
  formatLiteral: (value: unknown) => string;
  /** Hiç kolon verilmeden satır ekleme sözdizimi. */
  insertDefaultValues: (tableRef: string) => string;
  /** Sayfalama: LIMIT/OFFSET ya da OFFSET/FETCH. */
  paginate: (limit: number, offset: number, hasOrderBy: boolean) => string;
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

  /** Tablonun indeksleri. */
  getIndexes(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<DatabaseIndex[]>;

  /** Şemadaki (ya da yalnızca verilen tablodaki) yabancı anahtarlar. */
  getForeignKeys(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table?: string,
  ): Promise<DatabaseForeignKey[]>;

  /** Şemadaki tüm tabloların kolonları (ER diyagramı için). */
  getSchemaColumns(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<SchemaColumnRow[]>;

  /** Tablo ya da view için CREATE ifadesi (üretilemiyorsa null). */
  getTableDdl(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    table: string,
  ): Promise<string | null>;

  /** Şemadaki fonksiyon ve prosedürler. */
  getRoutines(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
  ): Promise<DatabaseRoutine[]>;

  /** Fonksiyon/prosedür tanımı. */
  getRoutineDefinition(
    connection: ConnectionProfile,
    password: string | null,
    schema: string,
    routine: Pick<DatabaseRoutine, 'id' | 'name' | 'type'>,
  ): Promise<string>;

  /**
   * Sorgu planını getirir. Sorgu ÇALIŞTIRILMAZ (ANALYZE yok) ve yalnızca tek
   * ifadeye izin verilir.
   */
  explain(
    connection: ConnectionProfile,
    password: string | null,
    sql: string,
  ): Promise<ExplainResult>;

  /**
   * İfadeleri tek transaction içinde çalıştırır; ifade başına etkilenen satır
   * sayısını döndürür. Hata olursa tümü geri alınır.
   */
  executeInTransaction(
    connection: ConnectionProfile,
    password: string | null,
    statements: ParameterizedStatement[],
  ): Promise<number[]>;

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
