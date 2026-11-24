/**
 * TUKAKA Database Studio — paylaşılan API sözleşmeleri.
 *
 * Bu dosya yalnızca tip içerir; her iki taraf da `import type` ile kullanır.
 */

// ---------------------------------------------------------------------------
// Bağlantılar
// ---------------------------------------------------------------------------

export type DatabaseType =
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'sqlite'
  | 'mssql'
  | 'clickhouse'
  | 'oracle'
  /** IBM i (AS400) — Db2 for i, jt400 JDBC köprüsüyle. */
  | 'db2i';

/** SSH tüneli ayarları (bağlantının `options_json` alanında saklanır). */
export interface SshTunnelConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  /** `privateKey` yönteminde anahtar dosyasının yolu. */
  privateKeyPath?: string;
}

/** Bağlantıya özgü ek ayarlar (`options_json`). */
export interface ConnectionOptions {
  ssh?: SshTunnelConfig;
}

export type SslMode =
  | 'disable'
  | 'prefer'
  | 'require'
  | 'verify-ca'
  | 'verify-full';

export interface ConnectionProfile {
  id: string;
  name: string;
  type: DatabaseType;
  host: string | null;
  port: number | null;
  database: string;
  username: string | null;
  credential_key: string | null;
  ssl_mode: string;
  options_json: string;
  created_at: string;
  updated_at: string;
  last_connected_at: string | null;
}

export interface CreateConnectionPayload {
  name: string;
  type: DatabaseType;
  database: string;
  host?: string;
  port?: number;
  username?: string;
  sslMode?: SslMode;
  options?: ConnectionOptions;
}

export interface SetCredentialPayload {
  /** Veritabanı şifresi. */
  password?: string;
  /** SSH şifresi ya da özel anahtar parolası. */
  sshSecret?: string;
}

export type UpdateConnectionPayload = Partial<
  Omit<CreateConnectionPayload, 'type'>
>;

export interface ApiMessage {
  success: boolean;
  message: string;
}

export interface ConnectionTestResponse extends ApiMessage {
  connectionId: string;
}

// ---------------------------------------------------------------------------
// Sorgu çalıştırma
// ---------------------------------------------------------------------------

export interface ExecuteQueryPayload {
  sql: string;
  parameters?: unknown[];
  /** Döndürülecek en fazla satır (varsayılan 1000). */
  maxRows?: number;
  /** Zaman aşımı, ms (varsayılan 30000). SQLite için uygulanmaz. */
  timeoutMs?: number;
  /** İstemcinin ürettiği kimlik; sorguyu iptal etmek için kullanılır. */
  queryId?: string;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Okumada döndürülen satır sayısı, yazmada etkilenen satır sayısı. */
  rowCount: number;
  durationMs: number;
  /** Sonuç `maxRows` nedeniyle kesildiyse true. */
  truncated: boolean;
  /** Çalıştırılan ifade sayısı (bilinmiyorsa null). */
  statementCount: number | null;
}

export interface ExecuteQueryResponse extends QueryResult {
  success: boolean;
  connectionId: string;
}

export interface CancelQueryResponse {
  success: boolean;
  /** İptal isteği veritabanına iletildiyse true. */
  cancelled: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

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

export interface SchemasResponse {
  success: boolean;
  connectionId: string;
  schemas: DatabaseSchema[];
}

export interface TablesResponse {
  success: boolean;
  connectionId: string;
  schema: string;
  tables: DatabaseTable[];
}

export interface ColumnsResponse {
  success: boolean;
  connectionId: string;
  schema: string;
  table: string;
  columns: DatabaseColumn[];
}

/**
 * Editör otomatik tamamlaması için şema → tablo → kolon listesi.
 */
export interface CompletionMetadata {
  success: boolean;
  connectionId: string;
  /** Nitelendirilmemiş tablo adlarının çözüldüğü şema (ör. `public`, `main`). */
  defaultSchema: string | null;
  schemas: Record<string, Record<string, string[]>>;
  /** Kolon sayısı sınırı aşıldıysa true. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Tablo verisi (Data Viewer)
// ---------------------------------------------------------------------------

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull';

export interface TableFilter {
  column: string;
  operator: FilterOperator;
  /** `isNull` / `isNotNull` için kullanılmaz. */
  value?: string;
}

export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  column: string;
  direction: SortDirection;
}

export interface TableDataPayload {
  limit?: number;
  offset?: number;
  sort?: TableSort;
  filters?: TableFilter[];
  /** Toplam satır sayısını da hesapla (COUNT(*)). Varsayılan true. */
  includeTotal?: boolean;
}

export interface TableDataResponse {
  success: boolean;
  connectionId: string;
  schema: string;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  limit: number;
  offset: number;
  /** Filtreye uyan toplam satır sayısı (istenmediyse null). */
  totalCount: number | null;
  /** Bu sayfadan sonra satır var mı? */
  hasMore: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Sorgu geçmişi ve kayıtlı sorgular
// ---------------------------------------------------------------------------

export interface QueryHistoryEntry {
  id: number;
  connectionId: string | null;
  connectionName: string | null;
  sql: string;
  status: 'success' | 'error';
  errorMessage: string | null;
  rowCount: number | null;
  durationMs: number | null;
  executedAt: string;
}

export interface QueryHistoryQuery {
  connectionId?: string;
  search?: string;
  limit?: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  connectionId: string | null;
  sql: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedQueryPayload {
  name: string;
  sql: string;
  connectionId?: string | null;
}

export type UpdateSavedQueryPayload = Partial<CreateSavedQueryPayload>;

// ---------------------------------------------------------------------------
// Tablo ayrıntıları, rutinler, DDL
// ---------------------------------------------------------------------------

export interface DatabaseIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface DatabaseForeignKey {
  name: string;
  table: string;
  columns: string[];
  referencedSchema: string;
  referencedTable: string;
  referencedColumns: string[];
}

export interface TableDetailsResponse {
  success: boolean;
  connectionId: string;
  schema: string;
  table: string;
  indexes: DatabaseIndex[];
  foreignKeys: DatabaseForeignKey[];
  ddl: string | null;
}

export interface DatabaseRoutine {
  name: string;
  schema: string;
  type: 'function' | 'procedure';
  /** Aşırı yüklenmiş fonksiyonları ayırt etmek için kimlik (ör. PG oid). */
  id: string;
  arguments: string | null;
  returnType: string | null;
}

export interface RoutinesResponse {
  success: boolean;
  connectionId: string;
  schema: string;
  routines: DatabaseRoutine[];
}

export interface RoutineDefinitionResponse {
  success: boolean;
  connectionId: string;
  definition: string;
}

// ---------------------------------------------------------------------------
// Satır düzenleme
// ---------------------------------------------------------------------------

export type RowChange =
  | { type: 'insert'; values: Record<string, unknown> }
  | {
      type: 'update';
      /** Birincil anahtar kolonları ve satırın orijinal değerleri. */
      key: Record<string, unknown>;
      values: Record<string, unknown>;
    }
  | { type: 'delete'; key: Record<string, unknown> };

export interface ApplyChangesPayload {
  changes: RowChange[];
  /** true ise SQL yalnızca üretilir, çalıştırılmaz (önizleme). */
  dryRun?: boolean;
}

export interface ApplyChangesResponse {
  success: boolean;
  /** Önizleme için parametreleri yerleştirilmiş SQL ifadeleri. */
  statements: string[];
  /** Çalıştırıldıysa ifade başına etkilenen satır sayısı. */
  affectedRows: number[] | null;
}

// ---------------------------------------------------------------------------
// EXPLAIN ve ER diyagramı
// ---------------------------------------------------------------------------

export interface ExplainPlanNode {
  id: string;
  label: string;
  detail: string | null;
  /** Tahmini toplam maliyet (veritabanının biriminde). */
  cost: number | null;
  /** Tahmini satır sayısı. */
  rows: number | null;
  children: ExplainPlanNode[];
}

export interface ExplainPayload {
  sql: string;
}

export interface ExplainResponse {
  success: boolean;
  connectionId: string;
  nodes: ExplainPlanNode[];
  /** Veritabanının döndürdüğü ham plan (metin ya da JSON). */
  raw: string;
}

export interface ErTable {
  name: string;
  type: 'table' | 'view';
  columns: Array<
    Pick<DatabaseColumn, 'name' | 'dataType' | 'isPrimaryKey' | 'isForeignKey' | 'nullable'>
  >;
}

export interface ErDiagramResponse {
  success: boolean;
  connectionId: string;
  schema: string;
  tables: ErTable[];
  relationships: DatabaseForeignKey[];
  /** Tablo sayısı sınırı aşıldıysa true. */
  truncated: boolean;
}
