
import type { DatabaseType } from '../components/ConnectionDialog';

const API_BASE_URL =
    import.meta.env.VITE_LOCAL_SERVICE_URL ??
    'http://127.0.0.1:4317';

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
    sslMode?: string;
}

export type UpdateConnectionPayload =
    Partial<CreateConnectionPayload>;

export interface QueryResult {
    success: boolean;
    connectionId: string;
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    durationMs: number;
    truncated: boolean;
    statementCount: number | null;
}


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

export interface ColumnsResponse {
    success: boolean;
    connectionId: string;
    schema: string;
    table: string;
    columns: DatabaseColumn[];
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


export interface ExecuteQueryPayload {
    sql: string;
    parameters?: unknown[];
    maxRows?: number;
    timeoutMs?: number;
}

/**
 * NestJS hata gövdesinden ({ message, error, statusCode }) okunabilir mesaj çıkarır.
 */
async function readErrorMessage(response: Response): Promise<string> {
    const body = await response.text();

    try {
        const parsed = JSON.parse(body) as { message?: unknown };

        if (Array.isArray(parsed.message)) {
            return parsed.message.join('\n');
        }

        if (typeof parsed.message === 'string' && parsed.message) {
            return parsed.message;
        }
    } catch {
        // JSON değil; ham metni kullan.
    }

    return body || `API error: ${response.status}`;
}

function getSessionToken(): string | undefined {
    return (
        window.desktopAPI?.sessionToken ??
        import.meta.env.VITE_LOCAL_SERVICE_TOKEN ??
        undefined
    );
}

async function request<T>(
    endpoint: string,
    options: RequestInit = {},
): Promise<T> {
    const sessionToken = getSessionToken();

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(sessionToken && {
                Authorization: `Bearer ${sessionToken}`,
            }),
            ...options.headers,
        },
    });

    if (!response.ok) {
        throw new Error(
            await readErrorMessage(response),
        );
    }

    if (response.status === 204) {
        return undefined as T;
    }

    return response.json() as Promise<T>;
}

export const connectionsApi = {
    findAll(): Promise<ConnectionProfile[]> {
        return request<ConnectionProfile[]>('/connections');
    },

    findOne(id: string): Promise<ConnectionProfile> {
        return request<ConnectionProfile>(
            `/connections/${id}`,
        );
    },

    create(
        payload: CreateConnectionPayload,
    ): Promise<ConnectionProfile> {
        return request<ConnectionProfile>('/connections', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },

    update(
        id: string,
        payload: UpdateConnectionPayload,
    ): Promise<ConnectionProfile> {
        return request<ConnectionProfile>(
            `/connections/${id}`,
            {
                method: 'PATCH',
                body: JSON.stringify(payload),
            },
        );
    },

    remove(id: string): Promise<{
        success: boolean;
        message: string;
    }> {
        return request(`/connections/${id}`, {
            method: 'DELETE',
        });
    },

    setCredential(
        id: string,
        password: string,
    ): Promise<{ success: boolean; message: string }> {
        return request(`/connections/${id}/credential`, {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
    },

    deleteCredential(
        id: string,
    ): Promise<{ success: boolean; message: string }> {
        return request(`/connections/${id}/credential`, {
            method: 'DELETE',
        });
    },

    testConnection(
        id: string,
    ): Promise<{
        success: boolean;
        message: string;
        connectionId: string;
    }> {
        return request(`/connections/${id}/test`, {
            method: 'POST',
        });
    },


    getSchemas(
        id: string,
    ): Promise<SchemasResponse> {
        return request<SchemasResponse>(
            `/connections/${id}/schemas`,
        );
    },

    getTables(
        id: string,
        schema: string,
    ): Promise<TablesResponse> {
        return request<TablesResponse>(
            `/connections/${id}/schemas/${encodeURIComponent(schema)}/tables`,
        );
    },


    getColumns(
        id: string,
        schema: string,
        table: string,
    ): Promise<ColumnsResponse> {
        return request<ColumnsResponse>(
            `/connections/${id}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/columns`,
        );
    },



    executeQuery(
        id: string,
        payload: ExecuteQueryPayload,
    ): Promise<QueryResult> {
        return request<QueryResult>(`/connections/${id}/query`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    },
};
