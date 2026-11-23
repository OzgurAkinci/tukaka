import type { ConnectionProfile } from '../connections/connections.service';

export function makeProfile(
  overrides: Partial<ConnectionProfile> = {},
): ConnectionProfile {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test',
    type: 'sqlite',
    host: null,
    port: null,
    database: ':memory:',
    username: null,
    credential_key: null,
    ssl_mode: 'prefer',
    options_json: '{}',
    created_at: '',
    updated_at: '',
    last_connected_at: null,
    ...overrides,
  };
}
