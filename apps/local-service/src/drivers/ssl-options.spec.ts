import { resolveSsl } from './ssl-options';

describe('resolveSsl', () => {
  it('disables SSL for "disable"', () => {
    expect(resolveSsl('disable')).toEqual({ tls: false, allowFallback: false });
  });

  it('tries SSL with fallback for "prefer" and unknown values', () => {
    for (const mode of ['prefer', undefined, null, 'garbage']) {
      expect(resolveSsl(mode)).toEqual({
        tls: { rejectUnauthorized: false },
        allowFallback: true,
      });
    }
  });

  it('requires SSL without validation for "require"', () => {
    expect(resolveSsl('require')).toEqual({
      tls: { rejectUnauthorized: false },
      allowFallback: false,
    });
  });

  it('validates the chain but not the host for "verify-ca"', () => {
    const { tls, allowFallback } = resolveSsl('verify-ca');

    expect(allowFallback).toBe(false);
    expect(tls).toMatchObject({ rejectUnauthorized: true });
    expect(tls && tls.checkServerIdentity?.('host', {} as never)).toBeUndefined();
  });

  it('validates chain and host for "verify-full"', () => {
    const { tls } = resolveSsl('verify-full');

    expect(tls).toEqual({ rejectUnauthorized: true });
  });
});
