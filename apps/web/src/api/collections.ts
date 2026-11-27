import type {
  ApiMessage,
  ConnectionCollection,
  CreateCollectionPayload,
  UpdateCollectionPayload,
} from '@tukaka/contracts';

import { jsonBody, request } from './client';

export const collectionsApi = {
  findAll: () => request<ConnectionCollection[]>('/collections'),

  create: (payload: CreateCollectionPayload) =>
    request<ConnectionCollection>('/collections', {
      method: 'POST',
      ...jsonBody(payload),
    }),

  update: (id: string, payload: UpdateCollectionPayload) =>
    request<ConnectionCollection>(`/collections/${id}`, {
      method: 'PATCH',
      ...jsonBody(payload),
    }),

  remove: (id: string) =>
    request<ApiMessage>(`/collections/${id}`, { method: 'DELETE' }),
};
