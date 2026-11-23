
import type { ConnectionOptions } from 'node:tls';

export type SslMode =
  | 'disable'
  | 'prefer'
  | 'require'
  | 'verify-ca'
  | 'verify-full';

export interface ResolvedSsl {
  /**
   * Bağlantıda kullanılacak TLS ayarları. `false` ise SSL kullanılmaz.
   */
  tls: ConnectionOptions | false;
  /**
   * true ise sunucu SSL desteklemediğinde SSL'siz bağlantıya düşülür.
   */
  allowFallback: boolean;
}

/**
 * libpq `sslmode` semantiğini Node TLS ayarlarına çevirir.
 *
 * - disable:     SSL yok.
 * - prefer:      SSL dene, sunucu desteklemiyorsa SSL'siz bağlan. Sertifika doğrulanmaz.
 * - require:     SSL zorunlu, sertifika doğrulanmaz.
 * - verify-ca:   SSL zorunlu, sertifika zinciri doğrulanır, host adı doğrulanmaz.
 * - verify-full: SSL zorunlu, sertifika zinciri ve host adı doğrulanır.
 */
export function resolveSsl(mode: string | null | undefined): ResolvedSsl {
  switch (mode as SslMode) {
    case 'disable':
      return { tls: false, allowFallback: false };

    case 'require':
      return { tls: { rejectUnauthorized: false }, allowFallback: false };

    case 'verify-ca':
      return {
        tls: {
          rejectUnauthorized: true,
          checkServerIdentity: () => undefined,
        },
        allowFallback: false,
      };

    case 'verify-full':
      return { tls: { rejectUnauthorized: true }, allowFallback: false };

    case 'prefer':
    default:
      return { tls: { rejectUnauthorized: false }, allowFallback: true };
  }
}
