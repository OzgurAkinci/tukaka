import type {
  ApiMessage,
  CancelQueryResponse,
  CreateSavedQueryPayload,
  QueryHistoryEntry,
  QueryHistoryQuery,
  SavedQuery,
  UpdateSavedQueryPayload,
} from '@tukaka/contracts';

import { jsonBody, request } from './client';

function toQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }

  const text = search.toString();
  return text ? `?${text}` : '';
}

export const queriesApi = {
  cancel: (queryId: string) =>
    request<CancelQueryResponse>(`/queries/${queryId}/cancel`, {
      method: 'POST',
    }),

  history: (query: QueryHistoryQuery = {}) =>
    request<QueryHistoryEntry[]>(
      `/history${toQueryString({
        connectionId: query.connectionId,
        search: query.search,
        limit: query.limit,
      })}`,
    ),

  deleteHistoryEntry: (id: number) =>
    request<ApiMessage>(`/history/${id}`, { method: 'DELETE' }),

  clearHistory: (connectionId?: string) =>
    request<ApiMessage>(`/history${toQueryString({ connectionId })}`, {
      method: 'DELETE',
    }),

  savedQueries: () => request<SavedQuery[]>('/saved-queries'),

  createSavedQuery: (payload: CreateSavedQueryPayload) =>
    request<SavedQuery>('/saved-queries', {
      method: 'POST',
      ...jsonBody(payload),
    }),

  updateSavedQuery: (id: string, payload: UpdateSavedQueryPayload) =>
    request<SavedQuery>(`/saved-queries/${id}`, {
      method: 'PATCH',
      ...jsonBody(payload),
    }),

  deleteSavedQuery: (id: string) =>
    request<ApiMessage>(`/saved-queries/${id}`, { method: 'DELETE' }),
};
