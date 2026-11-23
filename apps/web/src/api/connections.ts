import type {
  ApiMessage,
  ColumnsResponse,
  CompletionMetadata,
  ConnectionProfile,
  ConnectionTestResponse,
  CreateConnectionPayload,
  ExecuteQueryPayload,
  ExecuteQueryResponse,
  SchemasResponse,
  TableDataPayload,
  TableDataResponse,
  TablesResponse,
  UpdateConnectionPayload,
} from '@tukaka/contracts';

import { jsonBody, request } from './client';

const enc = encodeURIComponent;

export const connectionsApi = {
  findAll: () => request<ConnectionProfile[]>('/connections'),

  findOne: (id: string) => request<ConnectionProfile>(`/connections/${id}`),

  create: (payload: CreateConnectionPayload) =>
    request<ConnectionProfile>('/connections', {
      method: 'POST',
      ...jsonBody(payload),
    }),

  update: (id: string, payload: UpdateConnectionPayload) =>
    request<ConnectionProfile>(`/connections/${id}`, {
      method: 'PATCH',
      ...jsonBody(payload),
    }),

  remove: (id: string) =>
    request<ApiMessage>(`/connections/${id}`, { method: 'DELETE' }),

  setCredential: (id: string, password: string) =>
    request<ApiMessage>(`/connections/${id}/credential`, {
      method: 'POST',
      ...jsonBody({ password }),
    }),

  deleteCredential: (id: string) =>
    request<ApiMessage>(`/connections/${id}/credential`, { method: 'DELETE' }),

  testConnection: (id: string) =>
    request<ConnectionTestResponse>(`/connections/${id}/test`, {
      method: 'POST',
    }),

  getSchemas: (id: string) =>
    request<SchemasResponse>(`/connections/${id}/schemas`),

  getTables: (id: string, schema: string) =>
    request<TablesResponse>(`/connections/${id}/schemas/${enc(schema)}/tables`),

  getColumns: (id: string, schema: string, table: string) =>
    request<ColumnsResponse>(
      `/connections/${id}/schemas/${enc(schema)}/tables/${enc(table)}/columns`,
    ),

  getTableData: (
    id: string,
    schema: string,
    table: string,
    payload: TableDataPayload,
  ) =>
    request<TableDataResponse>(
      `/connections/${id}/schemas/${enc(schema)}/tables/${enc(table)}/data`,
      { method: 'POST', ...jsonBody(payload) },
    ),

  getCompletion: (id: string) =>
    request<CompletionMetadata>(`/connections/${id}/completion`),

  executeQuery: (id: string, payload: ExecuteQueryPayload) =>
    request<ExecuteQueryResponse>(`/connections/${id}/query`, {
      method: 'POST',
      ...jsonBody(payload),
    }),
};
