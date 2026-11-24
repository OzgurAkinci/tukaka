import { useState } from 'react';
import { ChevronDown, ChevronRight, Database, FilePlus2, FolderOpen, X } from 'lucide-react';

import type {
  ConnectionOptions,
  DatabaseType,
  SshTunnelConfig,
  SslMode,
} from '@tukaka/contracts';

import { errorMessage } from '../api/client';
import { connectionsApi } from '../api/connections';
import { databaseGroups, databases, databaseTypes, type DatabaseGroup } from '../lib/databases';

export type { DatabaseType, SslMode };

const sslModes: ReadonlyArray<[SslMode, string, string]> = [
  ['disable', 'Disable', 'Never use SSL.'],
  ['prefer', 'Prefer', 'Use SSL if the server supports it, otherwise connect without it. The certificate is not validated.'],
  ['require', 'Require', 'Always use SSL, but do not validate the server certificate.'],
  ['verify-ca', 'Verify CA', 'Always use SSL and validate the certificate chain (host name is not checked).'],
  ['verify-full', 'Verify Full', 'Always use SSL and validate both the certificate chain and the host name.'],
];

function toSslMode(value: string | undefined): SslMode {
  return sslModes.some(([mode]) => mode === value) ? (value as SslMode) : 'prefer';
}

export interface ConnectionConfig {
  name: string;
  type: DatabaseType;
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  sslMode?: SslMode;
  /** SSH tüneli ayarları; kapalıysa `enabled: false`. */
  ssh?: SshTunnelConfig;
  /** SSH şifresi ya da özel anahtar parolası (boşsa değişmez). */
  sshSecret?: string;
}

interface ConnectionDialogProps {
  onClose: () => void;
  onSave: (config: ConnectionConfig) => void;
  initialConfig?: {
    name: string;
    type: DatabaseType;
    host?: string | null;
    port?: number | null;
    database: string;
    username?: string | null;
    ssl_mode?: string;
    options_json?: string;
  };
}

function parseOptions(json: string | undefined): ConnectionOptions {
  try {
    return json ? (JSON.parse(json) as ConnectionOptions) : {};
  } catch {
    return {};
  }
}

const inputClass =
  'w-full rounded-md border border-(--c-343a46) bg-(--c-171b24) px-3 py-2 text-sm text-(--c-d5d8df) outline-none transition focus:border-blue-500';
const labelClass = 'mb-1.5 block text-xs font-medium text-(--c-9ca3af)';
const hintClass = 'mt-1.5 text-[11px] text-(--c-737d8d)';
const sideButtonClass =
  'flex shrink-0 items-center gap-1.5 rounded-md border border-(--c-343a46) px-3 text-xs text-gray-300 hover:bg-(--c-252b36)';

export default function ConnectionDialog({
  onClose,
  onSave,
  initialConfig,
}: ConnectionDialogProps) {
  const isEditMode = Boolean(initialConfig);
  const initialType = initialConfig?.type ?? 'postgresql';
  const initialSsh = parseOptions(initialConfig?.options_json).ssh;

  const [type, setType] = useState<DatabaseType>(initialType);
  const [name, setName] = useState(initialConfig?.name ?? `Local ${databases[initialType].label}`);
  const [host, setHost] = useState(initialConfig?.host ?? 'localhost');
  const [port, setPort] = useState(String(initialConfig?.port ?? databases[initialType].defaultPort));
  const [database, setDatabase] = useState(
    initialConfig?.database ?? databases[initialType].defaultDatabase,
  );
  const [username, setUsername] = useState(
    initialConfig?.username ?? databases[initialType].defaultUsername,
  );
  const [password, setPassword] = useState('');
  const [sslMode, setSslMode] = useState<SslMode>(toSslMode(initialConfig?.ssl_mode));

  const [sshOpen, setSshOpen] = useState(Boolean(initialSsh?.enabled));
  const [ssh, setSsh] = useState<SshTunnelConfig>(
    initialSsh ?? {
      enabled: false,
      host: '',
      port: 22,
      username: '',
      authMethod: 'password',
      privateKeyPath: '',
    },
  );
  const [sshSecret, setSshSecret] = useState('');
  const [hostKeyMessage, setHostKeyMessage] = useState<string | null>(null);

  const forgetHostKey = async () => {
    if (
      !window.confirm(
        `Forget the saved host key for ${ssh.host}:${ssh.port}? The next connection will trust whatever key the server presents.`,
      )
    ) {
      return;
    }

    try {
      const result = await connectionsApi.forgetSshHostKey(ssh.host, ssh.port);
      setHostKeyMessage(result.message);
    } catch (error) {
      setHostKeyMessage(errorMessage(error, 'Host key could not be removed.'));
    }
  };

  const info = databases[type];
  const desktop = window.desktopAPI;

  const handleTypeChange = (newType: DatabaseType) => {
    const next = databases[newType];
    setType(newType);
    setPort(String(next.defaultPort));
    setDatabase(next.defaultDatabase);
    setUsername(next.defaultUsername);
    setSslMode('prefer');
    setName(`Local ${next.label}`);
  };

  const updateSsh = (patch: Partial<SshTunnelConfig>) =>
    setSsh((previous) => ({ ...previous, ...patch }));

  const pickFile = async (kind: 'sqlite' | 'sqlite-new' | 'ssh-key') => {
    const path = await desktop?.selectFile?.(kind);
    if (!path) return;

    if (kind === 'ssh-key') updateSsh({ privateKeyPath: path });
    else setDatabase(path);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    onSave({
      name,
      type,
      database,
      ...(info.server && {
        host,
        port: Number(port),
        username,
        ...(password && { password }),
        sslMode,
        ssh: { ...ssh, enabled: ssh.enabled && Boolean(ssh.host && ssh.username) },
        ...(sshSecret && { sshSecret }),
      }),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
      <div className="flex max-h-[92vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-(--c-343a46) bg-(--c-1a1e27) shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-(--c-2b303b) px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Database size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-(--c-e5e7eb)">
                {isEditMode ? 'Edit Connection' : 'New Connection'}
              </h2>
              <p className="mt-0.5 text-xs text-(--c-858d9b)">
                {isEditMode ? 'Update your database connection' : 'Configure your database connection'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded-md p-2 text-(--c-858d9b) hover:bg-(--c-2b303b) hover:text-white"
          >
            <X size={17} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <div>
              <label className={labelClass} htmlFor="connection-type">Database Type</label>
              <div className="flex items-center gap-2">
                <Database size={16} className={`shrink-0 ${info.color}`} aria-hidden />
                <select
                  id="connection-type"
                  value={type}
                  disabled={isEditMode}
                  onChange={(event) => handleTypeChange(event.target.value as DatabaseType)}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-70`}
                >
                  {(Object.keys(databaseGroups) as DatabaseGroup[]).map((group) => (
                    <optgroup key={group} label={databaseGroups[group]}>
                      {databaseTypes
                        .filter((value) => databases[value].group === group)
                        .map((value) => (
                          <option key={value} value={value}>
                            {databases[value].label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <p className={hintClass}>
                {info.description}
                {isEditMode && ' The type of an existing connection cannot be changed.'}
              </p>
            </div>

            <div>
              <label className={labelClass} htmlFor="connection-name">Connection Name</label>
              <input
                id="connection-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My Database"
                className={inputClass}
              />
            </div>

            {!info.server ? (
              <div>
                <label className={labelClass} htmlFor="connection-file">Database File Path</label>
                <div className="flex gap-2">
                  <input
                    id="connection-file"
                    required
                    value={database}
                    onChange={(event) => setDatabase(event.target.value)}
                    placeholder="/Users/username/database.sqlite"
                    className={inputClass}
                  />
                  {desktop?.selectFile && (
                    <>
                      <button
                        type="button"
                        title="Choose an existing database file"
                        onClick={() => void pickFile('sqlite')}
                        className={sideButtonClass}
                      >
                        <FolderOpen size={14} />
                        Browse…
                      </button>
                      <button
                        type="button"
                        title="Create a new empty database file"
                        onClick={() => void pickFile('sqlite-new')}
                        className={sideButtonClass}
                      >
                        <FilePlus2 size={14} />
                        New…
                      </button>
                    </>
                  )}
                </div>
                <p className={hintClass}>
                  {desktop?.selectFile
                    ? 'Choose an existing SQLite file or create a new one.'
                    : 'Enter the path to your SQLite database file.'}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <div>
                    <label className={labelClass} htmlFor="connection-host">Host</label>
                    <input
                      id="connection-host"
                      required
                      value={host}
                      onChange={(event) => setHost(event.target.value)}
                      placeholder="localhost"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="connection-port">Port</label>
                    <input
                      id="connection-port"
                      required
                      type="number"
                      min="1"
                      max="65535"
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>

                {info.portHint && <p className={`${hintClass} -mt-2`}>{info.portHint}</p>}

                <div>
                  <label className={labelClass} htmlFor="connection-database">
                    {info.databaseLabel}
                  </label>
                  <input
                    id="connection-database"
                    required
                    value={database}
                    onChange={(event) => setDatabase(event.target.value)}
                    placeholder={info.databasePlaceholder}
                    className={inputClass}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass} htmlFor="connection-username">Username</label>
                    <input
                      id="connection-username"
                      required
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="Database username"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="connection-password">Password</label>
                    <input
                      id="connection-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={isEditMode ? 'Unchanged' : 'Database password'}
                      className={inputClass}
                    />
                  </div>
                </div>

                {info.supports.ssl && (
                  <div>
                    <label className={labelClass} htmlFor="connection-ssl">SSL Mode</label>
                    <select
                      id="connection-ssl"
                      value={sslMode}
                      onChange={(event) => setSslMode(event.target.value as SslMode)}
                      className={inputClass}
                    >
                      {sslModes.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <p className={hintClass}>
                      {sslMode === 'prefer' && info.sslNoNegotiation
                        ? `${info.label} does not negotiate SSL automatically, so Prefer connects without SSL. Choose Require to use TLS.`
                        : sslModes.find(([value]) => value === sslMode)?.[2]}
                    </p>
                  </div>
                )}

                {/* SSH tüneli */}
                <div className="rounded-md border border-(--c-2b303b)">
                  <button
                    type="button"
                    onClick={() => setSshOpen((open) => !open)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-xs text-gray-300"
                  >
                    <span className="flex items-center gap-2">
                      {sshOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      SSH tunnel
                    </span>
                    <span className={ssh.enabled ? 'text-emerald-400' : 'text-gray-600'}>
                      {ssh.enabled ? 'Enabled' : 'Off'}
                    </span>
                  </button>

                  {sshOpen && (
                    <div className="space-y-3 border-t border-(--c-2b303b) p-3">
                      <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={ssh.enabled}
                          onChange={(event) => updateSsh({ enabled: event.target.checked })}
                        />
                        Connect through an SSH server
                      </label>

                      {ssh.enabled && (
                        <>
                          <div className="grid grid-cols-[1fr_100px] gap-3">
                            <div>
                              <label className={labelClass} htmlFor="ssh-host">SSH host</label>
                              <input
                                id="ssh-host"
                                required
                                value={ssh.host}
                                onChange={(event) => updateSsh({ host: event.target.value })}
                                placeholder="bastion.example.com"
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className={labelClass} htmlFor="ssh-port">Port</label>
                              <input
                                id="ssh-port"
                                required
                                type="number"
                                min="1"
                                max="65535"
                                value={ssh.port}
                                onChange={(event) => updateSsh({ port: Number(event.target.value) })}
                                className={inputClass}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className={labelClass} htmlFor="ssh-username">SSH user</label>
                              <input
                                id="ssh-username"
                                required
                                value={ssh.username}
                                onChange={(event) => updateSsh({ username: event.target.value })}
                                className={inputClass}
                              />
                            </div>
                            <div>
                              <label className={labelClass} htmlFor="ssh-auth">Authentication</label>
                              <select
                                id="ssh-auth"
                                value={ssh.authMethod}
                                onChange={(event) =>
                                  updateSsh({
                                    authMethod: event.target.value as SshTunnelConfig['authMethod'],
                                  })
                                }
                                className={inputClass}
                              >
                                <option value="password">Password</option>
                                <option value="privateKey">Private key</option>
                              </select>
                            </div>
                          </div>

                          {ssh.authMethod === 'privateKey' && (
                            <div>
                              <label className={labelClass} htmlFor="ssh-key">Private key file</label>
                              <div className="flex gap-2">
                                <input
                                  id="ssh-key"
                                  required
                                  value={ssh.privateKeyPath ?? ''}
                                  onChange={(event) => updateSsh({ privateKeyPath: event.target.value })}
                                  placeholder="~/.ssh/id_ed25519"
                                  className={inputClass}
                                />
                                {desktop?.selectFile && (
                                  <button
                                    type="button"
                                    onClick={() => void pickFile('ssh-key')}
                                    className={sideButtonClass}
                                  >
                                    <FolderOpen size={14} />
                                    Browse…
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          <div>
                            <label className={labelClass} htmlFor="ssh-secret">
                              {ssh.authMethod === 'password' ? 'SSH password' : 'Key passphrase (optional)'}
                            </label>
                            <input
                              id="ssh-secret"
                              type="password"
                              value={sshSecret}
                              onChange={(event) => setSshSecret(event.target.value)}
                              placeholder={isEditMode ? 'Unchanged' : ''}
                              className={inputClass}
                            />
                            <p className={hintClass}>
                              Stored in the system keychain. The database host and port above are
                              reached from the SSH server.
                            </p>
                          </div>

                          {isEditMode && ssh.host && (
                            <div className="text-[11px]">
                              <button
                                type="button"
                                onClick={() => void forgetHostKey()}
                                className="text-gray-500 underline-offset-2 hover:text-amber-400 hover:underline"
                              >
                                Forget saved server host key…
                              </button>
                              {hostKeyMessage && (
                                <span className="ml-2 text-gray-400">{hostKeyMessage}</span>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-(--c-2b303b) bg-(--c-171b24) px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-(--c-343a46) px-4 py-2 text-sm text-(--c-aab1bd) hover:bg-(--c-252b36)"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-[white] transition hover:bg-blue-500"
            >
              {isEditMode ? 'Update Connection' : 'Save Connection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
