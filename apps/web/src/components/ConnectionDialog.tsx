
import { useState } from 'react';
import { Database, X } from 'lucide-react';

import type { DatabaseType, SslMode } from '@tukaka/contracts';

export type { DatabaseType, SslMode };

const sslModes: ReadonlyArray<[SslMode, string, string]> = [
    ['disable', 'Disable', 'Never use SSL.'],
    ['prefer', 'Prefer', 'Use SSL if the server supports it, otherwise connect without it. The certificate is not validated.'],
    ['require', 'Require', 'Always use SSL, but do not validate the server certificate.'],
    ['verify-ca', 'Verify CA', 'Always use SSL and validate the certificate chain (host name is not checked).'],
    ['verify-full', 'Verify Full', 'Always use SSL and validate both the certificate chain and the host name.'],
];

function toSslMode(value: string | undefined): SslMode {
    return sslModes.some(([mode]) => mode === value)
        ? (value as SslMode)
        : 'prefer';
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
    };
}

const defaultPorts: Record<DatabaseType, number> = {
    postgresql: 5432,
    mysql: 3306,
    sqlite: 0,
};

export default function ConnectionDialog({
    onClose,
    onSave,
    initialConfig,
}: ConnectionDialogProps) {
    const isEditMode = Boolean(initialConfig);

    const [type, setType] = useState<DatabaseType>(
        initialConfig?.type ?? 'postgresql',
    );

    const [name, setName] = useState(
        initialConfig?.name ?? 'Local PostgreSQL',
    );

    const [host, setHost] = useState(
        initialConfig?.host ?? 'localhost',
    );

    const [port, setPort] = useState(
        String(initialConfig?.port ?? 5432),
    );

    const [database, setDatabase] = useState(
        initialConfig?.database ?? 'postgres',
    );

    const [username, setUsername] = useState(
        initialConfig?.username ?? 'postgres',
    );

    const [password, setPassword] = useState('');

    const [sslMode, setSslMode] = useState<SslMode>(
        toSslMode(initialConfig?.ssl_mode),
    );

    const handleTypeChange = (newType: DatabaseType) => {
        setType(newType);
        setPort(String(defaultPorts[newType]));
        setSslMode('prefer');

        if (newType === 'sqlite') {
            setName('Local SQLite');
            setDatabase('');
        } else if (newType === 'mysql') {
            setName('Local MySQL');
            setDatabase('');
        } else {
            setName('Local PostgreSQL');
            setDatabase('postgres');
        }
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const config: ConnectionConfig = {
            name,
            type,
            database,
            ...(type !== 'sqlite' && {
                host,
                port: Number(port),
                username,
                ...(password && { password }),
                sslMode,
            }),
        };

        onSave(config);
    };

    const inputClass =
        'w-full rounded-md border border-[#343a46] bg-[#171b24] px-3 py-2 text-sm text-[#d5d8df] outline-none transition focus:border-blue-500';

    const labelClass =
        'mb-1.5 block text-xs font-medium text-[#9ca3af]';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
            <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-[#343a46] bg-[#1a1e27] shadow-2xl">

                <div className="flex items-center justify-between border-b border-[#2b303b] px-5 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                            <Database size={18} />
                        </div>

                        <div>
                            <h2 className="text-sm font-semibold text-[#e5e7eb]">
                                {isEditMode ? 'Edit Connection' : 'New Connection'}
                            </h2>

                            <p className="mt-0.5 text-xs text-[#858d9b]">
                                {isEditMode
                                    ? 'Update your database connection'
                                    : 'Configure your database connection'}
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md p-2 text-[#858d9b] hover:bg-[#2b303b] hover:text-white"
                    >
                        <X size={17} />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="space-y-4 p-5">

                        <div>
                            <label className={labelClass}>Database Type</label>

                            <div className="grid grid-cols-3 gap-2">
                                {(
                                    [
                                        ['postgresql', 'PostgreSQL'],
                                        ['mysql', 'MySQL'],
                                        ['sqlite', 'SQLite'],
                                    ] as const
                                ).map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        disabled={isEditMode}
                                        onClick={() => handleTypeChange(value)}
                                        className={`rounded-md border px-3 py-2.5 text-sm transition ${
                                            type === value
                                                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                                                : 'border-[#343a46] bg-[#171b24] text-[#9ca3af] hover:border-[#596273]'
                                        } disabled:cursor-not-allowed disabled:opacity-70`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className={labelClass}>Connection Name</label>

                            <input
                                required
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                placeholder="My Database"
                                className={inputClass}
                            />
                        </div>

                        {type === 'sqlite' ? (
                            <div>
                                <label className={labelClass}>Database File Path</label>

                                <input
                                    required
                                    value={database}
                                    onChange={(event) => setDatabase(event.target.value)}
                                    placeholder="/Users/username/database.sqlite"
                                    className={inputClass}
                                />

                                <p className="mt-1.5 text-[11px] text-[#737d8d]">
                                    Enter the path to your SQLite database file.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-[1fr_120px] gap-3">
                                    <div>
                                        <label className={labelClass}>Host</label>

                                        <input
                                            required
                                            value={host}
                                            onChange={(event) => setHost(event.target.value)}
                                            placeholder="localhost"
                                            className={inputClass}
                                        />
                                    </div>

                                    <div>
                                        <label className={labelClass}>Port</label>

                                        <input
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

                                <div>
                                    <label className={labelClass}>Database</label>

                                    <input
                                        required
                                        value={database}
                                        onChange={(event) => setDatabase(event.target.value)}
                                        placeholder="database_name"
                                        className={inputClass}
                                    />
                                </div>

                                <div>
                                    <label className={labelClass}>Username</label>

                                    <input
                                        required
                                        value={username}
                                        onChange={(event) => setUsername(event.target.value)}
                                        placeholder="Database username"
                                        className={inputClass}
                                    />
                                </div>

                                <div>
                                    <label className={labelClass}>SSL Mode</label>

                                    <select
                                        value={sslMode}
                                        onChange={(event) =>
                                            setSslMode(event.target.value as SslMode)
                                        }
                                        className={inputClass}
                                    >
                                        {sslModes.map(([value, label]) => (
                                            <option key={value} value={value}>
                                                {label}
                                            </option>
                                        ))}
                                    </select>

                                    <p className="mt-1.5 text-[11px] text-[#737d8d]">
                                        {sslModes.find(([value]) => value === sslMode)?.[2]}
                                    </p>
                                </div>

                                <div>
                                    <label className={labelClass}>Password</label>

                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(event) => setPassword(event.target.value)}
                                        placeholder={
                                            isEditMode
                                                ? 'Leave blank to keep current password'
                                                : 'Database password'
                                        }
                                        className={inputClass}
                                    />

                                    {isEditMode && (
                                        <p className="mt-1.5 text-[11px] text-[#737d8d]">
                                            Leave empty to keep your existing password.
                                            Enter a new password to update it.
                                        </p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div className="flex items-center justify-end gap-2 border-t border-[#2b303b] bg-[#171b24] px-5 py-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-[#343a46] px-4 py-2 text-sm text-[#aab1bd] hover:bg-[#252b36]"
                        >
                            Cancel
                        </button>

                        <button
                            type="submit"
                            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500"
                        >
                            {isEditMode ? 'Update Connection' : 'Save Connection'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
